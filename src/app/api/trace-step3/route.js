import { NextResponse } from "next/server";
import { uploadToR2 } from "@/lib/cloudflare";
import { adminSupabase } from "@/lib/supabase";

export const runtime = 'nodejs';
export const maxDuration = 60;

const RECRAFT_API_KEY = process.env.RECRAFT_API_KEY;

export async function POST(request) {
  let projectId;
  try {
    const body = await request.json();
    projectId = body.projectId;
    const colors = body.colors || "auto";

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

    // ==========================================
    // STAGE 3: VECTORIZE THE UPSCALED IMAGE (RECRAFT)
    // ==========================================
    if (!project.upscaled_image_url) throw new Error("No upscaled image found for Step 3");

    const rasterImgRes = await fetch(project.upscaled_image_url);
    if (!rasterImgRes.ok) throw new Error("Failed to fetch upscaled image from R2");
    const rawBuffer = Buffer.from(await rasterImgRes.arrayBuffer());

    // Convert image to lossless PNG and apply Color Reduction (Shadow Killer) if requested
    const sharp = (await import('sharp')).default;
    let sharpInstance = sharp(rawBuffer).resize({ width: 1536, height: 1536, fit: 'inside', withoutEnlargement: true });
    
    // EXTREME SHARPENING FOR LOGOS: If it's a logo, stretch contrast and sharpen heavily 
    // to ensure text and circles have pixel-perfect borders before vectorization.
    if (project.trace_type === 'logo') {
      sharpInstance = sharpInstance
        .normalize() // Stretch contrast to pure blacks and whites where applicable
        .sharpen({ sigma: 1.5, m1: 1, m2: 2, x1: 2, y2: 10, y3: 20 }); // Aggressive unsharp mask to fix any remaining blur
    }

    let compressedBuffer;
    if (colors && colors !== "auto") {
      const colorLimit = parseInt(colors, 10);
      compressedBuffer = await sharpInstance.png({ palette: true, colors: colorLimit, effort: 7 }).toBuffer();
    } else {
      compressedBuffer = await sharpInstance.png({ effort: 7 }).toBuffer();
    }

    const blob = new Blob([compressedBuffer], { type: 'image/png' });
    const vectorizeFormData = new FormData();
    vectorizeFormData.append('image', blob, 'image.png');

    const recraftVectorRes = await fetch("https://external.api.recraft.ai/v1/images/vectorize", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RECRAFT_API_KEY}` },
      body: vectorizeFormData,
      signal: AbortSignal.timeout(55000),
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

    await adminSupabase.from('projects').update({ svg_url: finalSvgUrl }).eq('id', projectId);

    return NextResponse.json({ success: true, step: 3, svg_url: finalSvgUrl });

  } catch (error) {
    console.error(`[Trace Step 3 Error]:`, error.message);
    
    // Attempt automatic refund on server-side failure
    try {
      if (projectId) {
        const { data: proj } = await adminSupabase.from('projects').select('user_id, generated_image_url').eq('id', projectId).single();
        if (proj?.user_id && proj.generated_image_url !== 'REFUNDED') {
          const { data: profile } = await adminSupabase.from('profiles').select('credits').eq('id', proj.user_id).single();
          if (profile) {
            await adminSupabase.from('profiles').update({ credits: profile.credits + 1 }).eq('id', proj.user_id);
            await adminSupabase.from('projects').update({ generated_image_url: 'REFUNDED' }).eq('id', projectId);
          }
        }
      }
    } catch (refundErr) {
      console.error(`[Billing] Refund failed:`, refundErr.message);
    }

    return NextResponse.json({ error: error.message || "Failed to process trace step" }, { status: 500 });
  }
}
