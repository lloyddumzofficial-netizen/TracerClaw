import { NextResponse } from "next/server";
import { uploadToR2 } from "@/lib/cloudflare";
import { adminSupabase, safeRefundCredit } from "@/lib/supabase";
import { fetchWithRetry } from "@/lib/fetchWithRetry";

export const runtime = 'nodejs';
export const maxDuration = 120; // 120s needed: ESRGAN output is large, Recraft vectorize takes time

export async function POST(request) {
  let projectId;
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
    // ─────────────────────────────────────────────────────────────────────────

    const body = await request.json();
    projectId = body.projectId;
    const colors = body.colors || "auto";

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
      .single();

    if (projError || !project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // Verify caller owns this project
    if (project.user_id !== user.id) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // ==========================================
    // STAGE 3: VECTORIZE WITH RECRAFT (SVG only)
    // The image is already upscaled by ESRGAN in Step 2.
    // Here we only convert to lossless PNG and apply optional Shadow Killer
    // color reduction before handing off to Recraft vectorize.
    // ==========================================
    if (!project.upscaled_image_url) throw new Error("No upscaled image found for Step 3");

    const rasterImgRes = await fetch(project.upscaled_image_url);
    if (!rasterImgRes.ok) throw new Error("Failed to fetch upscaled image from R2");
    const rawBuffer = Buffer.from(await rasterImgRes.arrayBuffer());

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

    const svgRes = await fetch(vectorUrl);
    let svgText = await svgRes.text();

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

    const svgBuffer = Buffer.from(svgText, 'utf8');
    const cfSvgFileName = `projects/${projectId}/vector_${Date.now()}.svg`;
    const finalSvgUrl = await uploadToR2(svgBuffer, cfSvgFileName, "image/svg+xml");

    await adminSupabase.from('projects').update({ svg_url: finalSvgUrl }).eq('id', projectId);

    return NextResponse.json({ success: true, step: 3, svg_url: finalSvgUrl });

  } catch (error) {
    console.error(`[Trace Step 3 Error]:`, error.message);
    
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
