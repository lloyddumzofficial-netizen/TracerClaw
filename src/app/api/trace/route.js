import { NextResponse } from "next/server";
import { adminSupabase, safeRefundCredit } from "@/lib/supabase";
import { fetchWithRetry } from "@/lib/fetchWithRetry";
import { validateUrlForSSRF } from "@/lib/ssrf";

// IMPORTANT: Must use Node.js runtime (not edge) so we get real 120s timeouts.
// Edge runtime on Vercel has a hard 30s cap which causes all Gemini generations to fail.
export const runtime = 'nodejs';
export const maxDuration = 120; // Vercel Pro plan allows up to 300s; 120s is safe

export async function POST(request) {
  let projectId;
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

CRITICAL — PERSPECTIVE CORRECTION (READ FIRST):
- The reference photo may be taken at an angle, on a hanger, on a person, or with camera perspective distortion. You MUST mentally correct this.
- Output the design as if the jersey is lying perfectly flat on a table, viewed straight-on from above — NO perspective, NO tilt, NO angle, NO distortion.
- If the photo shows BOTH the front and back of the jersey, use ONLY the FRONT side. Ignore the back panel entirely.
- The output canvas must be perfectly straight and symmetrical — never crooked or skewed.

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

CRITICAL — PERSPECTIVE CORRECTION (READ FIRST):
- The reference photo may be taken at an angle, on a hanger, on a person, or with camera perspective distortion. You MUST mentally correct this.
- Output the design as if the jersey is lying perfectly flat on a table, viewed straight-on from above — NO perspective, NO tilt, NO angle, NO distortion.
- If the photo shows BOTH the front and back of the jersey, use ONLY the FRONT side. Ignore the back panel entirely.
- The output canvas must be perfectly straight and symmetrical — never crooked or skewed.

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
        } else if (project.ai_prompt === 'LOGO_FLATTEN') {
          prompt = `You are a professional vector artist. Your task is to produce a PIXEL-PERFECT flat vector-ready version of the logo in this reference image.

THIS IS A LOGO TRACE — NOT A JERSEY TRACE. The rules below are absolute:

ACCURACY — THIS IS THE #1 PRIORITY (TARGET: 98%+ MATCH):
- Reproduce the logo with MATHEMATICALLY EXACT fidelity to the reference.
- Every shape, outline, curve, angle, and proportion must match the reference exactly.
- Every color must be reproduced as the exact same solid flat color. No color shifting, no darkening, no lightening.
- If the logo has multiple color regions, preserve ALL of them in their exact positions and sizes.

TEXT & TYPOGRAPHY — DO NOT ALTER EVER:
- If the logo contains text (wordmark, tagline, acronym, team name), reproduce every single letter EXACTLY as written — same font style, same weight, same spacing, same capitalization.
- Do NOT autocorrect, rewrite, or stylize any letter, word, or character under any circumstances.
- Text-only logos (wordmarks like "NIKE", "ADIDAS", team names) must be reproduced purely as flat typography with the exact same letterform style.

ELEMENTS TO KEEP — ALL OF THEM:
- All icons, symbols, crests, stars, shields, crowns, swooshes, or decorative elements.
- All borders, outlines, rings, and inner frames.
- All fine inner details inside the logo shapes.
- All secondary text, taglines, year numbers, or decorative text.

BACKGROUND:
- If the original logo has a transparent, white, or solid colored background, keep it exactly as-is.
- Do NOT add any new background, shadow, glow, or border that is not in the reference.

FINISHING:
- Remove any photo texture, fabric grain, noise, or 3D shading — output pure flat solid colors only.
- The result must look like it was drawn in Adobe Illustrator — clean, crisp, and ready for SVG vectorization.
- Maintain the original proportions and centering of the logo exactly.`;
        } else {
          prompt = `Transform this jersey/shirt design into a perfectly flat, 2D rectangular vector-ready wallpaper. DO NOT DRAW A SHIRT OR CLOTHING SILHOUETTE.

CRITICAL — PERSPECTIVE CORRECTION (READ FIRST):
- The reference photo may be taken at an angle, on a hanger, on a person, or with camera perspective distortion. You MUST mentally correct this.
- Output the design as if the jersey is lying perfectly flat on a table, viewed straight-on from above — NO perspective, NO tilt, NO angle, NO distortion.
- If the photo shows BOTH the front and back of the jersey, use ONLY the FRONT side. Ignore the back panel entirely.
- The output canvas must be perfectly straight and symmetrical — never crooked or skewed.

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
      // STAGE 2: 4x UPSCALE WITH fal-ai/esrgan
      // Reverted to fal.ai for fast pixel-scaling and dashboard logging.
      // ==========================================
      if (!project.generated_image_url) throw new Error("No generated raster image found for Step 2");
      if (!process.env.FAL_KEY) throw new Error("FAL_KEY is missing in environment variables.");

      const { fal } = await import("@fal-ai/client");

      // Decode the URL in case it's wrapped in a proxy path
      let upscaleInputUrl = decodeURIComponent(project.generated_image_url);
      const httpMatches2 = upscaleInputUrl.match(/https?:\/\/[^\s"']+/g);
      if (httpMatches2 && httpMatches2.length > 0) {
        upscaleInputUrl = httpMatches2[httpMatches2.length - 1];
      }

      console.log("[API Step 2] Upscaling with fal-ai/esrgan (4x)...");
      console.log("[fal.ai ESRGAN Input URL]:", upscaleInputUrl);

      const esrganResult = await fal.subscribe("fal-ai/esrgan", {
        input: {
          image_url: upscaleInputUrl,
          scale: 4,
          face_enhance: false, // jerseys have no faces — skip face enhancement
        },
        logs: true,
      });

      console.log("[fal.ai ESRGAN RAW Response]:", JSON.stringify(esrganResult?.data, null, 2));

      if (!esrganResult || !esrganResult.data || !esrganResult.data.image || !esrganResult.data.image.url) {
        throw new Error("fal-ai/esrgan did not return a valid image URL. Response: " + JSON.stringify(esrganResult));
      }

      const upscaledUrl = esrganResult.data.image.url;
      const upscaledMimeType = esrganResult.data.image.content_type || "image/png";

      return NextResponse.json({ success: true, step: 2, fileUrl: upscaledUrl, mimeType: upscaledMimeType });
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

    // Never expose raw internal error messages (API keys, stack traces) to the client
    const safeMessage = error.message?.includes('FAL') || error.message?.includes('fal') || error.message?.includes('API')
      ? 'AI processing failed. Your credit has been refunded automatically.'
      : (error.message || 'Failed to process trace step');
    return NextResponse.json({ error: safeMessage }, { status: 500 });
  }
}
