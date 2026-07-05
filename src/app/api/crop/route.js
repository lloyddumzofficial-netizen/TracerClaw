import { NextResponse } from "next/server";
import { uploadToR2 } from "@/lib/cloudflare";
import { supabase } from "@/lib/supabase";

export const maxDuration = 30;

export async function POST(request) {
  try {
    const { projectId, croppedBase64 } = await request.json();

    if (!projectId || !croppedBase64) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Parse base64
    const split = croppedBase64.split(",");
    const base64Data = split[1];
    const mimeType = split[0].split(":")[1].split(";")[0];
    const ext = mimeType.split("/")[1] || "jpg";
    const imageBuffer = Buffer.from(base64Data, "base64");

    // Upload to Cloudflare R2
    const fileName = `projects/${projectId}/cropped_${Date.now()}.${ext}`;
    const fileUrl = await uploadToR2(imageBuffer, fileName, mimeType);

    // Update project in Supabase (Overwrite original_image_url to make crop permanent and clear old trace results)
    const { error } = await supabase
      .from('projects')
      .update({ 
        original_image_url: fileUrl,
        generated_image_url: null,
        upscaled_image_url: null,
        svg_url: null
      })
      .eq('id', projectId);

    if (error) throw error;

    return NextResponse.json({ success: true, cropped_image_url: fileUrl });

  } catch (error) {
    console.error(`[Crop API Error]:`, error);
    return NextResponse.json({ error: error.message || "Failed to save cropped image" }, { status: 500 });
  }
}
