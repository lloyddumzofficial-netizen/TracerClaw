import { NextResponse } from "next/server";
import { uploadToR2 } from "@/lib/cloudflare";
import { adminSupabase } from "@/lib/supabase";
import { fetchWithRetry } from "@/lib/fetchWithRetry";
import { enforceRateLimit } from "@/lib/rateLimit";
import { DEFAULT_MAX_SVG_BYTES, DEFAULT_MAX_UPSCALED_IMAGE_BYTES, fetchWithSSRFProtection, getAllowedProviderHosts, getAllowedStorageHosts, isOwnedStorageUrl, validateUrlForSSRF } from "@/lib/ssrf";
import { logger } from "@/lib/logger";
import { notifyProjectCompleted } from "@/lib/integrations/webhook";

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

async function refundPrecisionCredit({ userId }) {
  const { data: refundRows, error: refundErr } = await adminSupabase
    .rpc('adjust_user_credit_with_log', {
      target_user_id: userId,
      credit_delta: 1,
      log_action: 'Refund Precision SVG Engine',
    });
  const refund = Array.isArray(refundRows) ? refundRows[0] : refundRows;
  if (refundErr || refund?.status !== 'adjusted') {
    logger.error(`[Billing] Precision refund FAILED for user ${userId} — left unrefunded for retry.`, refundErr || refund);
    return false;
  }
  return true;
}

async function vectorizeWithStandardEngine({ imageBlob, timeoutMs = 110000 }) {
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

async function vectorizeWithPrecisionEngine({ imageBlob, colors, vectorizerApiId, vectorizerApiSecret, timeoutMs = 80000 }) {
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

    // ==========================================
    // STAGE 3: VECTORIZE TO SVG
    // Standard uses the base pipeline charge from Step 1. Precision adds one
    // extra Claw and calls Vectorizer.AI server-side with Basic auth.
    // The image is already upscaled by ESRGAN in Step 2.
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
    // Recraft crispUpscale (Step 2) already sharpened and enhanced the image.
    // Here we only resize to 2048px max (Recraft vectorize has a 4096px hard limit,
    // and smaller inputs process faster without sacrificing SVG path quality)
    // and convert to lossless PNG for clean color data.
    // NO aggressive contrast/normalize/sharpen — that caused the high-contrast SVG problem.
    // ─────────────────────────────────────────────────────────────────────────
    const sharp = (await import('sharp')).default;
    let sharpInstance = sharp(rawBuffer)
      .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true });

    // Light sharpening for logos only: text and circular outlines benefit from
    // slightly crisper pixel edges before tracing, but we keep it gentle.
    if (project.trace_type === 'logo') {
      sharpInstance = sharpInstance
        .sharpen({ sigma: 1.0, m1: 0.5, m2: 1.5, x1: 2, y2: 8, y3: 15 });
    }

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
        const { data: chargeRows, error: chargeErr } = await adminSupabase
          .rpc('adjust_user_credit_with_log', {
            target_user_id: user.id,
            credit_delta: -1,
            log_action: 'Precision SVG Engine',
          });
        if (chargeErr) {
          console.error("[Step 3] Precision charge RPC failed:", chargeErr);
          return NextResponse.json({ error: "Billing error. Please try again." }, { status: 500 });
        }
        const charge = Array.isArray(chargeRows) ? chargeRows[0] : chargeRows;
        if (charge?.status === 'insufficient_credits') {
          return NextResponse.json({ error: "INSUFFICIENT_CREDITS" }, { status: 403 });
        }
        if (charge?.status !== 'adjusted') {
          return NextResponse.json({ error: "Billing error. Please try again." }, { status: 500 });
        }
        precisionCreditDeducted = true;

        try {
          svgText = await vectorizeWithPrecisionEngine({
            imageBlob: blob,
            colors,
            vectorizerApiId,
            vectorizerApiSecret,
            timeoutMs: 80000,
          });
        } catch (precisionError) {
          logger.warn("[Step 3] Precision SVG failed; falling back to standard SVG", {
            projectId,
            userId: user.id,
            error: precisionError?.message,
          });
          if (precisionCreditDeducted && await refundPrecisionCredit({ userId: user.id })) {
            precisionCreditDeducted = false;
          }
          precisionFallback = true;
          precisionWarning = "Precision SVG was temporarily unavailable, so Standard SVG was generated and the extra Precision claw was restored.";
          engineUsed = "standard";
          svgText = await vectorizeWithStandardEngine({ imageBlob: blob, timeoutMs: 35000 });
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
      svgText = await vectorizeWithStandardEngine({ imageBlob: blob });
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

    await adminSupabase
      .from('projects')
      .update({
        svg_url: finalSvgUrl,
        zip_url: null,
        zip_signature: null,
        zip_generated_at: null
      })
      .eq('id', projectId)
      .eq('user_id', user.id);

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
      if (precisionCreditDeducted && userId) {
        if (await refundPrecisionCredit({ userId })) {
          precisionCreditDeducted = false;
        }
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

    return NextResponse.json({ error: "Failed to process trace step." }, { status: 500 });
  }
}
