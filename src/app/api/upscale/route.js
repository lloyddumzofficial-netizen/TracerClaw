import { NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase";
import { uploadToR2 } from "@/lib/cloudflare";
import { enforceRateLimit } from "@/lib/rateLimit";
import {
  DEFAULT_MAX_IMAGE_BYTES,
  DEFAULT_MAX_UPSCALED_IMAGE_BYTES,
  fetchWithSSRFProtection,
  getAllowedProviderHosts,
  getAllowedStorageHosts,
  isOwnedStorageUrl,
  normalizeUserImageUrl,
  validateUrlForSSRF,
} from "@/lib/ssrf";
import { logger } from "@/lib/logger";

export const runtime = 'nodejs';
// 60s, not 30s: the completed result is now downloaded from the provider and
// re-uploaded to R2 before it is recorded, which needs headroom on large output.
export const maxDuration = 60;

// ─── Upscaler model ─────────────────────────────────────────────────────────
// fal-ai/esrgan is a Real-ESRGAN upscaler. Keep the settings explicit so the
// standalone Image Upscale tool always queues the requested model/configuration.
const UPSCALE_MODEL_SLUG = "esrgan";
const UPSCALE_ENDPOINT = `fal-ai/${UPSCALE_MODEL_SLUG}`;
const UPSCALE_SETTINGS = {
  scale: 6,
  model: "RealESRGAN_x4plus",
  output_format: "png",
  tile: 400,
};
const MAX_ESRGAN_INPUT_LONG_EDGE = 1280;

/** Job marker stored in ai_prompt: fal:<model-slug>:<requestId>. */
function buildJobMarker(requestId) {
  return `fal:${UPSCALE_MODEL_SLUG}:${requestId}`;
}

/**
 * Resolve which fal endpoint a stored job belongs to. Jobs queued before the
 * model swap carry `fal:aura-sr:<id>` and must keep resolving to aura-sr, or
 * every in-flight upscale at deploy time would fail its status lookup.
 */
function resolveJobEndpoint(aiPrompt, requestId) {
  const match = String(aiPrompt || '').match(/^fal:([a-z0-9.-]+):(.+)$/i);
  if (!match || match[2] !== requestId) return null;
  return `fal-ai/${match[1]}`;
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

/**
 * Move a finished provider image into our own bucket.
 *
 * fal.media URLs are temporary. Storing one directly — which is what this route
 * used to do — means the user's paid upscale becomes a dead link once the
 * provider expires it, with no recovery path and no refund eligibility (the
 * project counts as delivered). Every other pipeline step already persists to
 * R2; this keeps standalone upscale results in line.
 *
 * Best-effort on purpose: if the copy fails we fall back to the provider URL
 * rather than failing a run the user has already paid for. /api/proxy still
 * allows provider hosts, so that fallback keeps working exactly as before.
 */
async function persistUpscaleToR2(providerUrl, projectId) {
  try {
    const { response, buffer } = await fetchWithSSRFProtection(providerUrl, {
      allowedHosts: getAllowedProviderHosts(),
      maxBytes: DEFAULT_MAX_UPSCALED_IMAGE_BYTES,
      allowedContentTypes: ['image/', 'application/octet-stream'],
    });
    if (!response.ok) throw new Error(`Provider returned ${response.status}`);

    let contentType = response.headers.get('content-type')?.split(';')[0] || 'image/png';

    const ext = contentType === 'image/jpeg' ? 'jpg' : (contentType.split('/')[1] || 'png');
    return await uploadToR2(buffer, `projects/${projectId}/upscaled_${Date.now()}.${ext}`, contentType);
  } catch (err) {
    console.error(`[Upscale] Could not persist result to R2 for project ${projectId}, keeping provider URL:`, err.message);
    return null;
  }
}

async function refundQueuedUpscale(projectId, userId) {
  const { data: project } = await adminSupabase
    .from('projects')
    .select('credit_deducted, refunded, generated_image_url')
    .eq('id', projectId)
    .eq('user_id', userId)
    .single();

  if (!project?.credit_deducted || project.refunded || project.generated_image_url) {
    return false;
  }

  const { data: refundRows, error: refundErr } = await adminSupabase
    .rpc('refund_project_credit', {
      target_user_id: userId,
      target_project_id: projectId,
      refund_action: 'Refund (Upscale Error)',
      failed_step_value: 'upscale',
      mark_generated_refunded: true,
    });
  const refund = Array.isArray(refundRows) ? refundRows[0] : refundRows;
  return !refundErr && refund?.status === 'refunded';
}

export async function POST(request) {
  let userId;
  let projectId;
  let creditDeducted = false;
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
    const { imageUrl, idempotencyKey } = body;

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

    logger.info("[API Upscale] Plan", {
      source: `${sourceMeta.width}x${sourceMeta.height}`,
      endpoint: UPSCALE_ENDPOINT,
      ...UPSCALE_SETTINGS,
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
      return NextResponse.json({ success: true, status: "ALREADY_IN_PROGRESS", projectId });
    }

    creditDeducted = true;

    // Process via fal.ai
    if (!process.env.FAL_KEY) throw new Error("FAL_KEY missing");
    const { fal } = await import("@fal-ai/client");

    let modelInputUrl = finalImageUrl;
    const sourceLongEdge = Math.max(sourceMeta.width, sourceMeta.height);
    if (sourceLongEdge > MAX_ESRGAN_INPUT_LONG_EDGE) {
      const resizeScale = MAX_ESRGAN_INPUT_LONG_EDGE / sourceLongEdge;
      const resized = await sharp(sourceBuffer)
        .resize(Math.round(sourceMeta.width * resizeScale), Math.round(sourceMeta.height * resizeScale), { fit: 'fill', kernel: 'lanczos3' })
        .png({ effort: 1 })
        .toBuffer();
      modelInputUrl = await uploadToR2(resized, `users/${userId}/upscale_src_${Date.now()}.png`, 'image/png');
      logger.info("[API Upscale] Pre-shrank oversized ESRGAN source", {
        from: `${sourceMeta.width}x${sourceMeta.height}`,
        maxLongEdge: MAX_ESRGAN_INPUT_LONG_EDGE,
      });
    }

    logger.info("[API Upscale] Queueing", { endpoint: UPSCALE_ENDPOINT, ...UPSCALE_SETTINGS });

    const queued = await fal.queue.submit(UPSCALE_ENDPOINT, {
      input: {
        image_url: modelInputUrl,
        ...UPSCALE_SETTINGS,
      },
    });

    if (!queued?.request_id) {
      throw new Error("Upscaler failed to queue the request.");
    }

    const { error: markerErr } = await adminSupabase
      .from('projects')
      .update({ ai_prompt: buildJobMarker(queued.request_id) })
      .eq('id', projectId)
      .eq('user_id', userId)
      .eq('client_request_id', requestKey);

    if (markerErr) {
      throw new Error("Failed to save upscale request.");
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
        scale: UPSCALE_SETTINGS.scale,
        esrganModel: UPSCALE_SETTINGS.model,
      },
    });

  } catch (error) {
    console.error(`[Upscale API Error]:`, error.message);
    let didRefund = false;
    if (creditDeducted && userId) {
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
    return NextResponse.json({ error: safeMessage }, { status: 500 });
  }
}

export async function GET(request) {
  let userId;
  let projectId;
  try {
    const { user, error: authResponse } = await getAuthenticatedUser(request);
    if (authResponse) return authResponse;
    userId = user.id;

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
    projectId = searchParams.get('projectId');
    if (!requestId || !projectId) {
      return NextResponse.json({ error: "Missing requestId or projectId" }, { status: 400 });
    }

    const { data: project, error: projectErr } = await adminSupabase
      .from('projects')
      .select('id, user_id, ai_prompt, generated_image_url, refunded')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single();

    // Resolve the endpoint from the stored marker rather than assuming the
    // current model: jobs queued before the model swap are still in flight and
    // must keep resolving to the model they were submitted to.
    const jobEndpoint = projectErr || !project ? null : resolveJobEndpoint(project.ai_prompt, requestId);
    if (!jobEndpoint) {
      return NextResponse.json({ error: "Upscale request not found" }, { status: 404 });
    }

    if (project.generated_image_url && project.generated_image_url !== 'REFUNDED') {
      return NextResponse.json({ success: true, status: "COMPLETED", upscaledUrl: project.generated_image_url });
    }

    if (project.refunded || project.generated_image_url === 'REFUNDED') {
      return NextResponse.json({ error: "Upscale failed and was refunded" }, { status: 500 });
    }

    if (!process.env.FAL_KEY) throw new Error("FAL_KEY missing");
    const { fal } = await import("@fal-ai/client");
    const status = await fal.queue.status(jobEndpoint, { requestId, logs: true });

    if (status.status !== "COMPLETED") {
      if (status.status === "FAILED") {
        const didRefund = await refundQueuedUpscale(projectId, user.id);
        return NextResponse.json({
          error: didRefund
            ? "AI processing failed. Your claw has been refunded."
            : "AI processing failed. Please try again.",
        }, { status: 500 });
      }
      return NextResponse.json({ success: true, status: status.status, logs: status.logs || [] });
    }

    const result = await fal.queue.result(jobEndpoint, { requestId });
    const providerUrl = result?.data?.image?.url;
    if (!providerUrl) {
      const didRefund = await refundQueuedUpscale(projectId, user.id);
      return NextResponse.json({
        error: didRefund
          ? "AI processing failed. Your claw has been refunded."
          : "AI processing failed. Please try again.",
      }, { status: 500 });
    }

    const upscaledUrl = (await persistUpscaleToR2(providerUrl, projectId)) || providerUrl;

    await adminSupabase
      .from('projects')
      .update({ generated_image_url: upscaledUrl })
      .eq('id', projectId)
      .eq('user_id', user.id);

    return NextResponse.json({ success: true, status: "COMPLETED", upscaledUrl });
  } catch (error) {
    logger.error("[Upscale Poll Error]", error);
    if (projectId && userId && (error.name === "ValidationError" || error.message === "Unprocessable Entity")) {
      const didRefund = await refundQueuedUpscale(projectId, userId);
      return NextResponse.json({
        error: didRefund
          ? "AI processing failed. Your claw has been refunded."
          : "AI processing failed. Please try again.",
      }, { status: 500 });
    }
    return NextResponse.json({ error: error.message || "Failed to check upscale status" }, { status: 500 });
  }
}
