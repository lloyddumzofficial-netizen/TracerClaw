import { NextResponse } from "next/server";
import { adminSupabase, safeRefundCredit } from "@/lib/supabase";
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
// re-uploaded to R2 before it is recorded, which needs headroom on a 4K image.
export const maxDuration = 60;

// ─── Upscaler model ─────────────────────────────────────────────────────────
// fal-ai/clarity-upscaler is a diffusion upscaler and is billed at
// $0.03 per OUTPUT megapixel. The output area is therefore the ONLY lever on
// cost — not the file size, not the step count, not the prompt.
//
// Capping the AI output at the area of a true 4K landscape frame
// (3840x2160 = 8.29MP) makes every upscale cost the same flat amount no matter
// what shape the source is. Without an area cap a square 4K (3840x3840 =
// 14.7MP) would cost ~PHP 25.7 — more than a claw earns at the Pro tier.
// Anything that lands under 4K on its long edge after the AI step is finished
// with a lanczos3 resample, which is free.
const UPSCALE_MODEL_SLUG = "clarity-upscaler";
const UPSCALE_ENDPOINT = `fal-ai/${UPSCALE_MODEL_SLUG}`;
const FAL_USD_PER_MEGAPIXEL = 0.03;
const MAX_AI_OUTPUT_PIXELS = 3840 * 2160; // 8.29MP -> ~$0.249 (~PHP 14.4) flat
const DELIVERY_LONG_EDGE = 3840;          // true 4K on the long edge
const MAX_UPSCALE_FACTOR = 4;

// Tuned for flat print artwork (jerseys, logos) rather than photographs. The
// stock creativity of 0.35 lets the sampler invent detail, which warps text and
// logo edges — that is what made the previous output look wrong. Low creativity
// plus high resemblance keeps the result faithful to the source. None of these
// fields affect the bill; pricing is per output megapixel only.
const UPSCALE_TUNING = {
  prompt: "clean sharp artwork, crisp edges, flat solid colors, high detail",
  negative_prompt: "blurry, noisy, jpeg artifacts, distorted text, warped letters, invented details, watermark",
  creativity: 0.2,
  resemblance: 0.8,
  guidance_scale: 4,
  num_inference_steps: 18,
  enable_safety_checker: true,
};

/**
 * Work out the cheapest AI step that still delivers 4K.
 *
 * Returns the upscale_factor to send, the resulting output size, and what that
 * output will cost. When the source is already larger than the budget area the
 * factor would fall below 1 — the model would be billed for a huge output while
 * barely upscaling — so the caller is told to shrink the input first.
 */
function planUpscale(width, height) {
  const srcPixels = width * height;
  const longEdge = Math.max(width, height);

  // What a true 4K version of THIS aspect ratio would cost us, capped.
  const pixelsAt4K = srcPixels * Math.pow(DELIVERY_LONG_EDGE / longEdge, 2);
  const aiPixels = Math.min(MAX_AI_OUTPUT_PIXELS, pixelsAt4K);

  let factor = Math.sqrt(aiPixels / srcPixels);
  let resizeInputToPixels = null;

  if (factor < 1.05) {
    // Source already meets or exceeds the budget area. Feed the model a smaller
    // copy so the factor stays sane and the bill stays capped.
    factor = 2;
    resizeInputToPixels = Math.floor(aiPixels / 4);
  }

  // Floor to 2dp so rounding can never push the output past the cap.
  factor = Math.min(MAX_UPSCALE_FACTOR, Math.floor(factor * 100) / 100);

  const basePixels = resizeInputToPixels || srcPixels;
  const outPixels = Math.round(basePixels * factor * factor);
  const megapixels = outPixels / 1_000_000;

  return {
    factor,
    resizeInputToPixels,
    megapixels: Number(megapixels.toFixed(2)),
    estimatedUsd: Number((megapixels * FAL_USD_PER_MEGAPIXEL).toFixed(4)),
  };
}

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
 * used to do — means the user's paid 4K upscale becomes a dead link once the
 * provider expires it, with no recovery path and no refund eligibility (the
 * project counts as delivered). Every other pipeline step already persists to
 * R2; this brings the standalone upscale in line.
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

    // Finish at true 4K. The AI step is capped at 8.29MP for cost, so a square
    // or 4:3 result lands short of 3840 on its long edge; a lanczos3 resample
    // takes it the rest of the way. This is free — fal bills the AI step only.
    const sharp = (await import('sharp')).default;
    let outBuffer = buffer;
    let contentType = response.headers.get('content-type')?.split(';')[0] || 'image/png';
    try {
      const meta = await sharp(buffer).metadata();
      const longEdge = Math.max(meta.width || 0, meta.height || 0);
      if (longEdge > 0 && longEdge < DELIVERY_LONG_EDGE) {
        const scale = DELIVERY_LONG_EDGE / longEdge;
        const targetW = Math.round(meta.width * scale);
        const targetH = Math.round(meta.height * scale);
        outBuffer = await sharp(buffer)
          .resize(targetW, targetH, { fit: 'fill', kernel: 'lanczos3' })
          .png({ effort: 1 })
          .toBuffer();
        contentType = 'image/png';
        logger.info("[Upscale] Resampled to 4K", { from: `${meta.width}x${meta.height}`, to: `${targetW}x${targetH}` });
      }
    } catch (resampleErr) {
      // Non-fatal: the AI output on its own still beats a failed delivery.
      console.warn('[Upscale] 4K resample skipped (non-fatal):', resampleErr.message);
    }

    const ext = contentType === 'image/jpeg' ? 'jpg' : (contentType.split('/')[1] || 'png');
    return await uploadToR2(outBuffer, `projects/${projectId}/upscaled_${Date.now()}.${ext}`, contentType);
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

  const credited = await safeRefundCredit(userId);
  if (!credited) return false;

  await adminSupabase
    .from('projects')
    .update({
      generated_image_url: 'REFUNDED',
      refunded: true,
      failed_at: new Date().toISOString(),
      failed_step: "upscale",
    })
    .eq('id', projectId)
    .eq('user_id', userId)
    .eq('refunded', false);

  await adminSupabase.from('credit_logs').insert({
    user_id: userId,
    action: 'Refund (Upscale Error)',
    amount: 1,
  });

  return true;
}

