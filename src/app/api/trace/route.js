import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { uploadToR2 } from "@/lib/cloudflare";
import { supabase } from "@/lib/supabase";
import { createClient } from "@supabase/supabase-js";

export const maxDuration = 60; 

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const RECRAFT_API_KEY = process.env.RECRAFT_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

export async function POST(request) {
  let projectId;
  try {
    const body = await request.json();
    projectId = body.projectId;
    const { step, croppedBase64 } = body;

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
      const { error: deductErr, count } = await adminSupabase
        .from('profiles')
        .update({ credits: profile.credits - 1 })
        .eq('id', project.user_id)
        .eq('credits', profile.credits) // only succeeds if credits haven't changed
        .select();

      if (deductErr) {
        console.error('[Billing] Deduction SQL error:', deductErr);
        return NextResponse.json({ error: "Credit deduction failed, please try again." }, { status: 500 });
      }

      // Mark the project as deducted so refunds are authorized
      await adminSupabase.from('projects').update({ credit_deducted: true }).eq('id', projectId);

      console.log(`[Billing] ✅ DEDUCTED 1 credit from ${project.user_id}. Now: ${profile.credits - 1}`);
    }

    if (step === 1) {
      // ==========================================
      // STAGE 1: GEMINI VISION + RECRAFT GENERATION
      // ==========================================
      console.log(`[API Step 1] Analyzing Image with Gemini 1.5 Flash for Project ${projectId}...`);
      
      let base64Image;
      let mimeType = "image/png";

      if (croppedBase64) {
        const split = croppedBase64.split(",");
        base64Image = split[1];
        mimeType = split[0].split(":")[1].split(";")[0];
      } else {
        const imageResponse = await fetch(project.original_image_url);
        if (!imageResponse.ok) throw new Error("Failed to fetch image from URL");
        const arrayBuffer = await imageResponse.arrayBuffer();
        base64Image = Buffer.from(arrayBuffer).toString("base64");
        mimeType = imageResponse.headers.get("content-type") || "image/png";
      }

      // 1. GEMINI VISION ANALYSIS (Fast & Reliable)
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      
      const visionPrompt = `Analyze this image and describe the main subject/logo in exact visual detail. 
Ignore the background entirely (assume it will be removed). Ignore any text or watermarks. 
Output ONLY a highly descriptive prompt that an image generator can use to perfectly recreate this flat digital graphic. Keep it under 40 words.`;

      let geminiAnalysis = "";
      try {
        const result = await model.generateContent({
          contents: [{ role: "user", parts: [{ text: visionPrompt }, { inlineData: { data: base64Image, mimeType } }] }]
        });
        geminiAnalysis = result.response.text().trim();
        console.log(`[Gemini Analysis]: ${geminiAnalysis}`);
      } catch (genErr) {
        console.warn(`[Gemini API Failed]: ${genErr.message}. Falling back to default prompt.`);
        geminiAnalysis = "A clean, flat digital graphic illustration of the uploaded subject, perfectly isolated.";
      }

      // 2. RECRAFT RASTER GENERATION
      console.log(`[API Step 1] Generating Pristine Graphic using Recraft...`);
      const recraftRes = await fetch("https://external.api.recraft.ai/v1/images/generations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${RECRAFT_API_KEY}`
        },
        body: JSON.stringify({
          prompt: `${geminiAnalysis}. Pure flat digital 2D vector style art, solid colors, clean edges, white background. NO TEXT, NO WATERMARKS.`,
          style: "vector_illustration",
          size: "1024x1024"
        })
      });

      if (!recraftRes.ok) {
        const errText = await recraftRes.text();
        throw new Error(`Recraft Generation Failed: ${errText}`);
      }

      const recraftData = await recraftRes.json();
      const generatedImageUrl = recraftData.data[0].url;

      // Download from Recraft and upload to R2
      const imgRes = await fetch(generatedImageUrl);
      const arrBuf = await imgRes.arrayBuffer();
      const generatedImageBuffer = Buffer.from(arrBuf);
      
      const cfRasterFileName = `projects/${projectId}/generated_flat_${Date.now()}.png`;
      const finalRasterUrl = await uploadToR2(generatedImageBuffer, cfRasterFileName, "image/png");

      await adminSupabase.from('projects').update({ 
        generated_image_url: finalRasterUrl, 
        ai_prompt: geminiAnalysis 
      }).eq('id', projectId);

      return NextResponse.json({ success: true, step: 1, generated_image_url: finalRasterUrl });
    }
        prompt = `You are an elite vectorization specialist AI. Recreate this logo or sketch perfectly. 
CRITICAL RULES:
1. PURE QUALITY: Output a high-contrast, flat raster image with ultra-crisp edges.
2. CLEANUP: Remove all sketch lines, noise, background gradients, and artifacts.
3. GEOMETRY: Ensure perfect symmetry and smooth curves. Use solid flat colors only. 
4. SVG-READY: The output must look like a perfectly finished, professional digital vector logo.`;
      } else {
        prompt = `You are a master Sublimation & Graphic Pattern Extractor. Extract the EXACT flat graphic from the t-shirt mockup.
CRITICAL RULES (FOLLOW STRICTLY):
1. NO TEXT OR LOGOS (EXTREMELY IMPORTANT): YOU MUST DELETE AND ERASE ALL LETTERS, NUMBERS, WORDS, TYPOGRAPHY, "TEAM NAME", "00", LOGOS, OR WATERMARKS. IF THERE IS TEXT IN THE ORIGINAL IMAGE, DO NOT DRAW IT. SEAMLESSLY CLONE THE SURROUNDING BACKGROUND/PATTERN INSTEAD. FAILURE TO REMOVE TEXT IS UNACCEPTABLE.
2. EXACT COLOR MATCHING (CRITICAL): You MUST preserve the EXACT original colors, hues, and gradients. Do NOT change the color palette. If the original image has bright orange/yellow gradients, your output MUST have those exact same colors. Do not grayscale or alter the vibrancy.
3. PIXEL-PERFECT CLONING: Copy every texture, honeycomb, splatter, or intricate geometric pattern exactly. DO NOT simplify.
4. ABSOLUTE FLATTENING: Remove all folds, wrinkles, highlights, shadows, and fabric textures. Return ONLY the pure 2D digital artwork.
Output the purest, highest-quality flattened design possible with ZERO TEXT and EXACT ORIGINAL COLORS.`;
      }

      let result;
      let retries = 3;
      for (let i = 0; i < retries; i++) {
        try {
          result = await model.generateContent({
            contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: { data: base64Image, mimeType } }] }],
            generationConfig: {
              temperature: 0.1, // Near zero temperature for strict instruction adherence and zero hallucinations
              topP: 0.8,
              topK: 10
            }
          });
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
           throw new Error("Gemini did not return a generated image. Check gemini-3-pro-image SDK support.");
        }
      }

      const cfRasterFileName = `projects/${projectId}/generated_flat_${Date.now()}.${generatedExt}`;
      const finalRasterUrl = await uploadToR2(generatedImageBuffer, cfRasterFileName, generatedMimeType);

      // Update DB (Clear ai_prompt since we don't use it anymore)
      await supabase.from('projects').update({ generated_image_url: finalRasterUrl, ai_prompt: null }).eq('id', projectId);

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
        body: upscaleFormData
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

      // Compress image to stay under Recraft's ~8MB size limit
      const sharp = (await import('sharp')).default;
      const compressedBuffer = await sharp(rawBuffer)
        .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer();
      console.log(`[API Step 3] Original: ${rawBuffer.length} bytes → Compressed: ${compressedBuffer.length} bytes`);

      const vectorizeFormData = new FormData();
      const blob = new Blob([compressedBuffer], { type: 'image/jpeg' });
      vectorizeFormData.append('image', blob, 'image.jpg');
      vectorizeFormData.append('model', 'recraftv4_1_pro_vector');

      const recraftVectorRes = await fetch("https://external.api.recraft.ai/v1/images/vectorize", {
        method: "POST",
        headers: { "Authorization": `Bearer ${RECRAFT_API_KEY}` },
        body: vectorizeFormData
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
