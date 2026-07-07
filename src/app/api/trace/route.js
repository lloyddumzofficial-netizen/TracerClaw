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
        prompt = `You are DesaynVision™, a world-class logo reconstruction AI built for professional print shops. Your mission is to transform this raw photo into a PERFECT, print-ready 2D digital master.

CRITICAL INSTRUCTIONS FOR GEOMETRY AND PERSPECTIVE (THE "OBLONG" FIX):
- PERSPECTIVE UNWARPING: The input is likely a photo taken from a mobile phone at a slanted angle. If a shape is clearly intended to be a perfect circle but appears "oblong" or "skewed" due to the camera angle, YOU MUST UNWARP IT. Output a MATHEMATICALLY PERFECT CIRCLE. 
- TRUE GEOMETRY: If it's a square, make it a perfect square. Fix all perspective distortions, wobbles, dents, and asymmetries caused by camera lenses or folded paper/fabric.

BACKGROUND REMOVAL & TRUE COLORS:
- ZERO BACKGROUND: Completely eliminate all real-world elements: fabric, paper texture, table backgrounds, shadows, camera flash reflections, and lighting gradients. 
- PURE TRANSPARENCY/WHITE: The output MUST be on a pure transparent or pure solid white background.
- EXACT COLOR INFERENCE: Extract the "true" brand colors. Ignore the dark shadows or bright highlights caused by the phone's lighting. Output solid, flat colors only.

CUSTOM SHAPE PERFECTION:
- DEEP SHAPE ANALYSIS: For custom logos (shields, crests, mascots, abstract geometric shapes), analyze their intended symmetry and form. Reconstruct them with absolute precision, razor-sharp edges, and perfect curves.

TYPOGRAPHY & TEXT: 
- Preserve and restore ANY text exactly as written. If letters are blurred or skewed, reconstruct their sharp edges and perfect kerning. Do not alter the spelling.

WHAT FAILURE LOOKS LIKE (AVOID THESE):
❌ Oblong circles or skewed perspective (FAIL to unwarp)
❌ Retaining background textures, shadows, or lighting flashes
❌ Blurry, soft, or fuzzy edges
❌ Wobbly lines or uneven geometry
❌ Messed up text or illegible typography
❌ Colors that don't match the true intended brand palette
❌ Missing small details like dots, lines, or thin strokes`;
      } else {
        prompt = `You are DesaynVision™, an elite AI that performs surgical 'Content-Aware Fill' on sublimation garments and apparel designs. You are NOT a creative AI. Your job is pixel-perfect pattern restoration with surgical text removal.

SUBLIMATION GARMENT MASTERY:
- FLATTEN THE FABRIC: You are looking at a physical photo of a printed sublimation garment (jersey, t-shirt, sportswear). You MUST reconstruct the original 2D digital template. 
- REMOVE 3D ARTIFACTS: Completely erase all fabric folds, wrinkles, shadows, camera highlights, collar curves, sleeve seams, and cloth textures. The output must look like flat digital artwork BEFORE it was printed.
- SEAMLESS PATTERN RECONSTRUCTION: Sublimation garments often have complex all-over-print patterns, abstract shapes, or gradients. When you erase a logo or text, you must flawlessly reconstruct the underlying pattern so no "patchy" spot remains.

THINK STEP BY STEP BEFORE GENERATING:
Step 1: IDENTIFY all foreground elements that must be erased: text, typography, team names, numbers, chest logos, sponsor logos, brand emblems.
Step 2: ANALYZE the underlying sublimation pattern and colors. Ignore lighting shadows.
Step 3: SURGICALLY ERASE the text/logos and seamlessly extend the surrounding pattern to fill the gap.
Step 4: FLATTEN the image. Remove the physical shape of the shirt (neckline, sleeves). Extend the background pattern to fill a perfect rectangular canvas edge-to-edge.

ABSOLUTE RULES:
- PIXEL-PERFECT PRESERVATION: Non-text elements (paint splatters, graphic shapes, stripes) must remain in their EXACT original positions and sizes.
- SURGICAL TEXT REMOVAL: The erased areas must be filled seamlessly. A human should not be able to tell where the text used to be.
- TRUE COLOR FIDELITY: Ignore dark shadows in folds or bright flashes from the camera. Extract and output the TRUE, flat original colors of the design.
- RECTANGULAR OUTPUT: Remove all clothing silhouettes.

WHAT FAILURE LOOKS LIKE (AVOID THESE):
❌ Visible wrinkles, fabric folds, or shadows remaining in the output
❌ Collar, sleeve, or neckline shapes visible in the output
❌ Visible patches or color mismatches where text was removed
❌ Any remaining text, letters, numbers, or logo fragments
❌ Background that looks "similar" but is clearly redrawn from scratch

WHAT SUCCESS LOOKS LIKE:
✅ Looks exactly like the original 2D digital illustrator template
✅ Text areas are seamlessly filled — invisible to the human eye
✅ Output is a clean flat rectangle with the pattern extending to all edges`;
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
