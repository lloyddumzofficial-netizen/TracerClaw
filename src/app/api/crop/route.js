import { NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase";

export const maxDuration = 30;

export async function POST(request) {
  try {
    // ─── Auth: verify the caller owns this project ────────────────────────────
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

    const { projectId, croppedImageUrl } = await request.json();

    if (!projectId || !croppedImageUrl) {
      return NextResponse.json({ error: "Missing required fields (projectId, croppedImageUrl)" }, { status: 400 });
    }

    // Security: validate that croppedImageUrl is from our own R2 bucket only
    // This prevents URL injection attacks where arbitrary URLs get stored in the DB
    const ALLOWED_URL_PREFIX = process.env.CLOUDFLARE_PUBLIC_URL;
    if (!ALLOWED_URL_PREFIX || !croppedImageUrl.startsWith(ALLOWED_URL_PREFIX)) {
      console.warn(`[Crop API] Blocked attempt to store unauthorized URL: ${croppedImageUrl}`);
      return NextResponse.json({ error: "Invalid image URL: must be from our storage." }, { status: 400 });
    }

    // Update project in Supabase — only if the user owns it
    const { error } = await adminSupabase
      .from('projects')
      .update({ 
        original_image_url: croppedImageUrl,
        generated_image_url: null,
        upscaled_image_url: null,
        svg_url: null
      })
      .eq('id', projectId)
      .eq('user_id', user.id); // ownership check

    if (error) throw error;

    return NextResponse.json({ success: true, cropped_image_url: croppedImageUrl });

  } catch (error) {
    console.error(`[Crop API Error]:`, error);
    return NextResponse.json({ error: error.message || "Failed to save cropped image" }, { status: 500 });
  }
}
