import { NextResponse } from "next/server";
import { uploadToR2 } from "@/lib/cloudflare";
import { adminSupabase } from "@/lib/supabase";
import { enforceRateLimit } from "@/lib/rateLimit";
import { DEFAULT_MAX_IMAGE_BYTES, DEFAULT_MAX_SVG_BYTES, DEFAULT_MAX_UPSCALED_IMAGE_BYTES, fetchWithSSRFProtection, getAllowedProviderHosts, getAllowedStorageHosts, isOwnedStorageUrl, normalizeUserImageUrl } from "@/lib/ssrf";
import { logger } from "@/lib/logger";

export const runtime = 'nodejs';
export const maxDuration = 120;

const ALLOWED_REMOTE_HOSTS = [...getAllowedStorageHosts(), ...getAllowedProviderHosts()];
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'image/svg+xml'];
const MAX_JSON_BODY_BYTES = Math.ceil(DEFAULT_MAX_IMAGE_BYTES * 1.4);

export async function POST(request) {
  let projectId;
  let step;
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
    ({ projectId, step } = body);
    const { base64, mimeType, fileUrl } = body;

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
    // Set when the asset is already stored in our bucket, so the step handlers
    // below record it as-is instead of uploading a second copy.
    let passthroughUrl = null;

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

      // Already sitting in our own bucket under this project — /api/trace step 1
      // uploads there directly rather than sending the image through the browser.
      // Just record it; re-downloading and re-uploading would only orphan a copy.
      if (isOwnedStorageUrl(normalizedFileUrl, { projectId })) {
        passthroughUrl = normalizedFileUrl;
      } else {
        const maxBytes = step === 3
          ? DEFAULT_MAX_SVG_BYTES
          : step === 2
            ? DEFAULT_MAX_UPSCALED_IMAGE_BYTES
            : DEFAULT_MAX_IMAGE_BYTES;
        const { response, buffer: remoteBuffer, finalUrl } = await fetchWithSSRFProtection(normalizedFileUrl, {
          allowedHosts: ALLOWED_REMOTE_HOSTS,
          maxBytes,
          timeoutMs: step === 2 ? 30_000 : 15_000,
          allowedContentTypes: [
            'image/',
            'application/octet-stream',
            'binary/octet-stream',
            'application/binary',
            'application/force-download',
          ],
        });
        if (!response.ok) throw new Error("Failed to fetch fileUrl");
        buffer = remoteBuffer;
        finalMimeType = response.headers.get('content-type')?.split(';')[0] || finalMimeType;
        ext = new URL(finalUrl).pathname.split('.').pop() || "png";
        // Sanitize extension
        if (ext.length > 4 || ext.includes("?")) ext = "png";
      }
    } else {
      return NextResponse.json({ error: "Provide either base64 or fileUrl" }, { status: 400 });
    }

    if (step === 1) {
      const finalUrl = passthroughUrl
        || await uploadToR2(buffer, `projects/${projectId}/generated_flat_${Date.now()}.${ext}`, finalMimeType);
      // ai_prompt is the project's EXTRACTION MODE (ERASE_LOGOS /
      // PRESERVE_LOGOS), not transient state. It used to be nulled here, so any
      // re-run after a failed step 2 or 3 fell through to the DEFAULT prompt —
      // silently turning "Extract Pattern Only" into "Keep All Artwork" and
      // charging another claw for the wrong output. Leave it alone.
      const { error: saveError } = await adminSupabase.from('projects').update({
        generated_image_url: finalUrl,
        zip_url: null,
        zip_signature: null,
        zip_generated_at: null
      }).eq('id', projectId).eq('user_id', user.id);
      if (saveError) throw new Error(`Database update failed: ${saveError.message}`);
      return NextResponse.json({ success: true, url: finalUrl });
    }

    if (step === 2) {
      const finalUrl = passthroughUrl
        || await uploadToR2(buffer, `projects/${projectId}/upscaled_${Date.now()}.${ext}`, finalMimeType);
      const { error: saveError } = await adminSupabase.from('projects').update({
        upscaled_image_url: finalUrl,
        zip_url: null,
        zip_signature: null,
        zip_generated_at: null
      }).eq('id', projectId).eq('user_id', user.id);
      if (saveError) throw new Error(`Database update failed: ${saveError.message}`);
      return NextResponse.json({ success: true, url: finalUrl });
    }

    if (step === 3) {
      const finalUrl = passthroughUrl
        || await uploadToR2(buffer, `projects/${projectId}/vector_${Date.now()}.svg`, "image/svg+xml");
      const { error: saveError } = await adminSupabase.from('projects').update({ svg_url: finalUrl, zip_url: null, zip_signature: null, zip_generated_at: null }).eq('id', projectId).eq('user_id', user.id);
      if (saveError) throw new Error(`Database update failed: ${saveError.message}`);
      return NextResponse.json({ success: true, url: finalUrl });
    }

    return NextResponse.json({ error: "Invalid step" }, { status: 400 });

  } catch (error) {
    const timedOut = /abort|timeout/i.test(`${error?.name || ''} ${error?.message || ''}`);
    logger.error("[Save Asset] Failed", {
      projectId,
      step,
      timedOut,
      error,
    });
    return NextResponse.json({
      error: timedOut
        ? "The processed image transfer timed out. Please retry this step."
        : "The processed image could not be stored. Please retry this step.",
      code: timedOut ? "ASSET_TRANSFER_TIMEOUT" : "ASSET_SAVE_FAILED",
    }, { status: 500 });
  }
}
