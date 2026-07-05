import { NextResponse } from "next/server";
import { uploadToR2 } from "@/lib/cloudflare";
import { supabase } from "@/lib/supabase";

export async function POST(request) {
  try {
    const formData = await request.formData();
    const imageFile = formData.get("image");
    const traceType = formData.get("traceType") || "mockup";
    const projectName = formData.get("projectName") || imageFile.name;
    const userId = formData.get("userId");

    if (!imageFile) {
      return NextResponse.json({ error: "No image provided" }, { status: 400 });
    }

    // 1. Convert to buffer
    const arrayBuffer = await imageFile.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 2. Upload original image to Cloudflare R2
    const fileName = `uploads/${Date.now()}_${imageFile.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
    const fileUrl = await uploadToR2(buffer, fileName, imageFile.type);

    // 3. Save to Supabase database
    const { data, error } = await supabase
      .from('projects')
      .insert([
        { 
          name: projectName, 
          original_image_url: fileUrl,
          trace_type: traceType,
          user_id: userId || null
        }
      ])
      .select('id')
      .single();

    if (error) {
      console.error("Supabase insert error:", error);
      throw new Error(`Failed to save project to database: ${error.message || JSON.stringify(error)}`);
    }

    // Return the project ID to the frontend
    return NextResponse.json({ success: true, projectId: data.id });

  } catch (error) {
    console.error("Error in upload route:", error);
    return NextResponse.json(
      { error: "Internal Server Error", details: error.message },
      { status: 500 }
    );
  }
}
