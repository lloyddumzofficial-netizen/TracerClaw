import { NextResponse } from "next/server";
import { uploadToR2 } from "@/lib/cloudflare";
import { adminSupabase, safeDeductCredit, safeRefundCredit } from "@/lib/supabase";
import { fetchWithRetry } from "@/lib/fetchWithRetry";
import { enforceRateLimit } from "@/lib/rateLimit";
import { segmentSvgLayers } from "@/lib/svgSegmenter";
import { DEFAULT_MAX_IMAGE_BYTES, DEFAULT_MAX_SVG_BYTES, DEFAULT_MAX_UPSCALED_IMAGE_BYTES, fetchWithSSRFProtection, getAllowedProviderHosts, getAllowedStorageHosts, isOwnedStorageUrl, validateUrlForSSRF } from "@/lib/ssrf";

export const runtime = 'nodejs';
export const maxDuration = 120; // 120s needed: ESRGAN output is large, Recraft vectorize takes time

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
    // Standard mode uses Recraft at the existing 1-credit pipeline cost.
    // Precision mode adds one extra credit at Step 3, for a total of 2 credits,
    // and calls Vectorizer.AI server-side with Basic auth.
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

    if (svgEngine === "precision") {
      const vectorizerApiId = process.env.VECTORIZER_API_ID;
      const vectorizerApiSecret = process.env.VECTORIZER_API_SECRET;

      if (!vectorizerApiId || !vectorizerApiSecret) {
        return NextResponse.json(
          { error: "Precision SVG engine is not configured yet. Please use Standard SVG for now." },
          { status: 503 }
        );
      }

      const deducted = await safeDeductCredit(user.id, 1);
      if (!deducted) {
        return NextResponse.json({ error: "INSUFFICIENT_CREDITS" }, { status: 403 });
      }
      precisionCreditDeducted = true;

      await adminSupabase.from('credit_logs').insert({
        user_id: user.id,
        action: 'Precision SVG Engine',
        amount: -1
      });

      const vectorizerFormData = new FormData();
      vectorizerFormData.append('image', blob, 'image.png');
      vectorizerFormData.append('output.file_format', 'svg');
      vectorizerFormData.append('output.svg.adobe_compatibility_mode', 'true');
      vectorizerFormData.append('output.svg.fixed_size', 'false');
      if (colors && colors !== "auto") {
        vectorizerFormData.append('processing.max_colors', String(parseInt(colors, 10)));
      }

      const basicAuth = Buffer.from(`${vectorizerApiId}:${vectorizerApiSecret}`).toString('base64');
      console.log("[Step 3] Sending to Vectorizer.AI precision engine...");
      const vectorizerRes = await fetchWithRetry("https://api.vectorizer.ai/api/v1/vectorize", {
        method: "POST",
        headers: { "Authorization": `Basic ${basicAuth}` },
        body: vectorizerFormData,
        signal: AbortSignal.timeout(110000),
      });

      if (!vectorizerRes.ok) {
        const errText = await vectorizerRes.text();
        throw new Error(`Precision vectorization failed: ${errText}`);
      }

      const svgArrayBuffer = await vectorizerRes.arrayBuffer();
      if (svgArrayBuffer.byteLength > DEFAULT_MAX_SVG_BYTES) {
        throw new Error("Precision SVG output is too large. Try cropping tighter or use Standard SVG.");
      }
      svgText = Buffer.from(svgArrayBuffer).toString('utf8');
    } else {
      const vectorizeFormData = new FormData();
      vectorizeFormData.append('image', blob, 'image.png');

      console.log("[Step 3] Sending to Recraft vectorize (RECRAFT_API_KEY)...");
      const recraftVectorRes = await fetchWithRetry("https://external.api.recraft.ai/v1/images/vectorize", {
        method: "POST",
        headers: { "Authorization": `Bearer ${process.env.RECRAFT_API_KEY}` },
        body: vectorizeFormData,
        signal: AbortSignal.timeout(110000), // 110s — large images need time to upload + process
      });

      if (!recraftVectorRes.ok) {
        const errText = await recraftVectorRes.text();
        throw new Error(`Vectorization failed: ${errText}`);
      }

      const vectorData = await recraftVectorRes.json();
      const vectorUrl = vectorData.image.url;

      const { response: svgRes, buffer: svgDownloadBuffer } = await fetchWithSSRFProtection(vectorUrl, {
        allowedHosts: getAllowedProviderHosts(),
        maxBytes: DEFAULT_MAX_SVG_BYTES,
        allowedContentTypes: ['image/svg+xml', 'text/plain', 'application/octet-stream'],
      });
      if (!svgRes.ok) throw new Error("Failed to fetch vectorized SVG");
      svgText = svgDownloadBuffer.toString('utf8');
    }

    // --- FIX FOR ADOBE ILLUSTRATOR "INVALID SVG" ERROR ---
    // 1. Remove markdown backticks if AI accidentally included them
    svgText = svgText.replace(/^```(xml|svg)?\n?/i, '').replace(/\n?```$/i, '').trim();
    
    // 2. Remove anything before the <svg> tag (like invalid <?xml ... ?> declarations)
    const svgStartMatch = svgText.match(/<svg[\s\S]*?>/i);
    if (svgStartMatch) {
      const startIndex = svgText.indexOf(svgStartMatch[0]);
      svgText = svgText.substring(startIndex);
    }

    // 3. Ensure xmlns is present
    if (!svgText.includes('xmlns="http://www.w3.org/2000/svg"')) {
      svgText = svgText.replace(/<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
    }

    // ─── Semantic Layer Grouping ──────────────────────────────────────────────
    // Post-processes the SVG to wrap paths in named <g id="layer-..."> groups.
    // Uses Gemini Flash vision on the ORIGINAL image (not the generated one) so
    // that layer classification is based on the user's actual design intent.
    // COMPLETELY NON-FATAL: falls back to saving the original SVG on any error.
    // ─────────────────────────────────────────────────────────────────────────
    try {
      // Fetch the original (pre-AI) image to give Gemini context about the design
      if (!isOwnedStorageUrl(project.original_image_url, { userId: user.id, projectId })) {
        throw new Error('Original image URL is not owned by this user/project');
      }
      const { response: originalImgRes, buffer: originalImgBuf } = await fetchWithSSRFProtection(project.original_image_url, {
        allowedHosts: getAllowedStorageHosts(),
        maxBytes: DEFAULT_MAX_IMAGE_BYTES,
        allowedContentTypes: ['image/'],
      });
      if (originalImgRes.ok) {
        const originalBase64 = originalImgBuf.toString('base64');
        const originalMime = originalImgRes.headers.get('content-type') || 'image/png';

        // Map project trace type to a context hint for Gemini
        const traceTypeHint = project.trace_type === 'logo' ? 'logo' : 'jersey';

        svgText = await segmentSvgLayers(svgText, originalBase64, originalMime, traceTypeHint);
      } else {
        console.warn('[Step 3] Could not fetch original image for segmentation — skipping');
      }
    } catch (segErr) {
      console.warn('[Step 3] Segmentation error (non-fatal):', segErr.message);
      // svgText remains unchanged — safe to continue
    }
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

    return NextResponse.json({
      success: true,
      step: 3,
      svg_url: finalSvgUrl
    });

  } catch (error) {
    console.error(`[Trace Step 3 Error]:`, error.message);
    
    // Attempt automatic refund on server-side failure
    try {
      if (precisionCreditDeducted && userId) {
        await safeRefundCredit(userId);
        await adminSupabase.from('credit_logs').insert({
          user_id: userId,
          action: 'Refund Precision SVG Engine',
          amount: 1
        });
      }

      if (projectId) {
        const { data: updatedProj } = await adminSupabase
          .from('projects')
          .update({ generated_image_url: 'REFUNDED', refunded: true })
          .eq('id', projectId)
          .eq('user_id', userId)
          .eq('credit_deducted', true)
          .eq('refunded', false)
          .select('user_id');
          
        if (updatedProj && updatedProj.length > 0) {
           await safeRefundCredit(updatedProj[0].user_id);
        }
      }
    } catch (refundErr) {
      console.error(`[Billing] Refund failed:`, refundErr.message);
    }

    return NextResponse.json({ error: "Failed to process trace step." }, { status: 500 });
  }
}
