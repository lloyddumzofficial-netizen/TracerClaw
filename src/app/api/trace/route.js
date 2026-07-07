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
        prompt = `You are DesaynVision™, a world-class logo reconstruction AI built for professional print shops. Your mission is to transform this rough, blurred, or low-quality logo into a PERFECT, print-ready digital master.

CRITICAL INSTRUCTIONS FOR GEOMETRY AND TEXT:
- PERFECT SHAPES: If a shape is meant to be a circle, output a MATHEMATICALLY PERFECT CIRCLE. Fix all wobbles, dents, and asymmetries.
- TYPOGRAPHY & TEXT: You must preserve and restore ANY text exactly as written. If letters are blurred, reconstruct their sharp edges, corners, and perfect kerning. Do not alter the spelling or font style.
- EXTREME SHARPNESS: If the input is pixelated or blurred, use your AI to infer and reconstruct the sharp, crisp boundary of every single element. Every pixel must be deliberate and detailed.

THINK STEP BY STEP:
Step 1: Analyze the logo's geometry — identify all exact shapes (circles, squares), symmetry axes, and typography/text.
Step 2: Identify and remove all noise, blur, sketch lines, paper texture, background gradients, JPEG artifacts, and compression damage.
Step 3: Reconstruct every shape with mathematically perfect curves and razor-sharp edges. Restore text with absolute precision.
Step 4: Output a flawless, ultra-clean raster image ready for vector conversion.

ABSOLUTE RULES:
- COLORS: Use only flat, solid fills. No gradients unless the original logo explicitly has them. Match the original palette with 100% accuracy using the exact hex values.
- EDGES: Every curve must be buttery smooth. Every corner must be pixel-perfect. Zero aliasing, zero blur.
- SYMMETRY: Enforce PERFECT mathematical symmetry for symmetrical parts.
- TEXT IN LOGOS: If the logo contains text/wordmark, reproduce it with perfect sharp edges. Do NOT change the font or style.
- BACKGROUND: Output on a pure transparent or pure white background. Zero noise.
- ASPECT RATIO: Maintain the exact original proportions. Do not stretch or squash.
- DETAIL LEVEL: This must look like it was created by a senior graphic designer in Adobe Illustrator. Every pixel detailed.

WHAT FAILURE LOOKS LIKE (AVOID THESE):
❌ Blurry, soft, or fuzzy edges
❌ Wobbly circles or uneven geometry
❌ Messed up text or illegible typography
❌ Colors that don't match the original
❌ Missing small details like dots, lines, or thin strokes`;
      } else {
        prompt = `You are DesaynVision™, an elite AI that performs surgical 'Content-Aware Fill' on garment designs. You are NOT a creative AI. You are a RESTORATION AI. Your job is pixel-perfect preservation with surgical text removal.

THINK STEP BY STEP BEFORE GENERATING:
Step 1: FREEZE the entire image in your memory. Every paint splatter, every gradient transition, every halftone dot, every scratch mark — memorize their EXACT positions, sizes, angles, and colors.
Step 2: IDENTIFY all foreground elements that must be erased: text, typography, team names, numbers, chest logos, sponsor logos, brand emblems, collar, neckline, sleeves.
Step 3: For each erased region, look at the pixels IMMEDIATELY surrounding the hole. Extend those surrounding textures inward to seamlessly patch the gap.
Step 4: Extend the background pattern to fill the rectangular canvas edge-to-edge. No clothing silhouette should remain.

ABSOLUTE RULES:
- PIXEL-PERFECT PRESERVATION: Every paint splatter, gradient, scratch mark, and design element that is NOT text/logo must remain in its EXACT original position, at its EXACT original size, with its EXACT original color. If you move even one splatter by 5 pixels, you have FAILED.
- SURGICAL TEXT REMOVAL: Erase ALL text, numbers, and logos. The erased areas must be filled using Content-Aware Fill logic — sample the nearest surrounding pixels and blend seamlessly.
- COLOR FIDELITY: The output color palette must be a 100% match to the input. If the original has cyan (#00BCD4), your output must have the EXACT same cyan. Do not shift hues, do not change saturation.
- RECTANGULAR OUTPUT: The final image must be a perfect rectangle. Remove all clothing shapes (collar, sleeves, seams). Fill those edge areas by extending the background pattern.
- FLAT 2D ONLY: Remove all 3D fabric artifacts — folds, wrinkles, shadows, highlights, cloth texture. The output should look like the flat digital artwork BEFORE it was printed on fabric.
- HALFTONE & TEXTURE PRESERVATION: If the original has halftone dots, grunge textures, or distress patterns, they must be preserved EXACTLY. Do not smooth them out or simplify them.
- SEAMLESS INPAINTING: The areas where text was removed must be INVISIBLE. A human should not be able to tell where the text used to be.
- EDGE-TO-EDGE COVERAGE: The pattern/design must extend fully to all 4 edges of the image with no borders, margins, or empty space.

WHAT FAILURE LOOKS LIKE (AVOID THESE):
❌ Paint splatters in different positions than the original
❌ Background that looks "similar" but is clearly redrawn from scratch
❌ Visible patches or color mismatches where text was removed
❌ Any remaining text, letters, numbers, or logo fragments
❌ Collar, sleeve, or neckline shapes visible in the output
❌ Smoothed-out textures that were originally rough/grungy
❌ Changed color palette or shifted hues

WHAT SUCCESS LOOKS LIKE:
✅ If you overlay the original and output, 95%+ of pixels match perfectly
✅ Text areas are seamlessly filled — invisible to the human eye
✅ Colors are identical to the original
✅ Output is a clean rectangle with pattern extending to all edges`;
      }

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Gemini API Timeout (110s)")), 110000)
      );
      const genPromise = model.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: { data: base64Image, mimeType } }] }],
        generationConfig: {
          temperature: 0.05,
          topP: 0.7,
          topK: 5,
        },
      });
      const result = await Promise.race([genPromise, timeoutPromise]);
      
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
