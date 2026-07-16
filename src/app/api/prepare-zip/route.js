import { NextResponse } from "next/server";
import JSZip from "jszip";
import { createHash } from "node:crypto";
import { adminSupabase } from "@/lib/supabase";
import { deleteFromR2, uploadToR2 } from "@/lib/cloudflare";
import { enforceRateLimit } from "@/lib/rateLimit";
import {
  DEFAULT_MAX_IMAGE_BYTES,
  DEFAULT_MAX_SVG_BYTES,
  DEFAULT_MAX_UPSCALED_IMAGE_BYTES,
  fetchWithSSRFProtection,
  getAllowedStorageHosts,
  isOwnedStorageUrl,
} from "@/lib/ssrf";

export const runtime = "nodejs";
export const maxDuration = 60;

function safeFileName(name) {
  return String(name || "Untitled_Design").replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 120);
}

function assetSignature(assets) {
  return createHash("sha256")
    .update(JSON.stringify(assets.map(({ url, name }) => ({ url, name }))))
    .digest("hex");
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
      namespace: "api:prepare-zip:user",
      identifier: user.id,
      max: 6,
      window: "60 s",
      windowMs: 60_000,
    });
    if (!rateLimit.success) return rateLimit.response;

    const { projectId } = await request.json();
    if (!projectId) {
      return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
    }

    const { data: project, error: projectError } = await adminSupabase
      .from("projects")
      .select("id, user_id, name, original_image_url, generated_image_url, upscaled_image_url, svg_url, zip_url, zip_signature")
      .eq("id", projectId)
      .eq("user_id", user.id)
      .single();

    if (projectError || !project) {
      return NextResponse.json({ error: "Project not found or access denied" }, { status: 404 });
    }

    const baseName = safeFileName(project.name);
    const assets = [
      project.original_image_url && { url: project.original_image_url, name: `DesaynClaw_${baseName}_Reference.png`, maxBytes: DEFAULT_MAX_IMAGE_BYTES },
      project.generated_image_url && project.generated_image_url !== "REFUNDED" && { url: project.generated_image_url, name: `DesaynClaw_${baseName}_DesaynVision.png`, maxBytes: DEFAULT_MAX_IMAGE_BYTES },
      project.upscaled_image_url && { url: project.upscaled_image_url, name: `DesaynClaw_${baseName}_Upscaled.png`, maxBytes: DEFAULT_MAX_UPSCALED_IMAGE_BYTES },
      project.svg_url && { url: project.svg_url, name: `DesaynClaw_${baseName}_Vector.svg`, maxBytes: DEFAULT_MAX_SVG_BYTES },
    ].filter(Boolean);

    if (assets.length === 0) {
      return NextResponse.json({ error: "No files available to zip" }, { status: 400 });
    }

    const signature = assetSignature(assets);
    if (project.zip_url && project.zip_signature === signature) {
      return NextResponse.json({
        success: true,
        cached: true,
        zipUrl: project.zip_url,
        fileName: `DesaynClaw_${baseName}_AllFiles.zip`,
      });
    }

    const zip = new JSZip();
    let addedFiles = 0;

    for (const asset of assets) {
      if (!isOwnedStorageUrl(asset.url, { userId: user.id, projectId })) {
        console.warn(`[Prepare ZIP] Skipping unowned asset URL: ${asset.name}`);
        continue;
      }

      try {
        const { response, buffer } = await fetchWithSSRFProtection(asset.url, {
          allowedHosts: getAllowedStorageHosts(),
          maxBytes: asset.maxBytes,
          allowedContentTypes: ["image/", "application/octet-stream"],
        });
        if (!response.ok) {
          console.warn(`[Prepare ZIP] Skipping failed asset ${asset.name}: ${response.status}`);
          continue;
        }
        zip.file(asset.name, buffer);
        addedFiles++;
      } catch (error) {
        console.warn(`[Prepare ZIP] Skipping failed asset ${asset.name}:`, error.message);
      }
    }

    if (addedFiles === 0) {
      return NextResponse.json({ error: "No files could be added to ZIP" }, { status: 500 });
    }

    const zipBuffer = await zip.generateAsync({ type: "nodebuffer", compression: "STORE" });
    const zipKey = `projects/${projectId}/zip_${signature.slice(0, 16)}.zip`;
    const zipUrl = await uploadToR2(zipBuffer, zipKey, "application/zip");

    const { error: updateError } = await adminSupabase
      .from("projects")
      .update({
        zip_url: zipUrl,
        zip_signature: signature,
        zip_generated_at: new Date().toISOString(),
      })
      .eq("id", projectId)
      .eq("user_id", user.id);

    if (updateError) {
      throw updateError;
    }

    if (project.zip_url && project.zip_url !== zipUrl) {
      await deleteFromR2(project.zip_url, { allowedPrefixes: [`projects/${projectId}/`] });
    }

    return NextResponse.json({
      success: true,
      cached: false,
      zipUrl,
      fileName: `DesaynClaw_${baseName}_AllFiles.zip`,
    });
  } catch (error) {
    console.error("[Prepare ZIP Error]:", error);
    return NextResponse.json({ error: "Failed to prepare ZIP" }, { status: 500 });
  }
}
