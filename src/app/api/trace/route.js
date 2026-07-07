import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { adminSupabase } from "@/lib/supabase";

// IMPORTANT: Must use Node.js runtime (not edge) so we get real 120s timeouts.
// Edge runtime on Vercel has a hard 30s cap which causes all Gemini generations to fail.
export const runtime = 'nodejs';
export const maxDuration = 120; // Vercel Pro plan allows up to 300s; 120s is safe

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

      // Mark the project as deducted so refunds are authorized
      await adminSupabase.from('projects').update({ credit_deducted: true }).eq('id', projectId);
    }

    if (step === 1) {
      // ==========================================
      // STAGE 1: GEMINI 3 PRO IMAGE -> RASTER PNG
      // ==========================================
      const model = genAI.getGenerativeModel({ model: "gemini-3-pro-image" });

      let base64Image;
      let mimeType = "image/png";

      const sourceUrl = croppedImageUrl || project.original_image_url;
      const imageResponse = await fetch(sourceUrl);
      if (!imageResponse.ok) throw new Error("Failed to fetch source image");
      const arrayBuffer = await imageResponse.arrayBuffer();
      base64Image = Buffer.from(arrayBuffer).toString("base64");
      mimeType = imageResponse.headers.get("content-type") || "image/png";

      let prompt = "";
      if (project.trace_type === 'logo') {
        prompt = `You are DesaynVision™, an elite AI built for 1:1 PIXEL-PERFECT logo restoration. You are NOT a generative artist. You are a strict HD Upscaler and Denoiser. Your ONLY job is to restore the original image without altering its design in any way.

CRITICAL INSTRUCTION - STRICT 1:1 REPLICATION:
- DO NOT REDRAW OR REINTERPRET: You are strictly forbidden from changing the shape, style, or layout of ANY element. 
- 100% EXACT ACCURACY: You must output a mathematically exact replica of the input image, just cleaner and higher resolution. 

TYPOGRAPHY & METALLIC/3D EFFECTS:
- EXACT FONT PRESERVATION: Never change the font. Preserve every single stylized edge, cut, and serif of the text exactly as shown (e.g. SQUAD ESPORTS).
- PRESERVE REFLECTIONS & GRADIENTS: If the text or mascot has a metallic reflection, 3D bevel, chrome effect, or complex gradient, YOU MUST COPY THE GRADIENT EXACTLY. DO NOT flatten it into ugly solid gray blocks.

CLEAN UP (YOUR ONLY ALLOWED CHANGES):
- ZERO BACKGROUND: Remove any real-world background (table, paper, fabric, noisy textures). Make the background pure solid or transparent.
- UNWARP SLANTED PHOTOS: If the photo is taken at a slanted angle, unwarp it so the logo is perfectly flat and symmetrical.
- REMOVE NOISE: Remove jpeg compression artifacts, camera blur, and speckles. Keep shapes razor-sharp.

WHAT FAILURE LOOKS LIKE (AVOID THESE AT ALL COSTS):
❌ Replacing stylized text with generic fonts or gibberish.
❌ Flattening beautiful metallic/3D gradients into ugly solid gray blocks.
❌ Changing the shape of mascot feathers, eyes, or outlines.
❌ Hallucinating or redrawing the design differently than the original.

WHAT SUCCESS LOOKS LIKE:
✅ A 1:1 exact pixel-perfect HD restoration of the original logo.
✅ All metallic reflections, gradients, and stylized fonts are perfectly preserved.`;
      } else {
        prompt = `You are DesaynVision™, an elite AI that performs surgical 'Content-Aware Fill' on sublimation garments and apparel designs. You are NOT a creative AI. Your job is pixel-perfect pattern restoration with surgical text removal.

CRITICAL INSTRUCTIONS - AVOID THE SHIRT SHAPE:
- RECTANGULAR EDGE-TO-EDGE CANVAS: You MUST COMPLETELY IGNORE the physical shape of the shirt. DO NOT output a torso shape, do not output sleeves, collars, or armholes. 
- FULL BLEED PATTERN: The output MUST be a perfect, solid rectangular canvas filled edge-to-edge with the background pattern. Extend all lines, shapes, and textures infinitely to the borders of the rectangular image.

SURGICAL TEXT REMOVAL & 99% ACCURACY:
- Identify and SURGICALLY ERASE all text, typography, chest logos, and sponsor names.
- Flawlessly reconstruct the underlying pattern to fill the gap. A human should not be able to tell where the text used to be. 
- Maintain 99% accuracy to the original geometry, angles, and layout of the background design.

CLEAN VECTOR-LIKE AESTHETICS (NO NOISE/DOTS):
- SOLID COLORS ONLY: Convert all messy, pixelated, or noisy textures into clean, solid, flat colors.
- NO HALFTONES OR SPECKLES: Completely eliminate any "dot patterns" (puntik-puntik), camera noise, artifacts, or print speckles.
- SMOOTH GRADIENTS: If there is a gradient, make it a perfectly smooth, clean, digital gradient without banding or noise.
- FLATTEN THE FABRIC: Erase all 3D fabric folds, wrinkles, shadows, camera highlights, and cloth textures.

WHAT FAILURE LOOKS LIKE (AVOID THESE):
❌ The output looks like the shape of a shirt, torso, or garment.
❌ Visible wrinkles, fabric folds, or shadows remaining.
❌ Noisy dot patterns, speckles, or muddy textures.
❌ Visible patches or color mismatches where text was removed.
❌ Any remaining text, letters, numbers, or logo fragments.

WHAT SUCCESS LOOKS LIKE:
✅ A perfect, solid rectangle filled with the design pattern.
✅ Clean, solid shapes with razor-sharp edges and smooth gradients.
✅ Text areas are seamlessly filled — invisible to the human eye.`;
      }

      let result;
      let retries = 3;
      while (retries > 0) {
        let timeoutId;
        try {
          const timeoutPromise = new Promise((_, reject) => {
            timeoutId = setTimeout(() => reject(new Error("Gemini API Timeout (300s) - The AI is taking too long to generate the image.")), 300000);
          });
          const genPromise = model.generateContent({
            contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: { data: base64Image, mimeType } }] }],
            generationConfig: {
              temperature: 0.05,
              topP: 0.7,
              topK: 5,
            },
          });
          result = await Promise.race([genPromise, timeoutPromise]);
          clearTimeout(timeoutId);
          break; // Success, exit retry loop
        } catch (err) {
          clearTimeout(timeoutId);
          retries--;
          if (retries === 0 || !err.message.includes("503")) {
            throw err; // Out of retries or not a 503 error
          }
          console.log(`[Gemini API] 503 High Demand. Retrying in 2 seconds... (${retries} retries left)`);
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
      
      // Extract the generated image
      const parts = result.response.candidates[0].content.parts;
      const imagePart = parts.find(p => p.inlineData && p.inlineData.mimeType.startsWith('image/'));
      const textPart = parts.find(p => p.text);
      const geminiThinking = textPart ? textPart.text : null;
      
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
          throw new Error("Gemini did not return a generated image.");
        }
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
      // STAGE 2: CRISP UPSCALE THE RASTER IMAGE (RECRAFT)
      // ==========================================
      if (!project.generated_image_url) throw new Error("No generated raster image found for Step 2");

      const rasterImgRes = await fetch(project.generated_image_url);
      if (!rasterImgRes.ok) throw new Error("Failed to fetch generated image from R2");
      const rasterImgBuffer = Buffer.from(await rasterImgRes.arrayBuffer());

      const ext = project.generated_image_url.split('.').pop();
      const mime = (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg' : 'image/png';
      const blob = new Blob([rasterImgBuffer], { type: mime });
      const upscaleFormData = new FormData();
      upscaleFormData.append('file', blob, `image.${ext}`);

      const recraftUpscaleRes = await fetch("https://external.api.recraft.ai/v1/images/crispUpscale", {
        method: "POST",
        headers: { "Authorization": `Bearer ${RECRAFT_API_KEY}` },
        body: upscaleFormData,
        signal: AbortSignal.timeout(120000),
      });

      if (!recraftUpscaleRes.ok) {
        const errText = await recraftUpscaleRes.text();
        throw new Error(`Upscaling failed: ${errText}`);
      }

      const upscaleData = await recraftUpscaleRes.json();
      const upscaledUrl = upscaleData.image.url;

      return NextResponse.json({ success: true, step: 2, fileUrl: upscaledUrl, mimeType: mime });
    }

    return NextResponse.json({ error: "Invalid step parameter" }, { status: 400 });

  } catch (error) {
    console.error(`[Trace API Error]:`, error.message);
    
    // Attempt automatic refund on server-side failure
    try {
      if (projectId) {
        const { data: proj } = await adminSupabase.from('projects').select('user_id').eq('id', projectId).single();
        if (proj?.user_id) {
          await adminSupabase.rpc('refund_credit', { target_user_id: proj.user_id, target_project_id: projectId });
        }
      }
    } catch (refundErr) {
      console.error(`[Billing] Refund failed:`, refundErr.message);
    }

    return NextResponse.json({ error: error.message || "Failed to process trace step" }, { status: 500 });
  }
}
