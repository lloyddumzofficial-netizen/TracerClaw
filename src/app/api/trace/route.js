import { NextResponse } from "next/server";
import { adminSupabase, safeRefundCredit } from "@/lib/supabase";
import { enforceRateLimit } from "@/lib/rateLimit";
import { DEFAULT_MAX_IMAGE_BYTES, fetchWithSSRFProtection, getAllowedProviderHosts, getAllowedStorageHosts, isOwnedStorageUrl, normalizeUserImageUrl, validateUrlForSSRF } from "@/lib/ssrf";
import { buildNanoBananaPrompt, getNanoBananaInputTuning, isPatternOnlyPrompt } from "@/lib/tracePrompts";

// IMPORTANT: Must use Node.js runtime (not edge) so we get real 120s timeouts.
// Edge runtime on Vercel has a hard 30s cap which causes all Gemini generations to fail.
export const runtime = 'nodejs';
export const maxDuration = 120; // Vercel Pro plan allows up to 300s; 120s is safe

export async function POST(request) {
  let projectId;
  let userId;
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

      await adminSupabase
        .from('projects')
        .update({ credit_deducted: true })
        .eq('id', projectId)
        .eq('user_id', user.id);
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
      const isPatternOnlyExtraction = isPatternOnlyPrompt(project?.ai_prompt);
      const nanoBananaTuning = getNanoBananaInputTuning(project?.ai_prompt);

      let generatedImageBuffer;
      let generatedMimeType = "image/png";
      let geminiThinking = "Generated via OpenRouter Gemini 3.1 Flash Image";

      try {
        if (!process.env.FAL_KEY) {
          throw new Error("FAL_KEY is missing in environment variables. Please add it to your .env file.");
        }

        const { fal } = await import("@fal-ai/client");

        let finalImageUrl = sourceUrl;

        console.log("[fal.ai Input URL]:", finalImageUrl);

        // ── Step 1: Extract flat design directly using nano-banana-pro/edit ──
        // Feed original source image directly — no pre-upscale step.
        // Flow: Extract → Upscale (step 2) → Vectorize (step 3)
        console.log("[API Step 1] Extracting flat design with fal.ai (nano-banana-pro/edit)...");

        const result = await fal.subscribe("fal-ai/nano-banana-pro/edit", {
          input: {
            image_urls: [finalImageUrl],
            prompt: prompt,
            aspect_ratio: targetAspectRatio,
            ...nanoBananaTuning,
          },
          logs: true,
          onQueueUpdate: (update) => {
            if (update.status === "IN_PROGRESS") {
              update.logs.map((log) => log.message).forEach(console.log);
            }
          },
        });

        console.log("[fal.ai RAW Response]:", JSON.stringify(result, null, 2));

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

      } catch (err) {
        console.error("[fal.ai Error]:", err);
        if (err.body && err.body.detail) {
          console.error("[fal.ai Error Detail]:", JSON.stringify(err.body.detail, null, 2));
        }
        throw new Error(err.message || "Failed to generate image with fal.ai");
      }

      return NextResponse.json({
        success: true,
        step: 1,
        base64: generatedImageBuffer.toString('base64'),
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

      console.log("[API Step 2] Upscaling with fal-ai/esrgan...");

      const upscalerResult = await fal.subscribe("fal-ai/esrgan", {
        input: {
          image_url: upscaleInputUrl,
          scale: 4, // 4x upscale (increased from 2x)
        },
        logs: true,
        onQueueUpdate: (update) => {
          if (update.status === "IN_PROGRESS") {
            update.logs?.map((log) => log.message).forEach(console.log);
          }
        },
      });

      console.log("[ESRGAN RAW Response]:", JSON.stringify(upscalerResult?.data, null, 2));

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

    // Attempt automatic refund on server-side failure
    try {
      if (projectId) {
        let refundQuery = adminSupabase
          .from('projects')
          .update({ generated_image_url: 'REFUNDED', refunded: true })
          .eq('id', projectId)
          .eq('credit_deducted', true)
          .eq('refunded', false)
        if (userId) {
          refundQuery = refundQuery.eq('user_id', userId);
        }
        const { data: updatedProj } = await refundQuery.select('user_id');

        if (updatedProj && updatedProj.length > 0) {
          await safeRefundCredit(updatedProj[0].user_id);
        }
      }
    } catch (refundErr) {
      console.error(`[Billing] Refund failed:`, refundErr.message);
    }

    // Never expose raw internal error messages (API keys, stack traces) to the client
    const safeMessage = error.message?.includes('FAL') || error.message?.includes('fal') || error.message?.includes('API')
      ? 'AI processing failed. Your credit has been refunded automatically.'
      : (error.message || 'Failed to process trace step');
    return NextResponse.json({ error: safeMessage }, { status: 500 });
  }
}
