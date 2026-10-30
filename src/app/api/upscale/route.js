import { NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase";
import { enforceRateLimit } from "@/lib/rateLimit";
import {
  DEFAULT_MAX_IMAGE_BYTES,
  fetchWithSSRFProtection,
  getAllowedStorageHosts,
  isOwnedStorageUrl,
  normalizeUserImageUrl,
  validateUrlForSSRF,
} from "@/lib/ssrf";
import { logger } from "@/lib/logger";
import { UPSCALE_ENDPOINT, UPSCALE_FACTOR, UPSCALE_LIMIT_MESSAGE, getUpscalePlan, getUpscaleSettings, buildUpscaleJobMarker, parseUpscaleJobMarker } from "@/lib/standaloneUpscale";
import { readUpscaleJob, settleUpscaleJob, upscaleJobSnapshot } from "@/server/upscale/jobs";

export const runtime = 'nodejs';
// 60s, not 30s: the completed result is now downloaded from the provider and
// re-uploaded to R2 before it is recorded, which needs headroom on large output.
export const maxDuration = 60;

function isAiGenerationConfigured() {
  return Boolean(process.env.FAL_KEY);
}

async function getAuthenticatedUser(request) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const token = authHeader.replace('Bearer ', '').trim();
  const { data: { user }, error: authError } = await adminSupabase.auth.getUser(token);
  if (authError || !user) {
    return { error: NextResponse.json({ error: 'Unauthorized: invalid session' }, { status: 401 }) };
  }

  return { user };
}

export async function POST(request) {
  let userId;
  let projectId;
  let creditDeducted = false;
  let queuedRequestId;
  try {
    const { user, error: authResponse } = await getAuthenticatedUser(request);
    if (authResponse) return authResponse;
    userId = user.id;

    const rateLimit = await enforceRateLimit({
      namespace: "api:upscale:user",
      identifier: userId,
      max: 3,
      window: "60 s",
      windowMs: 60_000,
    });
    if (!rateLimit.success) return rateLimit.response;

    const body = await request.json();
    const { imageUrl, idempotencyKey, profile = "photo" } = body;
    const upscaleSettings = getUpscaleSettings(profile);
    if (!upscaleSettings) return NextResponse.json({ error: "Invalid upscale profile" }, { status: 400 });

    if (!imageUrl) {
      return NextResponse.json({ error: "Missing imageUrl" }, { status: 400 });
    }
    const requestKey = String(idempotencyKey || "").trim();
    if (!requestKey || requestKey.length > 120) {
      return NextResponse.json({ error: "Missing or invalid idempotency key" }, { status: 400 });
    }

    const finalImageUrl = normalizeUserImageUrl(imageUrl, new URL(request.url).origin);
    if (!isOwnedStorageUrl(finalImageUrl, { userId }) || !(await validateUrlForSSRF(finalImageUrl, { allowedHosts: getAllowedStorageHosts() }))) {
      return NextResponse.json({ error: "Invalid or unauthorized image URL" }, { status: 400 });
    }

    // ── Measure the source BEFORE charging ───────────────────────────────────
    // The bill is driven by the output area, which is derived from the real
    // source dimensions. Planning before the deduction means an unreadable
    // upload fails for free instead of needing a refund.
    const sharp = (await import('sharp')).default;
    let sourceMeta;
    let sourceBuffer;
    try {
      const fetched = await fetchWithSSRFProtection(finalImageUrl, {
        allowedHosts: getAllowedStorageHosts(),
        maxBytes: DEFAULT_MAX_IMAGE_BYTES,
        allowedContentTypes: ['image/'],
      });
      sourceBuffer = fetched.buffer;
      sourceMeta = await sharp(sourceBuffer).metadata();
    } catch (measureErr) {
      console.warn('[API Upscale] Could not read source image:', measureErr.message);
      sourceMeta = null;
    }

    if (!sourceMeta?.width || !sourceMeta?.height) {
      return NextResponse.json({ error: "Could not read that image. Please try another file." }, { status: 400 });
    }

    const plan = getUpscalePlan(sourceMeta.width, sourceMeta.height);
    if (!plan.allowed || (sourceMeta.pages || 1) > 1) {
      return NextResponse.json({
        error: (sourceMeta.pages || 1) > 1 ? "Please upload a single, still image." : UPSCALE_LIMIT_MESSAGE,
        code: "UPSCALE_INPUT_LIMIT",
      }, { status: 400 });
    }

    if (!isAiGenerationConfigured()) {
      logger.error("[API Upscale] AI provider is not configured; refusing to charge", { userId });
      return NextResponse.json({
        error: "AI processing is temporarily unavailable. Please try again shortly.",
        code: "AI_PROVIDER_UNAVAILABLE",
      }, { status: 503 });
    }

    logger.info("[API Upscale] Plan", {
      source: `${sourceMeta.width}x${sourceMeta.height}`,
      endpoint: UPSCALE_ENDPOINT,
      ...upscaleSettings,
    });

    const { data: claimRows, error: claimErr } = await adminSupabase
      .rpc('claim_standalone_upscale', {
        target_user_id: userId,
        source_image_url: finalImageUrl,
        request_key: requestKey,
      });

    if (claimErr) {
      throw new Error(`Failed to claim upscale charge: ${claimErr.message}`);
    }

    const claim = Array.isArray(claimRows) ? claimRows[0] : claimRows;
    if (claim?.status === 'insufficient_credits') {
      return NextResponse.json({ error: "INSUFFICIENT_CREDITS" }, { status: 403 });
    }
    if (!claim?.project_id) {
      throw new Error("Failed to claim upscale request.");
    }
    projectId = claim.project_id;
    if (claim.status === 'already_claimed') {
      const project = await readUpscaleJob(adminSupabase, projectId, userId);
      if (!project) throw new Error("Upscale request not found");
      return NextResponse.json({ success: true, projectId, ...upscaleJobSnapshot(project) });
    }

    creditDeducted = true;

    // Process via fal.ai
    if (!process.env.FAL_KEY) throw new Error("FAL_KEY missing");
    const { fal } = await import("@fal-ai/client");

    logger.info("[API Upscale] Queueing", { endpoint: UPSCALE_ENDPOINT, ...upscaleSettings });

    const queued = await fal.queue.submit(UPSCALE_ENDPOINT, {
      input: {
        image_url: finalImageUrl,
        ...upscaleSettings,
      },
    });

    if (!queued?.request_id) {
      throw new Error("Upscaler failed to queue the request.");
    }
    queuedRequestId = queued.request_id;

    // A brief DB failure after provider submission must not trigger a second
    // submission/refund while the paid job is running.
    for (let attempt = 0; attempt < 3; attempt++) {
      const { error: markerErr } = await adminSupabase.from('projects')
        .update({ ai_prompt: buildUpscaleJobMarker(queuedRequestId) })
        .eq('id', projectId).eq('user_id', userId).eq('client_request_id', requestKey);
      if (!markerErr) break;
      if (attempt === 2) throw new Error("Failed to save upscale request.");
      await new Promise(resolve => setTimeout(resolve, 150 * (attempt + 1)));
    }

    return NextResponse.json({
      success: true,
      status: queued.status || "IN_QUEUE",
      requestId: queued.request_id,
      projectId,
      // Surfaced so the provider bill can be checked against what we planned.
      cost: {
        model: UPSCALE_ENDPOINT,
        sourceSize: `${sourceMeta.width}x${sourceMeta.height}`,
        scale: UPSCALE_FACTOR,
        precisionModel: upscaleSettings.model,
        outputSize: `${plan.outputWidth}x${plan.outputHeight}`,
        estimatedUsd: 0.08,
      },
    });

  } catch (error) {
    console.error(`[Upscale API Error]:`, error.message);
    let didRefund = false;
    if (creditDeducted && userId && !queuedRequestId) {
      // Check the result — this used to be fire-and-forget, so a failed transfer
      // silently left the user out of pocket while the message claimed a refund.
      if (projectId) {
        const { data: refundRows, error: refundErr } = await adminSupabase
          .rpc('refund_project_credit', {
            target_user_id: userId,
            target_project_id: projectId,
            refund_action: 'Refund (Upscale Error)',
            failed_step_value: 'upscale',
            mark_generated_refunded: true,
          });
        const refund = Array.isArray(refundRows) ? refundRows[0] : refundRows;
        didRefund = !refundErr && refund?.status === 'refunded';
        if (!didRefund) {
          console.error(`[Upscale] CRITICAL: refund_project_credit failed for user ${userId} — left unrefunded for retry.`, refundErr || refund);
        }
      }
    }
    const safeMessage = error.message?.includes('fal')
      ? (didRefund
          ? 'AI processing failed. Your claw has been refunded.'
          : 'AI processing failed. Please try again.')
      : (error.message || 'Failed to process upscale');
    return NextResponse.json({ error: safeMessage, projectId, refunded: didRefund, retryable: !didRefund }, { status: 500 });
  }
}

