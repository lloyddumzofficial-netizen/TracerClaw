import { NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase";
import { enforceRateLimit } from "@/lib/rateLimit";
import { isAllowedStorageUrl } from "@/lib/ssrf";

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

    // Authenticated project writes elsewhere (/api/save-asset) are limited;
    // this one was not, leaving an unbounded DB write behind a valid session.
    const rateLimit = await enforceRateLimit({
      namespace: "api:crop:user",
      identifier: user.id,
      max: 20,
      window: "60 s",
      windowMs: 60_000,
    });
    if (!rateLimit.success) return rateLimit.response;

    const { projectId, croppedImageUrl } = await request.json();

    if (!projectId || !croppedImageUrl) {
      return NextResponse.json({ error: "Missing required fields (projectId, croppedImageUrl)" }, { status: 400 });
    }

    // Security: validate that croppedImageUrl is from our own R2 bucket only
    // This prevents URL injection attacks where arbitrary URLs get stored in the DB
    if (!isAllowedStorageUrl(croppedImageUrl, { userId: user.id })) {
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
        svg_url: null,
        zip_url: null,
        zip_signature: null,
        zip_generated_at: null
      })
      .eq('id', projectId)
      .eq('user_id', user.id); // ownership check

    if (error) throw error;

    // Re-cropping starts a fresh run, so clear the previous failure stamp.
    // Best-effort and separate from the update above: these columns only exist
    // once add_project_failure_tracking.sql has been run, and cropping must not
    // break on a deployment where that migration has not landed yet.
    await adminSupabase
      .from('projects')
      .update({ failed_at: null, failed_step: null })
      .eq('id', projectId)
      .eq('user_id', user.id);

    return NextResponse.json({ success: true, cropped_image_url: croppedImageUrl });

  } catch (error) {
    console.error(`[Crop API Error]:`, error);
    return NextResponse.json({ error: "Failed to save cropped image." }, { status: 500 });
  }
}
