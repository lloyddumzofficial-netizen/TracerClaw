import { NextResponse } from "next/server";
import { adminSupabase, safeRefundCredit } from "@/lib/supabase";
import { enforceRateLimit } from "@/lib/rateLimit";
import { DEFAULT_MAX_IMAGE_BYTES, fetchWithSSRFProtection, getAllowedProviderHosts, getAllowedStorageHosts, isOwnedStorageUrl, normalizeUserImageUrl, validateUrlForSSRF } from "@/lib/ssrf";
import { buildNanoBananaPrompt, buildNanoBananaSystemPrompt, getNanoBananaInputTuning } from "@/lib/tracePrompts";
import { logger } from "@/lib/logger";

// IMPORTANT: Must use Node.js runtime (not edge) so we get real 120s timeouts.
// Edge runtime on Vercel has a hard 30s cap which causes all Gemini generations to fail.
export const runtime = 'nodejs';
export const maxDuration = 120; // Vercel Pro plan allows up to 300s; 120s is safe

export async function POST(request) {
  let projectId;
  let userId;
  let failedStep = "unknown";
  try {
    // ─── Auth: verify caller identity server-side ─────────────────────────────
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
      namespace: "api:trace:user",
      identifier: userId,
      max: 6,
      window: "60 s",
      windowMs: 60_000,
    });
    if (!rateLimit.success) return rateLimit.response;
    // ─────────────────────────────────────────────────────────────────────────

    const body = await request.json();
    projectId = body.projectId;
    const { step, croppedImageUrl } = body;
    failedStep = String(step);

    if (!projectId || !step) {
      return NextResponse.json({ error: "Missing required fields (projectId, step)" }, { status: 400 });
    }

    // Fetch project AND verify ownership in one query — prevents IDOR attacks
    const { data: project, error: projError } = await adminSupabase
      .from('projects')
      .select('*')
      .eq('id', projectId)
      .eq('user_id', user.id) // ← ownership check: users can only trace their own projects
      .single();

    if (projError || !project) {
      return NextResponse.json({ error: "Project not found or access denied" }, { status: 404 });
    }

    // HARD BLOCK: project must belong to a real user
    if (!project.user_id) {
      return NextResponse.json({ error: "Project has no owner. Please re-upload your image." }, { status: 403 });
    }

    let sourceUrl;
    let rawSourceBuffer;
    if (step === 1) {
      sourceUrl = normalizeUserImageUrl(croppedImageUrl || project.original_image_url, new URL(request.url).origin);
      if (!isOwnedStorageUrl(sourceUrl, { userId: user.id, projectId }) || !(await validateUrlForSSRF(sourceUrl, { allowedHosts: getAllowedStorageHosts() }))) {
        return NextResponse.json({ error: "Invalid or unauthorized image URL" }, { status: 400 });
      }
      let sourceFetch;
      try {
        sourceFetch = await fetchWithSSRFProtection(sourceUrl, {
          allowedHosts: getAllowedStorageHosts(),
          maxBytes: DEFAULT_MAX_IMAGE_BYTES,
          allowedContentTypes: ['image/'],
        });
      } catch (sourceErr) {
        console.warn(`[Trace] Blocked or failed source image fetch for project ${projectId}:`, sourceErr.message);
        return NextResponse.json({ error: "Invalid or unauthorized image URL" }, { status: 400 });
      }
      if (!sourceFetch.response.ok) throw new Error("Failed to fetch source image");
      rawSourceBuffer = sourceFetch.buffer;
      sourceUrl = sourceFetch.finalUrl;
    }

    // ============================================================
    // ATOMIC CREDIT DEDUCTION — Step 1 ONLY, MANDATORY check
    // project.user_id is guaranteed non-null from check above.
    // ============================================================
    if (step === 1) {
      const { data: profile, error: profileErr } = await adminSupabase
        .from('profiles')
        .select('credits')
        .eq('id', project.user_id)
        .single();

      if (profileErr || !profile) {
        console.error('[Billing] Could not fetch profile:', profileErr);
        return NextResponse.json({ error: "INSUFFICIENT_CREDITS" }, { status: 403 });
      }

      if (profile.credits <= 0) {
        return NextResponse.json({ error: "INSUFFICIENT_CREDITS" }, { status: 403 });
      }

      // DEDUCT IMMEDIATELY — optimistic lock prevents double-spend
      const { error: deductErr, data: updatedData } = await adminSupabase
        .from('profiles')
        .update({ credits: profile.credits - 1 })
        .eq('id', project.user_id)
        .eq('credits', profile.credits) // only succeeds if credits haven't changed
        .select();

      if (deductErr) {
        console.error('[Billing] Deduction SQL error:', deductErr);
        return NextResponse.json({ error: "Billing error. Please try again." }, { status: 500 });
      }

      if (!updatedData || updatedData.length === 0) {
        // Condition failed — credits changed during transaction (race condition)
        return NextResponse.json({ error: "Conflict updating credits. Please try again." }, { status: 409 });
      }

      // Credit deducted successfully.
      await adminSupabase.from('credit_logs').insert({
        user_id: project.user_id,
        action: 'Extract & Vectorize',
        amount: -1
      });

      // Clear the refund/failure state for this NEW charge.
      // `refunded` used to be a one-way latch that nothing ever reset, so once a
      // project had been refunded a second attempt could be charged but never
      // refunded — the guard `.eq('refunded', false)` matched zero rows forever.
      // This write must succeed, otherwise the failure path cannot refund, so
      // unlike before its error is checked.
      const { error: flagErr } = await adminSupabase
        .from('projects')
        .update({
          credit_deducted: true,
          refunded: false,
        })
        .eq('id', projectId)
        .eq('user_id', user.id);

      // Clearing the failure stamp is best-effort and deliberately separate:
      // failed_at/failed_step only exist after add_project_failure_tracking.sql
      // has been run. Folding them into the update above would make every
      // generation fail on a deployment where the migration has not landed yet.
      await adminSupabase
        .from('projects')
        .update({ failed_at: null, failed_step: null })
        .eq('id', projectId)
        .eq('user_id', user.id);

      if (flagErr) {
        // If the columns themselves are absent, the deployment is simply ahead
        // of database/add_billing_columns.sql. Refunds cannot work in that
        // state (they never have), but generations must not hard-fail — so log
        // loudly and continue rather than taking every user's run down.
        const missingColumns = /column .* does not exist/i.test(flagErr.message || '');
        if (missingColumns) {
          console.error(
            '[Billing] CRITICAL: credit_deducted/refunded columns are missing — refunds are disabled. ' +
            'Run database/add_billing_columns.sql.'
          );
        } else {
          // A real write failure: give the claw straight back rather than
          // charging for a run we could never refund.
          console.error('[Billing] Could not set credit_deducted; refunding immediately:', flagErr.message);
          await safeRefundCredit(project.user_id);
          return NextResponse.json({ error: "Billing error. Please try again." }, { status: 500 });
        }
      }
    }

    if (step === 1) {
      // ==========================================
      // STAGE 1: fal.ai ESRGAN → nano-banana-pro
      // ==========================================

      // Read image metadata to calculate the closest allowed aspect ratio for fal.ai
      const sharp = (await import('sharp')).default;
      const metadata = await sharp(rawSourceBuffer).metadata();

      // Calculate closest aspect ratio for fal.ai Nano Banana Pro
      let targetAspectRatio = "auto";
      if (metadata && metadata.width && metadata.height) {
        const ratio = metadata.width / metadata.height;
        const allowedRatios = {
          "21:9": 21 / 9, "16:9": 16 / 9, "3:2": 3 / 2, "4:3": 4 / 3, "5:4": 5 / 4,
          "1:1": 1 / 1, "4:5": 4 / 5, "3:4": 3 / 4, "2:3": 2 / 3, "9:16": 9 / 16
        };
        let minDiff = Infinity;
        for (const [str, val] of Object.entries(allowedRatios)) {
          const diff = Math.abs(ratio - val);
          if (diff < minDiff) {
            minDiff = diff;
            targetAspectRatio = str;
          }
        }
      }

      const prompt = buildNanoBananaPrompt(project?.ai_prompt);
      const systemPrompt = buildNanoBananaSystemPrompt(project?.ai_prompt);
      const nanoBananaTuning = getNanoBananaInputTuning();

      let generatedImageBuffer;
      let generatedMimeType = "image/png";
      let geminiThinking = "Generated via OpenRouter Gemini 3.1 Flash Image";

      try {
        if (!process.env.FAL_KEY) {
          throw new Error("FAL_KEY is missing in environment variables. Please add it to your .env file.");
        }

        const { fal } = await import("@fal-ai/client");

        let finalImageUrl = sourceUrl;

        logger.debug("[fal.ai Input URL]", { finalImageUrl });

        // ── Step 1: Extract flat design directly using nano-banana-pro/edit ──
        // Feed original source image directly — no pre-upscale step.
        // Flow: Extract → Upscale (step 2) → Vectorize (step 3)
        logger.info("[API Step 1] Extracting flat design with fal.ai");

        // fal.subscribe polls the queue with no timeout of its own. Left
        // unbounded it can outlive maxDuration, and when the platform kills the
        // function mid-flight the catch block never runs — so the user is
        // charged with no server-side refund. Bound it with headroom for the
        // download, resize and R2 upload that still have to happen after this.
        const FAL_BUDGET_MS = 75_000;
        const result = await Promise.race([
          fal.subscribe("fal-ai/nano-banana-pro/edit", {
            input: {
              image_urls: [finalImageUrl],
              prompt: prompt,
              system_prompt: systemPrompt,
              aspect_ratio: targetAspectRatio,
              ...nanoBananaTuning,
            },
            logs: true,
            onQueueUpdate: (update) => {
              if (update.status === "IN_PROGRESS") {
                update.logs.map((log) => log.message).forEach((message) => logger.debug("[API Step 1] Provider log", { message }));
              }
            },
          }),
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error("The AI engine took too long to respond. Please try again.")),
              FAL_BUDGET_MS
            )
          ),
        ]);

        logger.debug("[fal.ai response images]", { count: result?.data?.images?.length ?? 0 });

        if (!result || !result.data || !result.data.images || result.data.images.length === 0) {
          throw new Error("fal.ai did not return a valid image URL. Response: " + JSON.stringify(result));
        }

        const outputUrl = result.data.images[0].url;
        const { response: imgRes, buffer: generatedBuffer } = await fetchWithSSRFProtection(outputUrl, {
          allowedHosts: getAllowedProviderHosts(),
          maxBytes: DEFAULT_MAX_IMAGE_BYTES,
          allowedContentTypes: ['image/'],
        });
        if (!imgRes.ok) throw new Error("Failed to download generated image from fal.ai URL");

        generatedImageBuffer = generatedBuffer;
        generatedMimeType = result.data.images[0].content_type || "image/jpeg";
        geminiThinking = "Generated via fal.ai Nano Banana Pro Edit";

        // ── Re-registration: restore the source aspect ratio ──
        // fal only accepts a fixed enum of aspect ratios, so `targetAspectRatio` is the
        // *nearest* match and can be several percent off the real source ratio. That
        // offset makes the before/after slider tear. Stretch the output back onto the
        // exact source ratio so the two layers register pixel-for-pixel. We scale up
        // rather than down so none of the 2K detail is thrown away.
        if (metadata?.width && metadata?.height) {
          try {
            const genMeta = await sharp(generatedBuffer).metadata();
            const sourceRatio = metadata.width / metadata.height;
            const generatedRatio = genMeta.width / genMeta.height;

            if (Math.abs(generatedRatio - sourceRatio) / sourceRatio > 0.005) {
              // Area-preserving reshape: keep roughly the same pixel budget the model
              // produced and just redistribute it onto the source ratio. Growing the
              // short edge instead (the obvious approach) inflates the image, and that
              // inflation then gets multiplied by the step-2 upscaler.
              const genArea = genMeta.width * genMeta.height;
              let targetH = Math.round(Math.sqrt(genArea / sourceRatio));
              let targetW = Math.round(targetH * sourceRatio);

              const MAX_EDGE = 4096;
              const longest = Math.max(targetW, targetH);
              if (longest > MAX_EDGE) {
                const shrink = MAX_EDGE / longest;
                targetW = Math.round(targetW * shrink);
                targetH = Math.round(targetH * shrink);
              }

              generatedImageBuffer = await sharp(generatedBuffer)
                .resize(targetW, targetH, { fit: 'fill', kernel: 'lanczos3' })
                // effort:1 like step 3 — full-effort PNG encoding on a 16MP
                // image costs seconds of the function's remaining budget for a
                // marginal size win.
                .png({ effort: 1 })
                .toBuffer();
              generatedMimeType = "image/png";
              logger.info("[Trace] Re-registered generated image", { from: `${genMeta.width}x${genMeta.height}`, to: `${targetW}x${targetH}`, sourceRatio: sourceRatio.toFixed(4) });
            }
          } catch (registrationErr) {
            // Non-fatal: a slightly mis-registered image still beats a failed generation.
            console.warn("[Trace] Aspect re-registration skipped:", registrationErr.message);
          }
        }

      } catch (err) {
        console.error("[fal.ai Error]:", err);
        if (err.body && err.body.detail) {
          console.error("[fal.ai Error Detail]:", JSON.stringify(err.body.detail, null, 2));
        }
        throw new Error(err.message || "Failed to generate image with fal.ai");
      }

      // Upload server-side and hand the client a URL.
      // Returning multi-MB base64 for the browser to POST back to /api/save-asset
      // blows the platform's ~4.5MB serverless request body cap and fails with a
      // 413 before the function even runs — which is invisible locally, where no
      // such cap exists. Step 2 already worked this way; step 1 now matches it.
      const extractExt = generatedMimeType === 'image/jpeg'
        ? 'jpg'
        : (generatedMimeType.split('/')[1] || 'png');
      const { uploadToR2 } = await import("@/lib/cloudflare");
      const extractedUrl = await uploadToR2(
        generatedImageBuffer,
        `projects/${projectId}/generated_flat_${Date.now()}.${extractExt}`,
        generatedMimeType
      );

      return NextResponse.json({
        success: true,
        step: 1,
        fileUrl: extractedUrl,
        mimeType: generatedMimeType,
        thinking: geminiThinking,
      });
    }

    if (step === 2) {
      // ==========================================
      // STAGE 2: AI UPSCALE WITH fal-ai/esrgan
      // ==========================================
      // User preferred an AI upscaler over local Sharp, but Clarity was too expensive ($0.13).
      // Real-ESRGAN (fal-ai/esrgan) provides excellent quality and is billed per compute second
      // ($0.00111/s). A typical upscale takes ~2s, costing ~$0.002 (₱0.10) per image.
      // ==========================================
      if (!project.generated_image_url || project.generated_image_url === 'REFUNDED') {
        return NextResponse.json({ error: "Step 1 (Auto-Trace) must be completed before upscaling." }, { status: 403 });
      }
      if (!process.env.FAL_KEY) throw new Error("FAL_KEY is missing in environment variables.");

      const { fal } = await import("@fal-ai/client");

      const upscaleInputUrl = normalizeUserImageUrl(project.generated_image_url, new URL(request.url).origin);
      if (!isOwnedStorageUrl(upscaleInputUrl, { userId: user.id, projectId }) || !(await validateUrlForSSRF(upscaleInputUrl, { allowedHosts: getAllowedStorageHosts() }))) {
        return NextResponse.json({ error: "Invalid or unauthorized generated image URL" }, { status: 400 });
      }

      // ── Adaptive upscale factor ──
      // A fixed 4x was sized for the old 1K step-1 output. Step 1 now emits 2K, and a
      // blind 4x on that produced a 6144x11160 PNG that blew past the 60MB save-asset
      // ceiling ("Remote file is too large"). Pick the factor from the actual input
      // dimensions so the result always lands under the cap.
      const UPSCALE_TARGET_EDGE = 6000;   // keep any single edge sane
      const UPSCALE_TARGET_PIXELS = 20e6; // and keep the encoded PNG well under 60MB
      let upscaleFactor = 4;
      try {
        const sharp = (await import('sharp')).default;
        const { buffer: stepOneBuffer } = await fetchWithSSRFProtection(upscaleInputUrl, {
          allowedHosts: getAllowedStorageHosts(),
          maxBytes: DEFAULT_MAX_IMAGE_BYTES,
          allowedContentTypes: ['image/'],
        });
        const stepOneMeta = await sharp(stepOneBuffer).metadata();
        const longestEdge = Math.max(stepOneMeta.width || 0, stepOneMeta.height || 0);
        const area = (stepOneMeta.width || 0) * (stepOneMeta.height || 0);
        if (longestEdge > 0 && area > 0) {
          const byEdge = UPSCALE_TARGET_EDGE / longestEdge;
          const byArea = Math.sqrt(UPSCALE_TARGET_PIXELS / area);
          // Round down to 0.5 steps so we never exceed either ceiling.
          upscaleFactor = Math.floor(Math.min(byEdge, byArea) * 2) / 2;
          upscaleFactor = Math.min(4, Math.max(1, upscaleFactor));
        }
        logger.info("[API Step 2] Measured step-1 image", { size: `${stepOneMeta.width}x${stepOneMeta.height}`, upscaleFactor });
      } catch (sizeErr) {
        // Could not measure — fall back to the conservative factor rather than 4x.
        upscaleFactor = 2;
        console.warn("[API Step 2] Could not measure step-1 image, defaulting to 2x:", sizeErr.message);
      }

      logger.info("[API Step 2] Upscaling with fal-ai/esrgan");

      const upscalerResult = await fal.subscribe("fal-ai/esrgan", {
        input: {
          image_url: upscaleInputUrl,
          scale: upscaleFactor,
        },
        logs: true,
        onQueueUpdate: (update) => {
          if (update.status === "IN_PROGRESS") {
            update.logs?.map((log) => log.message).forEach((message) => logger.debug("[API Step 2] Provider log", { message }));
          }
        },
      });

      logger.debug("[ESRGAN RAW Response]", upscalerResult?.data);

      const upscaledUrl = upscalerResult?.data?.image?.url || upscalerResult?.data?.image_url;
      if (!upscaledUrl) {
        throw new Error("fal-ai/esrgan did not return a valid image URL. Response: " + JSON.stringify(upscalerResult));
      }

      const upscaledMimeType = upscalerResult?.data?.image?.content_type || "image/jpeg";

      return NextResponse.json({ success: true, step: 2, fileUrl: upscaledUrl, mimeType: upscaledMimeType });

    }

    return NextResponse.json({ error: "Invalid step parameter" }, { status: 400 });

  } catch (error) {
    console.error(`[Trace API Error]:`, error.message);

    let didRefund = false;
    try {
      if (projectId) {
        // Record the failure. /api/refund requires this stamp, so a successful
        // run can no longer be passed off as a failed one.
        let stampQuery = adminSupabase
          .from('projects')
          .update({ failed_at: new Date().toISOString(), failed_step: `step${failedStep}` })
          .eq('id', projectId);
        if (userId) stampQuery = stampQuery.eq('user_id', userId);
        await stampQuery;

        // Only refund when the run produced nothing the user can keep.
        // Step 1 succeeding and step 2 failing is NOT refundable: the flat
        // extract is already saved and downloadable. The old code refunded
        // anyway AND overwrote generated_image_url with the string 'REFUNDED',
        // destroying the pointer to an R2 object the user had paid for.
        const { data: current } = await adminSupabase
          .from('projects')
          .select('user_id, credit_deducted, refunded, generated_image_url, upscaled_image_url, svg_url')
          .eq('id', projectId)
          .single();

        const hasUsableOutput = Boolean(
          current?.svg_url ||
          current?.upscaled_image_url ||
          (current?.generated_image_url && current.generated_image_url !== 'REFUNDED')
        );

        if (current?.credit_deducted && !current.refunded && !hasUsableOutput) {
          // Move the money FIRST, then mark it. The old order set refunded=true
          // before the transfer, so a failed transfer left the ledger and the
          // balance disagreeing with no way to retry.
          const credited = await safeRefundCredit(current.user_id);
          if (credited) {
            await adminSupabase
              .from('projects')
              .update({ generated_image_url: 'REFUNDED', refunded: true })
              .eq('id', projectId)
              .eq('user_id', current.user_id)
              .eq('refunded', false);
            await adminSupabase.from('credit_logs').insert({
              user_id: current.user_id,
              action: 'Refund',
              amount: 1,
            });
            didRefund = true;
          } else {
            console.error(`[Billing] safeRefundCredit FAILED for project ${projectId} — left unrefunded for retry.`);
          }
        }
      }
    } catch (refundErr) {
      console.error(`[Billing] Refund failed:`, refundErr.message);
    }

    // Never expose raw internal error messages (API keys, stack traces) to the client
    const isProviderError = error.message?.includes('FAL') || error.message?.includes('fal') || error.message?.includes('API');
    const safeMessage = isProviderError
      ? (didRefund
          ? 'AI processing failed. Your claw has been refunded automatically.'
          : 'AI processing failed. Please try again.')
      : (error.message || 'Failed to process trace step');
    return NextResponse.json({ error: safeMessage }, { status: 500 });
  }
}
