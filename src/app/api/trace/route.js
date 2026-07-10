import { NextResponse } from "next/server";
import { adminSupabase, safeRefundCredit } from "@/lib/supabase";
import { fetchWithRetry } from "@/lib/fetchWithRetry";
import { validateUrlForSSRF } from "@/lib/ssrf";

// IMPORTANT: Must use Node.js runtime (not edge) so we get real 120s timeouts.
// Edge runtime on Vercel has a hard 30s cap which causes all Gemini generations to fail.
export const runtime = 'nodejs';
export const maxDuration = 120; // Vercel Pro plan allows up to 300s; 120s is safe

const RECRAFT_API_KEY = process.env.RECRAFT_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
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
      // STAGE 1: OPENROUTER GEMINI -> RASTER PNG
      // ==========================================

      let base64Image;
      let mimeType = "image/png";

      const sourceUrl = croppedImageUrl || project.original_image_url;
      if (!(await validateUrlForSSRF(sourceUrl))) {
        return NextResponse.json({ error: "Invalid or unauthorized image URL" }, { status: 400 });
      }
      const imageResponse = await fetch(sourceUrl);
      if (!imageResponse.ok) throw new Error("Failed to fetch source image");
      const arrayBuffer = await imageResponse.arrayBuffer();
      const rawBuffer = Buffer.from(arrayBuffer);
      
      const sharp = (await import('sharp')).default;
      const metadata = await sharp(rawBuffer).metadata();
      
      // Calculate closest aspect ratio for fal.ai Nano Banana Pro
      let targetAspectRatio = "auto";
      if (metadata && metadata.width && metadata.height) {
         const ratio = metadata.width / metadata.height;
         const allowedRatios = {
             "21:9": 21/9, "16:9": 16/9, "3:2": 3/2, "4:3": 4/3, "5:4": 5/4,
             "1:1": 1/1, "4:5": 4/5, "3:4": 3/4, "2:3": 2/3, "9:16": 9/16
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
      
      // Compress image to prevent timeouts for massive files
      // MAX 1024x1024 to ensure processing finishes well under Google's 300s load balancer timeout
      const compressedBuffer = await sharp(rawBuffer)
        .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer();
        
      base64Image = compressedBuffer.toString("base64");
      let prompt = "";
      if (project) {
        if (project.ai_prompt === 'FLATTEN') {
          prompt = `A perfectly flat, 2D rectangular vector pattern wallpaper. DO NOT DRAW A SHIRT.
          
CRITICAL RULES:
1. NO CLOTHING SHAPES: You are forbidden from drawing a torso, neck hole, collar, shoulders, or sleeves. 
2. RECTANGULAR CANVAS ONLY: The output must be a pure, solid rectangle filled edge-to-edge with the background pattern and design elements.
3. EXTEND THE DESIGN: Extend all lines, shapes, and stripes infinitely to the absolute edges of the image. 

STRICT 1:1 REPLICATION:
- Output a mathematically exact replica of all logos and designs present.
- EXACT FONT PRESERVATION: Never change the font. 
- Convert all textures into clean, solid, flat vector-like colors. Erase all 3D fabric folds and wrinkles.`;
        } else if (project.ai_prompt === 'ERASE_LOGOS') {
          prompt = `A perfectly flat, 2D rectangular vector pattern wallpaper. DO NOT DRAW A SHIRT.
          
CRITICAL RULES:
1. NO CLOTHING SHAPES: You are forbidden from drawing a torso, neck hole, collar, shoulders, or sleeves.
2. RECTANGULAR CANVAS ONLY: The output must be a pure, solid rectangle filled edge-to-edge with the background pattern.
3. EXTEND THE DESIGN: Extend all lines, shapes, and stripes infinitely to the absolute edges of the image.

TEXT AND LOGO REMOVAL:
- Please remove all typography, text, numbers, sponsors, and chest logos.
- Flawlessly reconstruct the underlying background pattern (the stripes and shapes) to fill the gaps where the text used to be.

Convert all textures into clean, solid, flat vector-like colors. Erase all 3D fabric folds and wrinkles.`;
        } else {
          prompt = `A perfectly flat, 2D rectangular vector pattern wallpaper. DO NOT DRAW A SHIRT.
          
CRITICAL RULES:
1. NO CLOTHING SHAPES: You are forbidden from drawing a torso, neck hole, collar, shoulders, or sleeves. 
2. RECTANGULAR CANVAS ONLY: The output must be a pure, solid rectangle filled edge-to-edge with the background pattern and design elements.
3. EXTEND THE DESIGN: Extend all lines, shapes, and stripes infinitely to the absolute edges of the image. 

STRICT 1:1 REPLICATION:
- Output a mathematically exact replica of all logos and designs present.
- EXACT FONT PRESERVATION: Never change the font. 
- Convert all textures into clean, solid, flat vector-like colors. Erase all 3D fabric folds and wrinkles.`;
        }
      }

      let generatedImageBuffer;
      let generatedMimeType = "image/png";
      let geminiThinking = "Generated via OpenRouter Gemini 3.1 Flash Image";

      try {
        if (!process.env.FAL_KEY) {
          throw new Error("FAL_KEY is missing in environment variables. Please add it to your .env file.");
        }

        const { fal } = await import("@fal-ai/client");
        
        let finalImageUrl = sourceUrl;
        
        // Sometimes the URL is passed as /api/proxy?url=https%3A%2F%2F...
        // Or http://localhost:3000/api/proxy?url=https%3A%2F%2F...
        // First we decode it so the inner URL becomes readable:
        finalImageUrl = decodeURIComponent(finalImageUrl);
        
        // Now find the LAST occurrence of http:// or https:// (which will be the actual Cloudflare URL)
        const httpMatches = finalImageUrl.match(/https?:\/\/[^\s"']+/g);
        if (httpMatches && httpMatches.length > 0) {
          finalImageUrl = httpMatches[httpMatches.length - 1];
        }

        console.log("[fal.ai Input URL]:", finalImageUrl);

        console.log("[API Step 1] Generating image with fal.ai (nano-banana-pro/edit)...");
        
        const result = await fal.subscribe("fal-ai/nano-banana-pro/edit", {
          input: {
            image_urls: [finalImageUrl],
            prompt: prompt,
            aspect_ratio: targetAspectRatio
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
        const imgRes = await fetch(outputUrl);
        if (!imgRes.ok) throw new Error("Failed to download generated image from fal.ai URL");
        
        const arrBuf = await imgRes.arrayBuffer();
        generatedImageBuffer = Buffer.from(arrBuf);
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
      // STAGE 2: CRISP UPSCALE THE RASTER IMAGE (RECRAFT)
      // ==========================================
      if (!project.generated_image_url) throw new Error("No generated raster image found for Step 2");

      // TEMPORARILY BYPASSED TO DOUBLE THE SPEED OF THE TOOL
      // Since Gemini now generates 1536px images and Recraft Vectorize handles smoothing natively,
      // the upscale step is redundant and adds 15-20 seconds of unnecessary waiting time.
      return NextResponse.json({ success: true, step: 2, fileUrl: project.generated_image_url, mimeType: "image/png" });
    }

    return NextResponse.json({ error: "Invalid step parameter" }, { status: 400 });

  } catch (error) {
    console.error(`[Trace API Error]:`, error.message);
    
    // Attempt automatic refund on server-side failure
    try {
      if (projectId) {
        const { data: updatedProj } = await adminSupabase
          .from('projects')
          .update({ generated_image_url: 'REFUNDED' })
          .eq('id', projectId)
          .neq('generated_image_url', 'REFUNDED')
          .select('user_id');

        if (updatedProj && updatedProj.length > 0) {
           await safeRefundCredit(updatedProj[0].user_id);
        }
      }
    } catch (refundErr) {
      console.error(`[Billing] Refund failed:`, refundErr.message);
    }

    return NextResponse.json({ error: error.message || "Failed to process trace step" }, { status: 500 });
  }
}