export async function GET(request) {
  try {
    const { user, error: authResponse } = await getAuthenticatedUser(request);
    if (authResponse) return authResponse;

    // The client polls this endpoint up to 120 times per job at 3s intervals,
    // and each call costs an auth round trip, a DB read and a provider status
    // call. Only POST was limited, so this was a free amplifier onto a paid API.
    // The ceiling is well above what the normal poll loop needs.
    const rateLimit = await enforceRateLimit({
      namespace: "api:upscale-status:user",
      identifier: user.id,
      max: 60,
      window: "60 s",
      windowMs: 60_000,
    });
    if (!rateLimit.success) return rateLimit.response;

    const { searchParams } = new URL(request.url);
    const requestId = searchParams.get('requestId');
    const projectId = searchParams.get('projectId');
    if (!projectId) {
      return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
    }

    const project = await readUpscaleJob(adminSupabase, projectId, user.id);

    // Resolve the endpoint from the stored marker rather than assuming the
    // current model: jobs queued before the model swap are still in flight and
    // must keep resolving to the model they were submitted to.
    const job = parseUpscaleJobMarker(project?.ai_prompt);
    if (!project || (requestId && job?.requestId !== requestId)) {
      return NextResponse.json({ error: "Upscale request not found" }, { status: 404 });
    }

    let snapshot = upscaleJobSnapshot(project);
    if (snapshot.status === "IN_QUEUE" && job) {
      if (!process.env.FAL_KEY) throw new Error("FAL_KEY missing");
      const { fal } = await import("@fal-ai/client");
      snapshot = await settleUpscaleJob({ db: adminSupabase, fal, project });
    }
    if (snapshot.status === "FAILED") {
      return NextResponse.json({ error: "Upscale failed and was refunded", ...snapshot }, { status: 500 });
    }
    return NextResponse.json({ success: true, projectId, ...snapshot });
  } catch (error) {
    logger.error("[Upscale Poll Error]", error);
    return NextResponse.json({ error: "Unable to check or save the upscale yet. Please retry shortly.", retryable: true }, { status: 503 });
  }
}
