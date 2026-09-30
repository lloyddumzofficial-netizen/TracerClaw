import { NextResponse } from "next/server";
import { uploadToR2 } from "@/lib/cloudflare";
import { adminSupabase } from "@/lib/supabase";
import { fetchWithRetry } from "@/lib/fetchWithRetry";
import { enforceRateLimit } from "@/lib/rateLimit";
import { DEFAULT_MAX_SVG_BYTES, DEFAULT_MAX_UPSCALED_IMAGE_BYTES, fetchWithSSRFProtection, getAllowedProviderHosts, getAllowedStorageHosts, isOwnedStorageUrl, validateUrlForSSRF } from "@/lib/ssrf";
import { logger } from "@/lib/logger";
import { notifyProjectCompleted } from "@/lib/integrations/webhook";
import { claimGenerationAttempt, completeGenerationAttempt, refundGenerationAttempt, isGenerationAttemptStale, isValidGenerationRequestKey } from "@/server/billing/generationAttempts";
import { getRecoverableAttemptOutput } from "@/server/billing/recoverAttemptOutput";

export const runtime = 'nodejs';
export const maxDuration = 120; // 120s needed: ESRGAN output is large, Recraft vectorize takes time

function cleanSvgText(svgText) {
  let cleaned = String(svgText || "")
    .replace(/^```(xml|svg)?\n?/i, '')
    .replace(/\n?```$/i, '')
    .trim();

  const svgStartMatch = cleaned.match(/<svg[\s\S]*?>/i);
  if (!svgStartMatch) {
    throw new Error("Vector provider did not return a valid SVG document.");
  }

  const startIndex = cleaned.indexOf(svgStartMatch[0]);
  cleaned = cleaned.substring(startIndex);

  if (!/<\/svg>/i.test(cleaned)) {
    throw new Error("Vector provider returned an incomplete SVG document.");
  }

  if (!cleaned.includes('xmlns="http://www.w3.org/2000/svg"')) {
    cleaned = cleaned.replace(/<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  }

  return cleaned;
}

async function readProviderError(response, fallbackMessage) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const data = await response.json().catch(() => null);
    return data?.error?.message || data?.message || data?.error || fallbackMessage;
  }
  const text = await response.text().catch(() => "");
  return text || fallbackMessage;
}

