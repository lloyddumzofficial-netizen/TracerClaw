import {
  DEFAULT_MAX_IMAGE_BYTES,
  DEFAULT_MAX_SVG_BYTES,
  DEFAULT_MAX_UPSCALED_IMAGE_BYTES,
  DEFAULT_MAX_ZIP_BYTES,
  fetchWithSSRFProtection,
  getAllowedStorageHosts,
  isOwnedStorageUrl,
} from "@/lib/ssrf";
import { logger } from "@/lib/logger";

export function safeExportName(name) {
  return String(name || "Untitled_Design")
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120) || "Untitled_Design";
}

export function buildProjectExportAssets(project) {
  const baseName = safeExportName(project?.name);
  return [
    project?.original_image_url && {
      url: project.original_image_url,
      name: `DesaynClaw_${baseName}_Reference.png`,
      maxBytes: DEFAULT_MAX_IMAGE_BYTES,
      contentType: "image/png",
    },
    project?.generated_image_url && project.generated_image_url !== "REFUNDED" && {
      url: project.generated_image_url,
      name: `DesaynClaw_${baseName}_FlatExtract.png`,
      maxBytes: DEFAULT_MAX_IMAGE_BYTES,
      contentType: "image/png",
    },
    project?.upscaled_image_url && {
      url: project.upscaled_image_url,
      name: `DesaynClaw_${baseName}_Upscaled.png`,
      maxBytes: DEFAULT_MAX_UPSCALED_IMAGE_BYTES,
      contentType: "image/png",
    },
    project?.svg_url && {
      url: project.svg_url,
      name: `DesaynClaw_${baseName}_Vector.svg`,
      maxBytes: DEFAULT_MAX_SVG_BYTES,
      contentType: "image/svg+xml",
    },
    project?.zip_url && {
      url: project.zip_url,
      name: `DesaynClaw_${baseName}_AllFiles.zip`,
      maxBytes: DEFAULT_MAX_ZIP_BYTES,
      contentType: "application/zip",
    },
  ].filter(Boolean);
}

export async function fetchOwnedProjectAsset(asset, { userId, projectId }) {
  if (!isOwnedStorageUrl(asset.url, { userId, projectId })) {
    throw new Error("Asset does not belong to this user/project");
  }

  const { response, buffer } = await fetchWithSSRFProtection(asset.url, {
    allowedHosts: getAllowedStorageHosts(),
    maxBytes: asset.maxBytes,
    allowedContentTypes: ["image/", "application/zip", "application/octet-stream", "text/plain"],
  });
  if (!response.ok) {
    logger.warn("[Integrations] Asset fetch failed", { status: response.status, projectId });
    throw new Error("Failed to fetch project asset");
  }

  return {
    buffer,
    contentType: response.headers.get("content-type") || asset.contentType || "application/octet-stream",
  };
}
