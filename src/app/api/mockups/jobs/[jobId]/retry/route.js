import { NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase";
import { enforceRateLimit } from "@/lib/rateLimit";
import { requireUser } from "@/server/api/auth";
import {
  loadMockupAssets,
  loadOwnedMockupJob,
  loadOwnedMockupProject,
  submitMockupViews,
  createMockupWebhookUrl,
} from "@/server/mockups";
import { MOCKUP_SHOTS } from "@/features/mockup-studio/config";
import { getGarmentProfile, isGarmentPartAllowed } from "@/features/mockup-studio/garmentCatalog";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request, { params }) {
  const auth = await requireUser(request);
  if (auth.response) return auth.response;
  const limited = await enforceRateLimit({ namespace: "api:mockups:retry:user", identifier: auth.user.id, max: 2, window: "60 s", windowMs: 60_000 });
  if (!limited.success) return limited.response;

  const { jobId } = await params;
  const body = await request.json().catch(() => ({}));
  const shot = MOCKUP_SHOTS.find(item => item.key === body.viewType);
  if (!shot) return NextResponse.json({ error: "Choose a valid campaign view." }, { status: 400 });

  const { job } = await loadOwnedMockupJob(auth.user.id, jobId);
  if (!job) return NextResponse.json({ error: "Mockup render not found." }, { status: 404 });
  if (job.status !== "completed") return NextResponse.json({ error: "Wait for the campaign set to finish first." }, { status: 409 });
  const requests = job.provider_requests || {};
  if (requests._retryUsed) return NextResponse.json({ error: "The included single-view correction has already been used for this set." }, { status: 409 });

  const reservedRequests = { ...requests, _retryUsed: true, _retryView: shot.key, _phase: "retry_queueing" };
  const { data: reservation } = await adminSupabase.from("mockup_jobs").update({
    provider_requests: reservedRequests,
    status: "processing",
    updated_at: new Date().toISOString(),
    completed_at: null,
  }).eq("id", jobId).eq("user_id", auth.user.id).eq("status", "completed").select("id").maybeSingle();
  if (!reservation) return NextResponse.json({ error: "This set is already being updated." }, { status: 409 });

  try {
    const [{ project }, assetsResult, outputsResult] = await Promise.all([
      loadOwnedMockupProject(auth.user.id, job.project_id),
      loadMockupAssets(auth.user.id, job.project_id),
      adminSupabase.from("mockup_outputs").select("view_type,file_url").eq("job_id", jobId).eq("user_id", auth.user.id),
    ]);
    if (!project) throw new Error("Mockup project is unavailable.");
    const profile = getGarmentProfile(project.garment_type);
    const order = [...profile.requiredParts, ...profile.optionalParts];
    const assets = (assetsResult.data || [])
      .filter(asset => isGarmentPartAllowed(project.garment_type, asset.role))
      .sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role));
    const heroUrl = outputsResult.data?.find(output => output.view_type === "hero")?.file_url;
    const boardUrl = requests._referenceBoard;
    if (!boardUrl || !heroUrl) throw new Error("Campaign references are incomplete.");

    const retryRequest = await submitMockupViews({
      imageUrls: [boardUrl, heroUrl, ...assets.map(asset => asset.file_url)],
      assetRoles: ["production_board", "canonical_hero", ...assets.map(asset => asset.role)],
      style: project.style_preset,
      colors: project.colors || {},
      garmentType: project.garment_type,
      shots: [shot],
      webhookUrl: createMockupWebhookUrl(jobId),
    });
    const nextRequests = {
      ...reservedRequests,
      _retryRequest: retryRequest[shot.key],
      _phase: "retry",
    };
    await adminSupabase.from("mockup_jobs").update({ provider_requests: nextRequests, status: "processing", updated_at: new Date().toISOString() })
      .eq("id", jobId).eq("user_id", auth.user.id);
    return NextResponse.json({ jobId, status: "processing", viewType: shot.key }, { status: 202 });
  } catch (error) {
    const restored = { ...requests, _retryUsed: false, _phase: "complete" };
    await adminSupabase.from("mockup_jobs").update({
      provider_requests: restored,
      status: "completed",
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", jobId).eq("user_id", auth.user.id);
    console.error("[Mockup retry] Could not start:", error?.message);
    return NextResponse.json({ error: "The selected view could not be restarted. No Claws were charged." }, { status: 503 });
  }
}