async function vectorizeWithStandardEngine({ imageBlob, timeoutMs = 50_000 }) {
  const vectorizeFormData = new FormData();
  vectorizeFormData.append('image', imageBlob, 'image.png');

  logger.info("[Step 3] Sending to standard vector engine");
  const recraftVectorRes = await fetchWithRetry("https://external.api.recraft.ai/v1/images/vectorize", {
    method: "POST",
    headers: { "Authorization": `Bearer ${process.env.RECRAFT_API_KEY}` },
    body: vectorizeFormData,
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!recraftVectorRes.ok) {
    const errText = await readProviderError(recraftVectorRes, "Standard vectorization failed.");
    throw new Error(`Vectorization failed: ${errText}`);
  }

  const vectorData = await recraftVectorRes.json();
  const vectorUrl = vectorData?.image?.url;
  if (!vectorUrl) {
    throw new Error("Standard vector engine did not return an SVG URL.");
  }

  const { response: svgRes, buffer: svgDownloadBuffer } = await fetchWithSSRFProtection(vectorUrl, {
    allowedHosts: getAllowedProviderHosts(),
    maxBytes: DEFAULT_MAX_SVG_BYTES,
    allowedContentTypes: ['image/svg+xml', 'text/plain', 'application/octet-stream'],
  });
  if (!svgRes.ok) throw new Error("Failed to fetch vectorized SVG");

  return cleanSvgText(svgDownloadBuffer.toString('utf8'));
}

async function vectorizeWithPrecisionEngine({ imageBlob, colors, vectorizerApiId, vectorizerApiSecret, timeoutMs = 55_000 }) {
  const vectorizerFormData = new FormData();
  vectorizerFormData.append('image', imageBlob, 'image.png');
  vectorizerFormData.append('output.file_format', 'svg');
  vectorizerFormData.append('output.svg.adobe_compatibility_mode', 'true');
  vectorizerFormData.append('output.svg.fixed_size', 'false');
  if (colors && colors !== "auto") {
    vectorizerFormData.append('processing.max_colors', String(parseInt(colors, 10)));
  }

  const basicAuth = Buffer.from(`${vectorizerApiId}:${vectorizerApiSecret}`).toString('base64');
  logger.info("[Step 3] Sending to precision vector engine");
  const vectorizerRes = await fetchWithRetry("https://api.vectorizer.ai/api/v1/vectorize", {
    method: "POST",
    headers: { "Authorization": `Basic ${basicAuth}` },
    body: vectorizerFormData,
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!vectorizerRes.ok) {
    const errText = await readProviderError(vectorizerRes, "Precision vectorization failed.");
    throw new Error(`Precision vectorization failed: ${errText}`);
  }

  const svgArrayBuffer = await vectorizerRes.arrayBuffer();
  if (svgArrayBuffer.byteLength > DEFAULT_MAX_SVG_BYTES) {
    throw new Error("Precision SVG output is too large. Try cropping tighter or use Standard SVG.");
  }

  return cleanSvgText(Buffer.from(svgArrayBuffer).toString('utf8'));
}

export async function POST(request) {
  let projectId;
  let userId;
  let precisionAttemptId = null;
  let precisionCreditDeducted = false;
  try {
    // ─── Auth: verify the caller owns the project ─────────────────────────────
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const token = authHeader.replace('Bearer ', '').trim();
    const { data: { user }, error: authError } = await adminSupabase.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized: invalid session' }, { status: 401 });
    }
    userId = user.id;

    const rateLimit = await enforceRateLimit({
      namespace: "api:trace-step3:user",
      identifier: userId,
      max: 3,
      window: "60 s",
      windowMs: 60_000,
    });
    if (!rateLimit.success) return rateLimit.response;
    // ─────────────────────────────────────────────────────────────────────────

    const body = await request.json();
    projectId = body.projectId;
    const colors = body.colors || "auto";
    const svgEngine = body.svgEngine === "precision" ? "precision" : "standard";
    if (svgEngine === "precision" && !isValidGenerationRequestKey(body.requestKey)) {
      return NextResponse.json({ error: "Refresh the workspace before using Precision SVG.", code: "REQUEST_KEY_REQUIRED" }, { status: 400 });
    }

    if (colors !== "auto") {
      const colorLimit = parseInt(colors, 10);
      if (isNaN(colorLimit) || colorLimit < 2 || colorLimit > 256) {
        return NextResponse.json({ error: "Invalid colors parameter. Must be between 2 and 256." }, { status: 400 });
      }
    }

    if (!projectId) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const { data: project, error: projError } = await adminSupabase
      .from('projects')
      .select('*')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single();

    if (projError || !project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // Verify caller owns this project
    if (project.user_id !== user.id) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }
    if (project.svg_url) {
      return NextResponse.json({ success: true, step: 3, svg_url: project.svg_url, replayed: true });
    }

    // ==========================================
    // STAGE 3: VECTORIZE TO SVG
    // Standard uses the base pipeline charge from Step 1. Precision adds one
    // extra Claw and calls Vectorizer.AI server-side with Basic auth.
    // The image is already restored/upscaled in Step 2.
    // Here we only convert to lossless PNG and apply optional Shadow Killer
    // color reduction before handing off to Recraft vectorize.
    // ==========================================
    if (!project.upscaled_image_url) throw new Error("No upscaled image found for Step 3");
    if (!isOwnedStorageUrl(project.upscaled_image_url, { userId: user.id, projectId }) || !(await validateUrlForSSRF(project.upscaled_image_url, { allowedHosts: getAllowedStorageHosts() }))) {
      return NextResponse.json({ error: "Invalid or unauthorized upscaled image URL" }, { status: 400 });
    }

    const { response: rasterImgRes, buffer: rawBuffer } = await fetchWithSSRFProtection(project.upscaled_image_url, {
      allowedHosts: getAllowedStorageHosts(),
      maxBytes: DEFAULT_MAX_UPSCALED_IMAGE_BYTES,
      allowedContentTypes: ['image/', 'application/octet-stream'],
    });
    if (!rasterImgRes.ok) throw new Error("Failed to fetch upscaled image from R2");

    // ─── Step 3 Pre-processing ────────────────────────────────────────────────
    // The standard provider timed out on dense 4096px inputs. A 3072px raster
    // retains fine logo contours while cutting its pixel workload by 44%.
    // Precision keeps the full 4096px input for its finer path engine.
    // NO second sharpen here: Logo Step 2 already restores edge acutance, and
    // stacking another sharpen pass creates halos that become unwanted paths.
    // ─────────────────────────────────────────────────────────────────────────
    const sharp = (await import('sharp')).default;
    const vectorInputEdge = svgEngine === "standard" ? 3072 : 4096;
    const sharpInstance = sharp(rawBuffer)
      .resize({
        width: vectorInputEdge,
        height: vectorInputEdge,
        fit: 'inside',
        withoutEnlargement: true,
        kernel: 'lanczos3',
      });

    let compressedBuffer;
    if (colors && colors !== "auto") {
      const colorLimit = parseInt(colors, 10);
      compressedBuffer = await sharpInstance.png({ palette: true, colors: colorLimit, effort: 1 }).toBuffer();
    } else {
      compressedBuffer = await sharpInstance.png({ effort: 1 }).toBuffer();
    }

    const blob = new Blob([compressedBuffer], { type: 'image/png' });
    let svgText;
    let engineUsed = svgEngine;
    let precisionFallback = false;
    let precisionWarning = null;

    if (svgEngine === "precision") {
      const vectorizerApiId = process.env.VECTORIZER_API_ID;
      const vectorizerApiSecret = process.env.VECTORIZER_API_SECRET;

      if (vectorizerApiId && vectorizerApiSecret) {
        const charge = await claimGenerationAttempt({
          userId: user.id, projectId, operation: 'precision_svg',
          requestKey: body.requestKey, chargeAction: 'Precision SVG Engine',
        });
        if (charge.mode !== 'idempotent') {
          return NextResponse.json({ error: "Billing verification is unavailable. Please try again.", code: "BILLING_VERIFICATION_FAILED" }, { status: 503 });
        }
        precisionAttemptId = charge.attempt_id;
        if (charge.status === 'insufficient_credits') {
          return NextResponse.json({ error: "INSUFFICIENT_CREDITS" }, { status: 403 });
        }
        if (charge.status === 'already_claimed') {
          if (charge.attempt_status === 'completed' && charge.result_url) {
            return NextResponse.json({ success: true, step: 3, svg_url: charge.result_url, replayed: true });
          }
          const recoveredUrl = getRecoverableAttemptOutput({ operation: 'precision_svg', attempt_created_at: charge.attempt_created_at }, project);
          if (charge.attempt_status === 'processing' && recoveredUrl) {
            await completeGenerationAttempt(precisionAttemptId, recoveredUrl, 'image/svg+xml');
            return NextResponse.json({ success: true, step: 3, svg_url: recoveredUrl, replayed: true });
          }
          if (charge.attempt_status === 'processing' && isGenerationAttemptStale(charge.attempt_created_at)) {
            const refund = await refundGenerationAttempt({ userId, attemptId: precisionAttemptId, action: 'Refund Precision SVG Engine', errorCode: 'INTERRUPTED_GENERATION' });
            return NextResponse.json({ error: 'Interrupted Precision SVG was closed. Try again.', code: 'GENERATION_ATTEMPT_CLOSED', refunded: refund?.status === 'refunded' }, { status: 409 });
          }
          return NextResponse.json({ error: 'Precision SVG is still processing.', code: 'GENERATION_IN_PROGRESS' }, { status: 409 });
        }
        if (charge.status !== 'charged') {
          return NextResponse.json({ error: 'Billing verification failed.', code: 'BILLING_VERIFICATION_FAILED' }, { status: 503 });
        }
        precisionCreditDeducted = true;

        try {
          svgText = await vectorizeWithPrecisionEngine({
            imageBlob: blob,
            colors,
            vectorizerApiId,
            vectorizerApiSecret,
            timeoutMs: 55_000,
          });
        } catch (precisionError) {
          logger.warn("[Step 3] Precision SVG failed; falling back to standard SVG", {
            projectId,
            userId: user.id,
            error: precisionError?.message,
          });
          const refund = await refundGenerationAttempt({ userId, attemptId: precisionAttemptId, action: 'Refund Precision SVG Engine', errorCode: 'PRECISION_PROVIDER_FAILED' });
          if (refund?.status !== 'refunded' && refund?.status !== 'already_refunded') throw new Error('Precision refund could not be verified');
          precisionCreditDeducted = false;
          precisionFallback = true;
          precisionWarning = "Precision SVG was temporarily unavailable, so Standard SVG was generated and the extra Precision claw was restored.";
          engineUsed = "standard";
          svgText = await vectorizeWithStandardEngine({ imageBlob: blob, timeoutMs: 30_000 });
        }
      } else {
        logger.warn("[Step 3] Precision SVG requested without provider credentials; falling back to standard SVG", {
          projectId,
          userId: user.id,
        });
        precisionFallback = true;
        precisionWarning = "Precision SVG is not configured yet, so Standard SVG was generated instead.";
        engineUsed = "standard";
        svgText = await vectorizeWithStandardEngine({ imageBlob: blob });
      }
    } else {
      try {
        svgText = await vectorizeWithStandardEngine({ imageBlob: blob });
      } catch (standardError) {
        logger.warn("[Step 3] Standard SVG failed; trying backup vectorizer", {
          projectId,
          error: standardError?.message,
        });
        const vectorizerApiId = process.env.VECTORIZER_API_ID;
        const vectorizerApiSecret = process.env.VECTORIZER_API_SECRET;
        if (!vectorizerApiId || !vectorizerApiSecret) throw standardError;

        try {
          svgText = await vectorizeWithPrecisionEngine({
            imageBlob: blob,
            colors,
            vectorizerApiId,
            vectorizerApiSecret,
            timeoutMs: 45_000,
          });
          engineUsed = "precision";
          precisionFallback = true;
          precisionWarning = "Standard SVG was unavailable, so the backup vectorizer completed your file at no extra Claws.";
        } catch (backupError) {
          logger.error("[Step 3] Both SVG providers failed", {
            projectId,
            standardError: standardError?.message,
            backupError: backupError?.message,
          });
          throw new Error("Both SVG providers failed", { cause: backupError });
        }
      }
    }

    // ─── Semantic Layer Grouping — REMOVED ────────────────────────────────────
    // This step used to send the original image plus every SVG path position to
    // Gemini via OpenRouter, then rewrap the paths in named <g id="layer-…">
    // groups. It has been removed entirely, along with src/lib/svgSegmenter.js
    // and the OpenRouter dependency, because:
    //
    //   * it keyed Gemini's answer by position in a filtered 60-item array but
    //     read it back by position in the full path list, so any SVG with more
    //     than 60 paths — i.e. essentially every real garment — got shuffled
    //     layer names;
    //   * its SVG rebuild dropped <style>, <text> and nested <g> content that
    //     was not a bare shape, silently losing parts of a paid deliverable;
    //   * it added up to 25s to a route that only has a 120s budget, making
    //     step-3 timeouts (and the refunds they trigger) more likely.
    //
    // The vectorizer output is now saved exactly as returned — valid SVG with
    // unnamed groups, which is what shipped anyway whenever this step failed.
    // ─────────────────────────────────────────────────────────────────────────

    const svgBuffer = Buffer.from(svgText, 'utf8');
    const cfSvgFileName = `projects/${projectId}/vector_${Date.now()}.svg`;
    const finalSvgUrl = await uploadToR2(svgBuffer, cfSvgFileName, "image/svg+xml");

    const { data: savedProject, error: saveError } = await adminSupabase
      .from('projects')
      .update({
        svg_url: finalSvgUrl,
        zip_url: null,
        zip_signature: null,
        zip_generated_at: null
      })
      .eq('id', projectId)
      .eq('user_id', user.id)
      .select('id')
      .single();
    if (saveError || !savedProject) throw new Error('Failed to save SVG to project');
    // The output is durable now. If attempt settlement fails, cron will recover
    // it from the project rather than returning the extra claw.
    precisionCreditDeducted = false;
    if (precisionAttemptId) {
      try {
        await completeGenerationAttempt(precisionAttemptId, finalSvgUrl, 'image/svg+xml');
      } catch (settlementError) {
        logger.error('[Billing] SVG saved; attempt settlement deferred to cleanup', { projectId, message: settlementError?.message });
      }
    }

    try {
      await notifyProjectCompleted(user.id, {
        ...project,
        svg_url: finalSvgUrl,
        zip_url: null,
      });
    } catch (webhookError) {
      logger.warn("[Trace Step 3] Webhook notification failed after SVG completion", {
        projectId,
        userId: user.id,
        error: webhookError,
      });
    }

    return NextResponse.json({
      success: true,
      step: 3,
      svg_url: finalSvgUrl,
      engineUsed,
      precisionFallback,
      warning: precisionWarning,
    });

  } catch (error) {
    console.error(`[Trace Step 3 Error]:`, error.message);
    
    try {
      // Refund the EXTRA precision claw — that service genuinely was not
      // delivered. Check the result rather than assuming it moved.
      if (precisionCreditDeducted && userId && precisionAttemptId) {
        const refund = await refundGenerationAttempt({ userId, attemptId: precisionAttemptId, action: 'Refund Precision SVG Engine', errorCode: 'VECTOR_SAVE_FAILED' });
        if (refund?.status === 'refunded' || refund?.status === 'already_refunded') precisionCreditDeducted = false;
      }

      // Record the failure so /api/refund can distinguish it from a completed run.
      if (projectId && userId) {
        await adminSupabase
          .from('projects')
          .update({ failed_at: new Date().toISOString(), failed_step: 'step3' })
          .eq('id', projectId)
          .eq('user_id', userId);
      }

      // Deliberately NOT refunding the base claw here, and deliberately NOT
      // blanking generated_image_url.
      //
      // Reaching step 3 means step 1 (flat extract) and step 2 (4K upscale)
      // both succeeded and are saved in R2. The old code refunded the base claw
      // anyway and overwrote generated_image_url with the string 'REFUNDED' —
      // giving the money back while the user kept both deliverables, and
      // destroying the DB pointer to an image they had paid for. Only the
      // vectorization failed; the run was not a total loss.
    } catch (refundErr) {
      console.error(`[Billing] Refund failed:`, refundErr.message);
    }

    const isTimeout = /timed?\s*out|timeout|aborted/i.test(String(error?.message || "")) ||
      error?.name === "AbortError" || error?.name === "TimeoutError";
    const isProviderFailure = isTimeout || /vectoriz|SVG providers/i.test(String(error?.message || ""));
    return NextResponse.json({
      error: isProviderFailure
        ? "SVG conversion is temporarily unavailable. Your extracted image is saved; retry SVG only without paying for extraction again."
        : "Could not save the SVG. Your extracted image is saved; retry SVG only.",
      code: isProviderFailure ? "VECTOR_PROVIDER_UNAVAILABLE" : "VECTOR_SAVE_FAILED",
      retryable: true,
    }, { status: isTimeout ? 504 : isProviderFailure ? 503 : 500 });
  }
}