export async function POST(request) {
  let userId;
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
    const { imageUrl } = body;

    if (!imageUrl) {
      return NextResponse.json({ error: "Missing imageUrl" }, { status: 400 });
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

    const plan = planUpscale(sourceMeta.width, sourceMeta.height);
    logger.info("[API Upscale] Plan", {
      source: `${sourceMeta.width}x${sourceMeta.height}`,
      factor: plan.factor,
      megapixels: plan.megapixels,
      estimatedUsd: plan.estimatedUsd,
    });

    // Check Credits
    const { data: profile, error: profileErr } = await adminSupabase
      .from('profiles')
      .select('credits')
      .eq('id', userId)
      .single();

    if (profileErr || !profile || profile.credits <= 0) {
      return NextResponse.json({ error: "INSUFFICIENT_CREDITS" }, { status: 403 });
    }

    // Deduct 1 Credit
    const { error: deductErr, data: updatedData } = await adminSupabase
      .from('profiles')
      .update({ credits: profile.credits - 1 })
      .eq('id', userId)
      .eq('credits', profile.credits)
      .select();

    if (deductErr || !updatedData || updatedData.length === 0) {
      return NextResponse.json({ error: "Conflict updating credits. Please try again." }, { status: 409 });
    }
    creditDeducted = true;

    // Log the transaction
    await adminSupabase.from('credit_logs').insert({
      user_id: userId,
      action: 'AI Clarity Upscale (4K)',
      amount: -1
    });

    // Process via fal.ai
    if (!process.env.FAL_KEY) throw new Error("FAL_KEY missing");
    const { fal } = await import("@fal-ai/client");

    // When the source already exceeds the budget area, hand the model a smaller
    // copy. Otherwise it would be billed for a large output while barely
    // upscaling anything.
    let modelInputUrl = finalImageUrl;
    if (plan.resizeInputToPixels) {
      const scale = Math.sqrt(plan.resizeInputToPixels / (sourceMeta.width * sourceMeta.height));
      const resized = await sharp(sourceBuffer)
        .resize(Math.round(sourceMeta.width * scale), Math.round(sourceMeta.height * scale), { fit: 'fill', kernel: 'lanczos3' })
        .png({ effort: 1 })
        .toBuffer();
      modelInputUrl = await uploadToR2(resized, `users/${userId}/upscale_src_${Date.now()}.png`, 'image/png');
      logger.info("[API Upscale] Pre-shrank oversized source to stay inside the cost cap");
    }

    logger.info("[API Upscale] Queueing", { endpoint: UPSCALE_ENDPOINT, factor: plan.factor });

    const queued = await fal.queue.submit(UPSCALE_ENDPOINT, {
      input: {
        image_url: modelInputUrl,
        upscale_factor: plan.factor,
        ...UPSCALE_TUNING,
      },
    });

    if (!queued?.request_id) {
      throw new Error("Upscaler failed to queue the request.");
    }

    const { data: project, error: insertErr } = await adminSupabase
      .from('projects')
      .insert({
        user_id: userId,
        name: "Clarity Upscale 4K",
        trace_type: "upscale",
        original_image_url: finalImageUrl,
        ai_prompt: buildJobMarker(queued.request_id),
        generated_image_url: null,
        credit_deducted: true,
        refunded: false
      })
      .select('id')
      .single();

    if (insertErr) {
      throw new Error("Failed to save upscale request.");
    }

    return NextResponse.json({
      success: true,
      status: queued.status || "IN_QUEUE",
      requestId: queued.request_id,
      projectId: project.id,
      // Surfaced so the provider bill can be checked against what we planned.
      cost: {
        model: UPSCALE_ENDPOINT,
        sourceSize: `${sourceMeta.width}x${sourceMeta.height}`,
        upscaleFactor: plan.factor,
        aiMegapixels: plan.megapixels,
        estimatedUsd: plan.estimatedUsd,
      },
    });

  } catch (error) {
    console.error(`[Upscale API Error]:`, error.message);
    let didRefund = false;
    if (creditDeducted && userId) {
      // Check the result — this used to be fire-and-forget, so a failed transfer
      // silently left the user out of pocket while the message claimed a refund.
      didRefund = await safeRefundCredit(userId);
      if (didRefund) {
        await adminSupabase.from('credit_logs').insert({
          user_id: userId,
          action: 'Refund (Upscale Error)',
          amount: 1,
        });
      } else {
        console.error(`[Upscale] CRITICAL: safeRefundCredit failed for user ${userId} — left unrefunded for retry.`);
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
    return NextResponse.json({ error: error.message || "Failed to check upscale status" }, { status: 500 });
  }
}
