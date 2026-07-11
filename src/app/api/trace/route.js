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
      
      // Use lossless PNG at 1280px — higher quality preserves geometric shape details
      // better than lossy JPEG for pattern/layout accuracy during vectorization.
      const compressedBuffer = await sharp(rawBuffer)
        .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
        .png({ effort: 3, compressionLevel: 6 })
        .toBuffer();
        
      base64Image = compressedBuffer.toString("base64");
      let prompt = "";
      if (project) {
        if (project.ai_prompt === 'FLATTEN') {
          prompt = `Transform this jersey/shirt design into a perfectly flat, 2D rectangular vector-ready wallpaper. DO NOT DRAW A SHIRT OR CLOTHING SILHOUETTE.

OUTPUT REQUIREMENTS:
- The canvas must be a pure rectangle filled completely edge-to-edge.
- Extend every stripe, gradient, polygon, and geometric shape to bleed off all four edges.
- Remove the shirt/jersey shape — output ONLY the raw design pattern.

SHAPE & LAYOUT ACCURACY — THIS IS THE MOST IMPORTANT RULE:
- REPLICATE EVERY SINGLE SHAPE with its EXACT position, size, angle, and proportion as seen in the reference image. Do NOT move, scale, rotate, add, or remove any shape.
- Every polygon, triangle, hexagon, diagonal stripe, curved line, dot-grid, or geometric element must appear in the EXACT same location relative to the canvas as it appears on the reference shirt.
- If a stripe runs from bottom-left to top-right at 45°, keep it at exactly 45°. Do not change any angle.
- If a hexagon grid covers the upper-right, it must cover the upper-right of the output — not be moved or resized.
- Preserve the EXACT color of every region. Use solid, flat colors — no gradients unless the original has gradients.
- Do NOT invent new shapes, new stripes, or new patterns. ONLY replicate what exists.

TEXT, NUMBERS, NAMES, AND LOGOS:
- DO NOT remove logos, chest badges, or text that are part of the design — replicate them as flat vector-style artwork.
- Remove player name/number placeholder text ONLY if they are clearly generic placeholders (e.g. "NAME", "00").

FINISHING:
- Flatten all 3D fabric folds, wrinkles, and shadows into clean, solid flat colors.
- The result should look like a clean flat-lay pattern ready for screen printing.`;
        } else if (project.ai_prompt === 'ERASE_LOGOS') {
          prompt = `Transform this jersey/shirt design into a perfectly flat, 2D rectangular vector-ready wallpaper with all text and logos removed. DO NOT DRAW A SHIRT OR CLOTHING SILHOUETTE.

OUTPUT REQUIREMENTS:
- The canvas must be a pure rectangle filled completely edge-to-edge.
- Extend every stripe, gradient, polygon, and geometric shape to bleed off all four edges.
- Remove the shirt/jersey shape — output ONLY the raw design pattern.

SHAPE & LAYOUT ACCURACY — THIS IS THE MOST IMPORTANT RULE:
- REPLICATE EVERY SINGLE SHAPE with its EXACT position, size, angle, and proportion as seen in the reference image. Do NOT move, scale, rotate, add, or remove any geometric shape.
- Every polygon, triangle, hexagon, diagonal stripe, curved line, dot-grid, or geometric element must appear in the EXACT same location as in the reference.
- Preserve the EXACT color of every region. Use solid, flat colors.
- Do NOT invent new shapes, new stripes, or new patterns. ONLY replicate what exists.

TEXT AND LOGO REMOVAL:
- REMOVE all typography, player names, numbers, sponsor logos, and chest badges.
- Flawlessly reconstruct the underlying background pattern beneath removed elements — continue the stripes/shapes seamlessly as if the text was never there.

FINISHING:
- Flatten all 3D fabric folds, wrinkles, and shadows into clean, solid flat colors.
- The result should look like a clean flat-lay pattern ready for screen printing.`;
        } else {
          prompt = `Transform this jersey/shirt design into a perfectly flat, 2D rectangular vector-ready wallpaper. DO NOT DRAW A SHIRT OR CLOTHING SILHOUETTE.

OUTPUT REQUIREMENTS:
- The canvas must be a pure rectangle filled completely edge-to-edge.
- Extend every stripe, gradient, polygon, and geometric shape to bleed off all four edges.
- Remove the shirt/jersey shape — output ONLY the raw design pattern.

SHAPE & LAYOUT ACCURACY — THIS IS THE MOST IMPORTANT RULE:
- REPLICATE EVERY SINGLE SHAPE with its EXACT position, size, angle, and proportion as seen in the reference image. Do NOT move, scale, rotate, add, or remove any shape.
- Every polygon, triangle, hexagon, diagonal stripe, curved line, dot-grid, or geometric element must appear in the EXACT same location relative to the canvas as it appears on the reference shirt.
- If a stripe runs from bottom-left to top-right at 45°, keep it at exactly 45°. Do not change any angle.
- If a hexagon grid covers the upper-right, it must cover the upper-right of the output — not be moved or resized.
- Preserve the EXACT color of every region. Use solid, flat colors — no gradients unless the original has gradients.
- Do NOT invent new shapes, new stripes, or new patterns. ONLY replicate what exists.

TEXT, NUMBERS, NAMES, AND LOGOS:
- DO NOT replicate player names, jersey numbers, or personal name placeholders (e.g. "NAME", "POSITION", "00"). Leave those areas as background pattern only.
- DO replicate team logos, chest badges, and design-integrated graphics that are part of the pattern.

FINISHING:
- Flatten all 3D fabric folds, wrinkles, and shadows into clean, solid flat colors.
- The result should look like a clean flat-lay pattern ready for screen printing.`;
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
      // STAGE 2: CRISP UPSCALE WITH RECRAFT (crispUpscale)
      // Uses the same RECRAFT_API_KEY — no fal.ai needed.
      // Recraft crispUpscale increases resolution and makes the image
      // sharper and cleaner, which produces better SVG paths in Step 3.
      // ==========================================
      if (!project.generated_image_url) throw new Error("No generated raster image found for Step 2");
      if (!process.env.RECRAFT_API_KEY) throw new Error("RECRAFT_API_KEY is missing in environment variables.");

      // Fetch the generated image and upload as multipart (Recraft crispUpscale requires file upload, not URL)
      console.log("[API Step 2] Fetching generated image for crispUpscale...");
      const genImgRes = await fetch(project.generated_image_url);
      if (!genImgRes.ok) throw new Error("Failed to fetch generated image for crispUpscale");
      const genImgBuffer = Buffer.from(await genImgRes.arrayBuffer());

      // Recraft crispUpscale: max 10MB, max 16MP, max 4096px per side
      // Our generated images are ~1280px PNG — well within limits.
      const crispFormData = new FormData();
      crispFormData.append('file', new Blob([genImgBuffer], { type: 'image/png' }), 'image.png');

      console.log("[API Step 2] Sending to Recraft crispUpscale...");
      const crispRes = await fetchWithRetry("https://external.api.recraft.ai/v1/images/crispUpscale", {
        method: "POST",
        headers: { "Authorization": `Bearer ${process.env.RECRAFT_API_KEY}` },
        body: crispFormData,
        signal: AbortSignal.timeout(90000), // 90s — upscale can take time
      });

      if (!crispRes.ok) {
        const errText = await crispRes.text();
        throw new Error(`Recraft crispUpscale failed: ${errText}`);
      }

      const crispData = await crispRes.json();
      console.log("[Recraft crispUpscale response]:", JSON.stringify(crispData, null, 2));

      if (!crispData?.image?.url) {
        throw new Error("Recraft crispUpscale did not return a valid image URL. Response: " + JSON.stringify(crispData));
      }

      return NextResponse.json({ success: true, step: 2, fileUrl: crispData.image.url, mimeType: crispData.image.content_type || "image/png" });
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
