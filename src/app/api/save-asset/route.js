import { NextResponse } from "next/server";
import { uploadToR2 } from "@/lib/cloudflare";
import { adminSupabase } from "@/lib/supabase";
import { enforceRateLimit } from "@/lib/rateLimit";
import { DEFAULT_MAX_IMAGE_BYTES, DEFAULT_MAX_SVG_BYTES, DEFAULT_MAX_UPSCALED_IMAGE_BYTES, fetchWithSSRFProtection, getAllowedStorageHosts, normalizeUserImageUrl } from "@/lib/ssrf";

export const maxDuration = 60;

const ALLOWED_REMOTE_HOSTS = [...getAllowedStorageHosts(), 'fal.media', 'v3.fal.media'];
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'image/svg+xml'];
const MAX_JSON_BODY_BYTES = Math.ceil(DEFAULT_MAX_IMAGE_BYTES * 1.4);

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
    const rateLimit = await enforceRateLimit({
      namespace: "api:save-asset:user",
      identifier: user.id,
      max: 20,
      window: "60 s",
      windowMs: 60_000,
    });
    if (!rateLimit.success) return rateLimit.response;
    // ─────────────────────────────────────────────────────────────────────────

    const contentLength = Number(request.headers.get('content-length') || '0');
    if (contentLength && contentLength > MAX_JSON_BODY_BYTES) {
      return NextResponse.json({ error: "Request body too large" }, { status: 413 });
    }

    const body = await request.json();
    const { projectId, step, base64, mimeType, fileUrl } = body;

    if (!projectId || !step) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Verify the user owns this project before allowing any writes
    const { data: project, error: projError } = await adminSupabase
      .from('projects')
      .select('user_id')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single();

    if (projError || !project) {
      return NextResponse.json({ error: 'Project not found or access denied' }, { status: 403 });
    }

    let buffer;
    let ext;
    let finalMimeType = mimeType || "image/png";

    if (base64) {
      if (!ALLOWED_MIME_TYPES.includes(finalMimeType)) {
        return NextResponse.json({ error: "Invalid mime type" }, { status: 400 });
      }
      const maxBytes = finalMimeType === 'image/svg+xml' ? DEFAULT_MAX_SVG_BYTES : DEFAULT_MAX_IMAGE_BYTES;
      if (Buffer.byteLength(base64, 'base64') > maxBytes) {
        return NextResponse.json({ error: "File too large" }, { status: 413 });
      }
      buffer = Buffer.from(base64, "base64");
      ext = finalMimeType.split("/")[1] || "png";
      if (ext === "jpeg") ext = "jpg";
    } else if (fileUrl) {
      const normalizedFileUrl = normalizeUserImageUrl(fileUrl, new URL(request.url).origin);
      const maxBytes = step === 3
        ? DEFAULT_MAX_SVG_BYTES
        : step === 2
          ? DEFAULT_MAX_UPSCALED_IMAGE_BYTES
          : DEFAULT_MAX_IMAGE_BYTES;
      const { response, buffer: remoteBuffer, finalUrl } = await fetchWithSSRFProtection(normalizedFileUrl, {
        allowedHosts: [], // Allow any public host for trusted provider URLs
        maxBytes,
        allowedContentTypes: ['image/', 'application/octet-stream'],
      });
      if (!response.ok) throw new Error("Failed to fetch fileUrl");
      buffer = remoteBuffer;
      finalMimeType = response.headers.get('content-type')?.split(';')[0] || finalMimeType;
      ext = new URL(finalUrl).pathname.split('.').pop() || "png";
      // Sanitize extension
      if (ext.length > 4 || ext.includes("?")) ext = "png";
    } else {
      return NextResponse.json({ error: "Provide either base64 or fileUrl" }, { status: 400 });
    }

    if (step === 1) {
      const fileName = `projects/${projectId}/generated_flat_${Date.now()}.${ext}`;
      const finalUrl = await uploadToR2(buffer, fileName, finalMimeType);
      await adminSupabase.from('projects').update({ generated_image_url: finalUrl, ai_prompt: null, zip_url: null, zip_signature: null, zip_generated_at: null }).eq('id', projectId).eq('user_id', user.id);
      return NextResponse.json({ success: true, url: finalUrl });
    }

    if (step === 2) {
      const fileName = `projects/${projectId}/upscaled_${Date.now()}.${ext}`;
      const finalUrl = await uploadToR2(buffer, fileName, finalMimeType);
      await adminSupabase.from('projects').update({ upscaled_image_url: finalUrl, zip_url: null, zip_signature: null, zip_generated_at: null }).eq('id', projectId).eq('user_id', user.id);
      return NextResponse.json({ success: true, url: finalUrl });
    }

    if (step === 3) {
      const fileName = `projects/${projectId}/vector_${Date.now()}.svg`;
      const finalUrl = await uploadToR2(buffer, fileName, "image/svg+xml");
      await adminSupabase.from('projects').update({ svg_url: finalUrl, zip_url: null, zip_signature: null, zip_generated_at: null }).eq('id', projectId).eq('user_id', user.id);
      return NextResponse.json({ success: true, url: finalUrl });
    }

    return NextResponse.json({ error: "Invalid step" }, { status: 400 });

  } catch (error) {
    console.error("[Save Asset Error]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
