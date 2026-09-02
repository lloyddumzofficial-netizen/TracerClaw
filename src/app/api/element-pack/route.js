import { NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase";
import { uploadToR2 } from "@/lib/cloudflare";
import { enforceRateLimit } from "@/lib/rateLimit";
import { logger } from "@/lib/logger";
import {
  fetchWithSSRFProtection,
  getAllowedStorageHosts,
  isOwnedStorageUrl,
} from "@/lib/ssrf";
import { ELEMENT_PACK_LIMITS } from "@/lib/element-pack/constants";
import { buildElementPackSignature, createElementPackZip } from "@/lib/element-pack/createElementPack";

export const runtime = "nodejs";
export const maxDuration = 60;

function pickSourceUrl(project) {
  return (
    (project.upscaled_image_url && project.upscaled_image_url !== "REFUNDED" && project.upscaled_image_url) ||
    (project.generated_image_url && project.generated_image_url !== "REFUNDED" && project.generated_image_url) ||
    project.original_image_url
  );
}

export async function POST(request) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = authHeader.replace("Bearer ", "").trim();
    const { data: { user }, error: authError } = await adminSupabase.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized: invalid session" }, { status: 401 });
    }

    const rateLimit = await enforceRateLimit({
      namespace: "api:element-pack:user",
      identifier: user.id,
      max: ELEMENT_PACK_LIMITS.rateLimitPerHour,
      window: "1 h",
      windowMs: 60 * 60_000,
    });
    if (!rateLimit.success) return rateLimit.response;

    const { projectId } = await request.json();
    if (!projectId) {
      return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
    }

    const { data: project, error: projectError } = await adminSupabase
      .from("projects")
      .select("*")
      .eq("id", projectId)
      .eq("user_id", user.id)
      .single();

    if (projectError || !project) {
      return NextResponse.json({ error: "Project not found or access denied" }, { status: 404 });
    }

    const sourceUrl = pickSourceUrl(project);
    if (!sourceUrl) {
      return NextResponse.json({ error: "No source image is available for this project." }, { status: 400 });
    }

    if (!isOwnedStorageUrl(sourceUrl, { userId: user.id, projectId })) {
      return NextResponse.json({ error: "Source image is outside your project storage." }, { status: 400 });
    }

    const signature = buildElementPackSignature(project, sourceUrl);
    if (project.element_pack_url && project.element_pack_signature === signature) {
      return NextResponse.json({
        success: true,
        cached: true,
        zipUrl: project.element_pack_url,
        fileName: `DesaynClaw_${project.name || "Untitled_Design"}_ElementPack.zip`,
        elementCount: project.element_pack_count || 0,
      });
    }

    const { response, buffer } = await fetchWithSSRFProtection(sourceUrl, {
      allowedHosts: getAllowedStorageHosts(),
      maxBytes: ELEMENT_PACK_LIMITS.maxSourceBytes,
      allowedContentTypes: ["image/"],
    });

    if (!response.ok) {
      return NextResponse.json({ error: "Could not download the project image." }, { status: 502 });
    }

    const pack = await createElementPackZip({ project, sourceBuffer: buffer, sourceUrl });
    if (pack.elementCount === 0) {
      return NextResponse.json({
        error: "No separate design elements were detected. Try an image with clearer contrast or transparent background.",
      }, { status: 422 });
    }

    const zipKey = `projects/${projectId}/element-pack_${signature.slice(0, 16)}.zip`;
    const zipUrl = await uploadToR2(pack.zipBuffer, zipKey, "application/zip");

    const { error: updateError } = await adminSupabase
      .from("projects")
      .update({
        element_pack_url: zipUrl,
        element_pack_signature: signature,
        element_pack_count: pack.elementCount,
        element_pack_generated_at: new Date().toISOString(),
      })
      .eq("id", projectId)
      .eq("user_id", user.id);

    const persistenceWarning = updateError
      ? "Element pack was created, but metadata could not be cached until the database migration is applied."
      : null;

    if (updateError) {
      logger.warn("[Element Pack] Metadata update skipped", { projectId, message: updateError.message });
    }

    return NextResponse.json({
      success: true,
      cached: false,
      zipUrl,
      fileName: pack.fileName,
      elementCount: pack.elementCount,
      warning: persistenceWarning,
    });
  } catch (error) {
    logger.error("[Element Pack] Request failed", error);
    return NextResponse.json({ error: "Failed to create element pack." }, { status: 500 });
  }
}

