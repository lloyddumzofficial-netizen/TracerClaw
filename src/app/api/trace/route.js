import { NextResponse } from "next/server";
import { adminSupabase, safeRefundCredit } from "@/lib/supabase";
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

      // Credit deducted successfully.
    }

    if (step === 1) {
      // ==========================================
      // STAGE 1: fal.ai ESRGAN → nano-banana-pro
      // ==========================================

      const sourceUrl = croppedImageUrl || project.original_image_url;
      if (!(await validateUrlForSSRF(sourceUrl))) {
        return NextResponse.json({ error: "Invalid or unauthorized image URL" }, { status: 400 });
      }

      // Read image metadata to calculate the closest allowed aspect ratio for fal.ai
      const imageResponse = await fetch(sourceUrl);
      if (!imageResponse.ok) throw new Error("Failed to fetch source image");
      const rawBuffer = Buffer.from(await imageResponse.arrayBuffer());
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

      let prompt = "";
      if (project) {
        if (project.ai_prompt === 'ERASE_LOGOS') {
          prompt = `⚠️ HARDEST RULE — READ THIS FIRST AND OBEY IT ALWAYS:
DO NOT DRAW A SHIRT. DO NOT DRAW A JERSEY SHAPE. DO NOT DRAW A NECKLINE. DO NOT DRAW ARMHOLES. DO NOT DRAW SLEEVES. DO NOT DRAW ANY CLOTHING SILHOUETTE WHATSOEVER.
Your output canvas is a PLAIN RECTANGLE filled edge-to-edge with design pattern ONLY. If any part of your output looks like a shirt shape, collar, or sleeve cutout — YOU HAVE FAILED.

You are a FORENSIC COPY ARTIST. Your ONLY task is to make a pixel-accurate flat rectangular replica of the DESIGN PATTERN on this jersey. You are NOT allowed to be creative. You are NOT allowed to invent anything.

== STEP 1: ANALYZE THE REFERENCE IMAGE (DO THIS FIRST) ==
Before drawing anything, mentally catalog EVERY design element:
- What are the EXACT background colors? (list them all)
- What geometric shapes exist? (stripes, polygons, curves, gradients — describe each one's angle, size, and position)
- Where exactly is each color zone? (top-left, center, bottom-right, etc.)
- What exact colors are used? (e.g. "hot pink", "electric blue", "black")

== STEP 2: PERSPECTIVE CORRECTION (MANDATORY) ==
- The photo may show the jersey worn on a person, hung on a hanger, or shot at an angle. You MUST mentally "unfold" and flatten it.
- Output the design as if the jersey fabric is cut open and laid perfectly flat — 100% straight-on rectangle.
- If both front and back panels are visible, ONLY reproduce the FRONT panel.
- The output must be a perfect upright rectangle — never crooked or skewed.

== STEP 3: CANVAS REQUIREMENTS (RE-READ THE FIRST RULE) ==
- The output is a RECTANGLE. No shirt shape. No neckline. No sleeves. No armhole cutouts. JUST A RECTANGLE.
- Fill the entire canvas completely edge-to-edge with the design pattern.
- Every color zone, stripe, and shape must bleed fully to all four canvas edges — no white space, no padding.

== STEP 4: SHAPE & COLOR ACCURACY — THIS IS LAW ==
- COPY EVERY SHAPE EXACTLY: same position, same angle, same size, same color. No exceptions.
- ANTI-HALLUCINATION: Do NOT substitute real design elements with invented ones. If you see hot pink, output hot pink. If you see diagonal straight stripes, output straight stripes — NOT wavy swirls.
- SUBLIMATION PATTERNS: Reproduce the EXACT SAME sublimation shapes, waves, or geometric polygons. Do not replace with a generic pattern.
- Zero tolerance for invented elements: every output pixel must correspond to a real element in the reference image.

== STEP 5: TEXT AND LOGO REMOVAL ==
- REMOVE all player names, jersey numbers, sponsor logos, and chest badges.
- Seamlessly continue the background pattern beneath removed text — no white boxes, no blank gaps.

== STEP 6: FINISHING ==
- Flatten all fabric wrinkles, fold shadows, and lighting into clean solid flat colors.
- The output must look like a clean rectangular sublimation print file in Adobe Illustrator — crisp, flat, print-ready. NO SHIRT SHAPE.`;
        } else if (project.ai_prompt === 'LOGO_FLATTEN') {
          prompt = `You are a FORENSIC LOGO REPRODUCTION ARTIST. Your task is to create a 100% pixel-accurate, flat vector-ready copy of the logo in this reference image. You are NOT allowed to be creative. You are NOT allowed to simplify, stylize, or interpret. Copy it EXACTLY.

== ACCURACY IS THE ONLY RULE (TARGET: 99%+ MATCH) ==
- Reproduce the logo with MATHEMATICAL EXACTNESS. Every shape, curve, angle, and proportion must be a perfect copy of the reference.
- Every color must be the EXACT same solid flat color as the reference. Do not shift the hue. Do not change the lightness. Copy it exactly.
- If the logo has multiple color layers or regions, reproduce ALL of them in their exact positions, sizes, and proportions.
- ZERO HALLUCINATION: Do not add any element that does not exist in the reference. Do not remove any element that does exist.

== TEXT & TYPOGRAPHY — ABSOLUTE RULE: COPY VERBATIM ==
- If the logo contains any text, letterforms, numbers, or words — reproduce EVERY SINGLE CHARACTER EXACTLY as written.
- Same font style, same weight (bold/thin/italic), same letter-spacing, same capitalization, same arrangement.
- Do NOT autocorrect spelling. Do NOT rewrite any word. Do NOT change any letter's shape.
- Even if the font looks unusual or custom, copy the letterforms exactly as they appear.

== ELEMENTS TO PRESERVE — ALL OF THEM ==
- Every icon, symbol, mascot, crest, shield, crown, star, swoosh, and decorative element.
- Every border, outline, ring, frame, and inner detail stroke.
- Every secondary piece of text: taglines, year numbers, location text, sub-brand text.

== BACKGROUND ==
- Preserve the original background exactly (transparent, white, or solid color).
- Do NOT add shadows, glows, gradients, or decorative borders that are not in the original.

== FINISHING ==
- Strip out all fabric texture, photo noise, compression artifacts, lighting shadows, and 3D shading.
- Output only pure, clean, flat solid colors — as if redrawn in Adobe Illustrator from scratch.
- Maintain the exact original proportions and centering.`;
        } else {
          prompt = `⚠️ HARDEST RULE — READ THIS FIRST AND OBEY IT ALWAYS:
DO NOT DRAW A SHIRT. DO NOT DRAW A JERSEY SHAPE. DO NOT DRAW A NECKLINE. DO NOT DRAW ARMHOLES. DO NOT DRAW SLEEVES. DO NOT DRAW ANY CLOTHING SILHOUETTE WHATSOEVER.
Your output canvas is a PLAIN RECTANGLE filled edge-to-edge with design pattern ONLY. The output must look like a flat rectangular wallpaper or fabric print file — NOT like a shirt or mockup. If any part of your output looks like a shirt shape, collar, or sleeve cutout — YOU HAVE FAILED THIS TASK.

You are a FORENSIC COPY ARTIST. Your ONLY task is to make a pixel-accurate flat rectangular replica of the DESIGN PATTERN on this jersey. You are NOT allowed to be creative. You are NOT allowed to invent anything.

== STEP 1: ANALYZE THE REFERENCE IMAGE (DO THIS FIRST) ==
Before drawing anything, mentally catalog EVERY design element:
- What are the EXACT background colors? (list them all)
- What geometric shapes exist? (stripes, polygons, curves, sublimation patterns — describe each one's angle, size, and position)
- Where exactly is each color zone? (top-left, center, bottom-right, etc.)
- What exact colors are used? (e.g. "hot pink", "electric blue", "black")

== STEP 2: PERSPECTIVE CORRECTION (MANDATORY) ==
- The photo may show the jersey worn on a person, hung on a hanger, or shot at an angle. Mentally "cut open" the fabric and lay it completely flat.
- Output the design as if the jersey fabric is unfolded into a flat rectangle — 100% straight-on, no perspective, no tilt, no 3D.
- If both front and back panels are visible, ONLY reproduce the FRONT panel. Completely ignore the back.
- The output must be a perfect upright rectangle — never crooked, never skewed.

== STEP 3: CANVAS REQUIREMENTS (RE-READ THE FIRST RULE AGAIN) ==
- The output is a RECTANGLE. No shirt shape. No neckline cutout. No sleeve cutouts. No armholes. JUST A SOLID RECTANGLE.
- Fill the entire canvas completely edge-to-edge with the design pattern.
- Every color zone, stripe, and shape must bleed fully to all four canvas edges — no white space, no padding, no border.
- Imagine you are filling a rectangular fabric panel used for sublimation printing — there is no shirt shape, only the flat pattern.

== STEP 4: SHAPE & COLOR ACCURACY — THIS IS ABSOLUTE LAW ==
- COPY EVERY SHAPE EXACTLY: same position on the canvas, same angle, same size, same color. No exceptions.
- ANTI-HALLUCINATION RULE (CRITICAL): Do NOT substitute real design elements with invented ones.
  If you see HOT PINK, output HOT PINK. If you see TEAL/CYAN, output TEAL/CYAN. If you see diagonal straight stripes, output STRAIGHT STRIPES — NOT wavy swirls.
  Do NOT reimagine or "improve" any element. COPY IT EXACTLY.
- SUBLIMATION PATTERNS: Reproduce the EXACT SAME sublimation shapes, colors, waves, or geometric polygons. Do not replace them with a generic pattern.
- Zero tolerance for invented elements: every output pixel must correspond to a real element in the reference image.

== STEP 5: TEXT, NUMBERS, AND LOGOS ==
- DO NOT replicate player names, jersey numbers, or personal name/number placeholders.
- Fill those areas with the background pattern that logically continues underneath, as if the text was never there.
- DO replicate team logos, chest crests, and decorative sublimation graphics that are part of the design.

== STEP 6: FINISHING ==
- Flatten all fabric wrinkles, fold shadows, and photographic lighting into clean solid flat colors.
- The final output must look like a rectangular sublimation print file — perfectly clean, print-ready. NO SHIRT SHAPE. NO MOCKUP. RECTANGLE ONLY.`;
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

        // ── PRE-UPSCALE: Feed a sharper 2x reference into nano-banana-pro ────
        // Giving the AI a higher-res, noise-free input dramatically improves
        // its ability to accurately read fine sublimation patterns and colors.
        console.log("[API Step 1 Pre-Upscale] Upscaling reference with ESRGAN 2x for better AI input...");
        let highResInputUrl = finalImageUrl; // safe fallback to original
        try {
          const preUpscaleResult = await fal.subscribe("fal-ai/esrgan", {
            input: {
              image_url: finalImageUrl,
              scale: 2,            // 2x only — fast (~10-15s) and enough to sharpen details
              face_enhance: false, // jerseys have no faces — skip
            },
            logs: true,
          });
          if (preUpscaleResult?.data?.image?.url) {
            highResInputUrl = preUpscaleResult.data.image.url;
            console.log("[Pre-Upscale] ✅ Success! Using 2x upscaled reference:", highResInputUrl);
          } else {
            console.warn("[Pre-Upscale] ⚠️ ESRGAN returned no URL — falling back to original reference.");
          }
        } catch (preUpscaleErr) {
          console.warn("[Pre-Upscale] ⚠️ ESRGAN pre-upscale failed, falling back to original. Error:", preUpscaleErr.message);
          // Do NOT throw — gracefully fall back to original image
        }
        // ─────────────────────────────────────────────────────────────────────

        console.log("[API Step 1] Generating flat design with fal.ai (nano-banana-pro/edit) on high-res reference...");
        
        const result = await fal.subscribe("fal-ai/nano-banana-pro/edit", {
          input: {
            image_urls: [highResInputUrl],
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
      // ==========================================
      // Fix #7: Verify Step 1 was legitimately completed before allowing upscale
      // We verify this by ensuring generated_image_url exists and is not 'REFUNDED'.
      if (!project.generated_image_url || project.generated_image_url === 'REFUNDED') {
        return NextResponse.json({ error: "Step 1 (Auto-Trace) must be completed before upscaling." }, { status: 403 });
      }
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
