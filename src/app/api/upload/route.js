import { NextResponse } from "next/server";
import { uploadToR2 } from "@/lib/cloudflare";
import { supabase } from "@/lib/supabase";

export async function POST(request) {
  try {
    const { imageUrl, traceType, projectName, userId } = await request.json();

    if (!imageUrl) {
      return NextResponse.json({ error: "No image URL provided" }, { status: 400 });
    }

    const fileUrl = imageUrl;

    // 3. Save to Supabase database
    const { data, error } = await supabase
      .from('projects')
      .insert([
        { 
          name: projectName, 
          original_image_url: fileUrl,
          trace_type: traceType.startsWith('mockup') ? 'mockup' : 'logo',
          user_id: userId || null,
          ai_prompt: traceType === 'mockup_erase' ? 'ERASE_LOGOS' : (traceType === 'mockup_preserve' ? 'PRESERVE_LOGOS' : null)
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
