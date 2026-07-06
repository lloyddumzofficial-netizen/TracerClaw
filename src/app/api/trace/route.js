import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { uploadToR2 } from "@/lib/cloudflare";
import { supabase, adminSupabase } from "@/lib/supabase";

export const maxDuration = 60; 

const RECRAFT_API_KEY = process.env.RECRAFT_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

export async function POST(request) {
  let projectId;
  try {
    const body = await request.json();
    projectId = body.projectId;
    const { step, croppedImageUrl } = body;

    if (!projectId || !step) {
      return NextResponse.json({ error: "Missing required fields (projectId, step)" }, { status: 400 });
    }

    // ALWAYS use adminSupabase to fetch project — regular client has RLS
    // and may return null user_id if session is missing on server side
    const { data: project, error: projError } = await adminSupabase
      .from('projects')
      .select('*')
      .eq('id', projectId)
      .single();

    if (projError || !project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // HARD BLOCK: project must belong to a real user
    if (!project.user_id) {
      return NextResponse.json({ error: "Project has no owner. Please re-upload your image." }, { status: 403 });
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
        console.log(`[Billing] BLOCKED: User ${project.user_id} has ${profile.credits} credits.`);
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
        // Condition failed, means credits changed during transaction
        console.log(`[Billing] CONFLICT: Credits changed for user ${project.user_id} during deduction.`);
        return NextResponse.json({ error: "Conflict updating credits. Please try again." }, { status: 409 });
      }

      // Mark the project as deducted so refunds are authorized
      await adminSupabase.from('projects').update({ credit_deducted: true }).eq('id', projectId);

      console.log(`[Billing] SUCCESS: Deducted 1 credit from user ${project.user_id}. Remaining: ${profile.credits - 1}`);
    }

    if (step === 1) {
      // ==========================================
      // STAGE 1: GEMINI 3.1 FLASH IMAGE -> RASTER PNG
      // ==========================================
      console.log(`[API Step 1] Generating Image with Gemini 3.1 Flash Image for Project ${projectId}...`);
      const model = genAI.getGenerativeModel({ model: "gemini-3.1-flash-image" });

      let base64Image;
      let mimeType = "image/png";

      if (croppedImageUrl) {
        const imageResponse = await fetch(croppedImageUrl);
        if (!imageResponse.ok) throw new Error("Failed to fetch uploaded cropped image from R2");
        const arrayBuffer = await imageResponse.arrayBuffer();
        base64Image = Buffer.from(arrayBuffer).toString("base64");
        mimeType = imageResponse.headers.get("content-type") || "image/png";
      } else {
        const imageResponse = await fetch(project.original_image_url);
        if (!imageResponse.ok) throw new Error("Failed to fetch image from URL");
        const arrayBuffer = await imageResponse.arrayBuffer();
        base64Image = Buffer.from(arrayBuffer).toString("base64");
        mimeType = imageResponse.headers.get("content-type") || "image/png";
      }

      let prompt = "";
      if (project.trace_type === 'logo') {
        prompt = `You are an elite vectorization specialist AI. Recreate this logo or sketch perfectly. 
CRITICAL RULES:
1. PURE QUALITY: Output a high-contrast, flat raster image with ultra-crisp edges.
2. CLEANUP: Remove all sketch lines, noise, background gradients, and artifacts.
3. GEOMETRY: Ensure perfect symmetry and smooth curves. Use solid flat colors only. 
4. SVG-READY: The output must look like a perfectly finished, professional digital vector logo.`;
      } else {
        prompt = `You are a master Graphic Pattern Extractor AI (DesaynVision Core). Your ONLY job is to extract the pure, underlying 2D graphic background design/texture from the provided image and recreate it as a flawless, continuous flat canvas.

CRITICAL DIRECTIVES (YOU MUST OBEY EVERY SINGLE RULE WITHOUT EXCEPTION):

1. ABSOLUTELY NO TYPOGRAPHY OR TEXT (CRITICAL): You are STRICTLY FORBIDDEN from generating or reproducing any words, letters, numbers, fonts, typography, team names, or character symbols. If you see text in the original image (like team names or numbers), you MUST ERASE IT completely.
2. PAINT OVER ALL LOGOS: If there is a main chest logo, sponsor logo, or brand emblem, do NOT draw it. You MUST seamlessly paint over the area using the surrounding abstract background texture.
3. SEAMLESS BACKGROUND TEXTURE ONLY: Your final output must be 100% pure background texture/pattern. No foreground elements whatsoever. If the background has scratch marks, scales, waves, or honeycombs, extrapolate and fill the entire canvas with those background elements only.
4. RECTANGULAR CANVAS FORMAT: Do not draw a t-shirt, jersey, or clothing shape. Output a perfectly rectangular or square graphic pattern. The pattern must extend fully to all 4 edges of the image.
5. NO CLOTHING SILHOUETTES (ZERO TOLERANCE): Do NOT draw collars, necklines, sleeves, armholes, or seams. If your output resembles a piece of apparel, you have failed the objective. 
6. DESTROY ALL 3D ARTIFACTS: Eliminate all fabric folds, wrinkles, lighting shadows, highlights, and cloth textures. The output must look like a flat, digital 2D vector graphic before it was ever printed on a shirt.
7. EXACT COLOR MATCHING: You must perfectly preserve the exact color palette, gradients, and contrast of the original background pattern.
8. GEOMETRIC CONTINUITY: If there are lines, stripes, or repeating shapes in the background, ensure they flow continuously across the space where the text/logos used to be.
9. NO WATERMARKS: Do not generate any watermarks, signatures, or AI artifacts.
10. FINAL VERIFICATION: If the output contains even a single letter, number, or a shirt collar, you have FAILED completely. It must be a pure, flat, text-free texture.`;
      }

      let result;
      let retries = 3;
      for (let i = 0; i < retries; i++) {
        try {
          const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Gemini API Timeout (55s)")), 55000));
          const genPromise = model.generateContent({
            contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: { data: base64Image, mimeType } }] }],
            generationConfig: {
              temperature: 0.1, // Near zero temperature for strict instruction adherence and zero hallucinations
              topP: 0.8,
              topK: 10
            }
          });
          
          result = await Promise.race([genPromise, timeoutPromise]);
          break; // Success, exit retry loop
        } catch (genErr) {
          if (i === retries - 1) throw genErr; // Throw if last retry fails
          console.warn(`[Gemini API] Attempt ${i + 1} failed, retrying...`, genErr.message);
          await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1))); // 1s, 2s backoff
        }
      }
      
      // Extract the generated image
      const parts = result.response.candidates[0].content.parts;
      const imagePart = parts.find(p => p.inlineData && p.inlineData.mimeType.startsWith('image/'));
      
      let generatedImageBuffer;
      let generatedMimeType = "image/png";
      let generatedExt = "png";
      if (imagePart) {
        generatedImageBuffer = Buffer.from(imagePart.inlineData.data, "base64");
        generatedMimeType = imagePart.inlineData.mimeType || "image/png";
        generatedExt = generatedMimeType.split("/")[1] || "png";
        if (generatedExt === "jpeg") generatedExt = "jpg";
      } else {
        // Fallback: If it outputs a text URL instead (some SDKs do this for Imagen)
        const textResp = result.response.text();
        if (textResp.startsWith("http")) {
           const imgRes = await fetch(textResp);
           const arrBuf = await imgRes.arrayBuffer();
           generatedImageBuffer = Buffer.from(arrBuf);
        } else {
           throw new Error("Gemini did not return a generated image. Check gemini-3.1-flash-image SDK support.");
        }
      }

      const cfRasterFileName = `projects/${projectId}/generated_flat_${Date.now()}.${generatedExt}`;
      const finalRasterUrl = await uploadToR2(generatedImageBuffer, cfRasterFileName, generatedMimeType);

      await adminSupabase.from('projects').update({ generated_image_url: finalRasterUrl, ai_prompt: null }).eq('id', projectId);

      return NextResponse.json({ success: true, step: 1, generated_image_url: finalRasterUrl });
    }


    if (step === 2) {
      // ==========================================
      // STAGE 2: CRISP UPSCALE THE RASTER IMAGE (RECRAFT)
      // ==========================================
      console.log(`[API Step 2] Running Recraft Crisp Upscale for Project ${projectId}...`);
      if (!project.generated_image_url) throw new Error("No generated raster image found for Step 2");

      const rasterImgRes = await fetch(project.generated_image_url);
      if (!rasterImgRes.ok) throw new Error("Failed to fetch generated image from R2");
      const rasterImgBuffer = Buffer.from(await rasterImgRes.arrayBuffer());

      const upscaleFormData = new FormData();
      const ext = project.generated_image_url.split('.').pop();
      const mime = (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg' : 'image/png';
      const blob = new Blob([rasterImgBuffer], { type: mime });
      upscaleFormData.append('file', blob, `image.${ext}`);

      const recraftUpscaleRes = await fetch("https://external.api.recraft.ai/v1/images/crispUpscale", {
        method: "POST",
        headers: { "Authorization": `Bearer ${RECRAFT_API_KEY}` },
        body: upscaleFormData,
        signal: AbortSignal.timeout(55000)
      });

      if (!recraftUpscaleRes.ok) {
        const errText = await recraftUpscaleRes.text();
        throw new Error(`Upscaling failed: ${errText}`);
      }

      const upscaleData = await recraftUpscaleRes.json();
      const upscaledUrl = upscaleData.image.url;

      // Download and save to R2
      const upscaledImgRes = await fetch(upscaledUrl);
      const upscaledImgBuffer = Buffer.from(await upscaledImgRes.arrayBuffer());
      const cfUpscaledFileName = `projects/${projectId}/upscaled_${Date.now()}.${ext}`;
      const finalUpscaledUrl = await uploadToR2(upscaledImgBuffer, cfUpscaledFileName, mime);

      await supabase.from('projects').update({ upscaled_image_url: finalUpscaledUrl }).eq('id', projectId);

      return NextResponse.json({ success: true, step: 2, upscaled_image_url: finalUpscaledUrl });
    }

    if (step === 3) {
      // ==========================================
      // STAGE 3: VECTORIZE THE UPSCALED IMAGE (RECRAFT)
      // ==========================================
      console.log(`[API Step 3] Running Recraft Vectorizer for Project ${projectId}...`);
      if (!project.upscaled_image_url) throw new Error("No upscaled image found for Step 3");

      const rasterImgRes = await fetch(project.upscaled_image_url);
      if (!rasterImgRes.ok) throw new Error("Failed to fetch upscaled image from R2");
      const rawBuffer = Buffer.from(await rasterImgRes.arrayBuffer());

      // Convert image to lossless PNG to prevent JPEG compression artifacts during vectorization
      const sharp = (await import('sharp')).default;
      const compressedBuffer = await sharp(rawBuffer)
        .resize({ width: 1536, height: 1536, fit: 'inside', withoutEnlargement: true })
        .png({ effort: 7 })
        .toBuffer();
      console.log(`[API Step 3] Original: ${rawBuffer.length} bytes → PNG Compressed: ${compressedBuffer.length} bytes`);

      const vectorizeFormData = new FormData();
      const blob = new Blob([compressedBuffer], { type: 'image/png' });
      vectorizeFormData.append('image', blob, 'image.png');

      const recraftVectorRes = await fetch("https://external.api.recraft.ai/v1/images/vectorize", {
        method: "POST",
        headers: { "Authorization": `Bearer ${RECRAFT_API_KEY}` },
        body: vectorizeFormData,
        signal: AbortSignal.timeout(55000)
      });

      if (!recraftVectorRes.ok) {
        const errText = await recraftVectorRes.text();
        throw new Error(`Vectorization failed: ${errText}`);
      }

      const vectorData = await recraftVectorRes.json();
      const vectorUrl = vectorData.image.url;

      const svgRes = await fetch(vectorUrl);
      const svgBuffer = Buffer.from(await svgRes.arrayBuffer());
      const cfSvgFileName = `projects/${projectId}/vector_${Date.now()}.svg`;
      const finalSvgUrl = await uploadToR2(svgBuffer, cfSvgFileName, "image/svg+xml");

      await supabase.from('projects').update({ svg_url: finalSvgUrl }).eq('id', projectId);

      console.log(`[Billing] Step 3 complete. Credit was already deducted in Step 1.`);

      return NextResponse.json({ success: true, step: 3, svg_url: finalSvgUrl });
    }

    return NextResponse.json({ error: "Invalid step parameter" }, { status: 400 });

  } catch (error) {
    console.error(`[Trace API Error]:`, error);
    
    // Attempt automatic refund on server-side failure
    try {
      if (typeof projectId !== 'undefined' && projectId) {
        const { data: proj } = await adminSupabase.from('projects').select('user_id').eq('id', projectId).single();
        if (proj && proj.user_id) {
          await adminSupabase.rpc('refund_credit', { target_user_id: proj.user_id, target_project_id: projectId });
          console.log(`[Billing] 🔄 Refund executed for project ${projectId} due to error`);
        }
      }
    } catch (refundErr) {
      console.error(`[Billing] Failed to process automatic refund:`, refundErr);
    }

    return NextResponse.json({ error: error.message || "Failed to process trace step" }, { status: 500 });
  }
}
