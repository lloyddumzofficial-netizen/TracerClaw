import { NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase";
import { logger } from "@/lib/logger";
import { enforceRateLimit } from "@/lib/rateLimit";
import { requireUser } from "@/server/api/auth";
import { isValidGenerationRequestKey } from "@/server/billing";
import { createMockupWebhookUrl, createProductionReferenceBoard, loadMockupAssets, loadOwnedMockupProject, submitMockupViews } from "@/server/mockups";
import { uploadToR2 } from "@/lib/cloudflare";
import { MOCKUP_RENDER_COST, MOCKUP_SHOTS } from "@/features/mockup-studio/config";
import { getGarmentParts, getGarmentProfile, isGarmentPartAllowed } from "@/features/mockup-studio/garmentCatalog";

export const runtime = "nodejs";
export const maxDuration = 60;

async function refundFailedSubmission(userId, jobId, errorCode) {
  if (!jobId) return;
  await adminSupabase.rpc("refund_mockup_render", {
    target_user_id: userId,
    target_job_id: jobId,
    error_code_value: errorCode,
  });
}

export async function POST(request, { params }) {
  const auth = await requireUser(request);
  if (auth.response) return auth.response;
  const limited = await enforceRateLimit({ namespace: "api:mockups:render:user", identifier: auth.user.id, max: 3, window: "60 s", windowMs: 60_000 });
  if (!limited.success) return limited.response;
  const { id } = await params;
  const [{ project }, assetsResult] = await Promise.all([
    loadOwnedMockupProject(auth.user.id, id),
    loadMockupAssets(auth.user.id, id),
  ]);
  if (!project) return NextResponse.json({ error: "Mockup project not found." }, { status: 404 });

  const assets = assetsResult.data || [];
  const roles = new Set(assets.map(asset => asset.role));
  const garmentParts = getGarmentParts(project.garment_type);
  const missing = garmentParts.required.filter(role => !roles.has(role));
  if (missing.length) {
    return NextResponse.json({ error: `Upload all required panels first: ${missing.join(", ")}.` }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const requestKey = String(body.requestKey || "");
  if (!isValidGenerationRequestKey(requestKey)) {
    return NextResponse.json({ error: "Invalid render request key." }, { status: 400 });
  }

  const { data: claimRows, error: claimError } = await adminSupabase.rpc("claim_mockup_render", {
    target_user_id: auth.user.id,
    target_project_id: id,
    attempt_request_key: requestKey,
    requested_charge: MOCKUP_RENDER_COST,
  });
  if (claimError) {
    logger.error("[Mockup billing] claim_mockup_render failed", {
      projectId: id,
      code: claimError.code || "UNKNOWN",
      message: claimError.message || "No message",
      details: claimError.details || null,
      hint: claimError.hint || null,
    });
    return NextResponse.json({ error: "Mockup billing verification is unavailable. No Claws were charged." }, { status: 503 });
  }
  const claim = Array.isArray(claimRows) ? claimRows[0] : claimRows;
  if (claim?.status === "insufficient_credits") return NextResponse.json({ error: "INSUFFICIENT_CREDITS" }, { status: 403 });
  if (claim?.status === "not_found") return NextResponse.json({ error: "Mockup project not found." }, { status: 404 });
  if (claim?.status === "already_claimed") {
    return NextResponse.json({ jobId: claim.job_id, status: claim.job_status, replayed: true, creditsRemaining: claim.credits_remaining });
  }
  if (claim?.status !== "charged" || !claim?.job_id) {
    return NextResponse.json({ error: "Could not reserve Claws for this render." }, { status: 503 });
  }

  const jobId = claim.job_id;
  try {
    const profile = getGarmentProfile(project.garment_type);
    const ordered = assets.filter(asset => isGarmentPartAllowed(project.garment_type, asset.role)).sort((a, b) => {
      const order = [...profile.requiredParts, ...profile.optionalParts];
      return order.indexOf(a.role) - order.indexOf(b.role);
    });
    const referenceBoard = await createProductionReferenceBoard({ assets: ordered, colors: project.colors || {}, garmentLabel: profile.label, garmentType: project.garment_type });
    const referenceBoardUrl = await uploadToR2(referenceBoard, `users/${auth.user.id}/mockups/${id}/references/${jobId}-production-board.png`, "image/png");
    const providerRequests = await submitMockupViews({
      imageUrls: [referenceBoardUrl, ...ordered.map(asset => asset.file_url)],
      assetRoles: ["production_board", ...ordered.map(asset => asset.role)],
      style: project.style_preset,
      colors: project.colors || {},
      garmentType: project.garment_type,
      shots: [MOCKUP_SHOTS[0]],
      webhookUrl: createMockupWebhookUrl(jobId),
    });
    providerRequests._referenceBoard = referenceBoardUrl;
    providerRequests._phase = "hero";
    const now = new Date().toISOString();
    const { error: updateError } = await adminSupabase.from("mockup_jobs").update({
      provider_requests: providerRequests,
      status: "queued",
      updated_at: now,
    }).eq("id", jobId).eq("user_id", auth.user.id).eq("status", "queueing");
    if (updateError) throw updateError;
    await adminSupabase.from("mockup_projects").update({ status: "rendering", updated_at: now })
      .eq("id", id).eq("user_id", auth.user.id);
    return NextResponse.json({ jobId, status: "queued", creditsRemaining: claim.credits_remaining }, { status: 202 });
  } catch {
    await refundFailedSubmission(auth.user.id, jobId, "PROVIDER_SUBMIT_FAILED").catch(() => null);
    return NextResponse.json({ error: "The render engine could not start. Your 2 Claws were restored.", refunded: true }, { status: 503 });
  }
}
