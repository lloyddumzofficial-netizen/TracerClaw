import sharp from "sharp";
import { maskAsset, layerAsset } from "@/lib/designExtractVariants";
import { DESIGN_IMAGE_MAX_PIXELS, validateDesignImage } from "@/lib/designExtractImagePolicy";
import { cleanDesignEdges, edgeCleanupSettings } from "@/lib/designEdgeCleanup";

// Brush edits preserve RGB. Optional defringing changes only the edge band.
export async function renderMask(source, coverage, softness = 0, cleanup) {
  const edgeCleanup = edgeCleanupSettings(cleanup);
  const sourceImage = sharp(source, { limitInputPixels: DESIGN_IMAGE_MAX_PIXELS });
  validateDesignImage(await sourceImage.metadata());
  const original = await sourceImage.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const meta = await sharp(coverage, { limitInputPixels: DESIGN_IMAGE_MAX_PIXELS }).metadata();
  validateDesignImage(meta);
  if (meta.format !== "png" || meta.width !== original.info.width || meta.height !== original.info.height) throw Object.assign(new Error("Mask must be a PNG matching native artwork dimensions"), { status: 422 });
  let pipeline = sharp(coverage).removeAlpha().greyscale();
  if (softness > 0) pipeline = pipeline.blur(Math.max(.3, softness));
  const alpha = await pipeline.raw().toBuffer();
  let pixels = Buffer.from(original.data);
  const { width, height } = original.info;
  for (let i = 0; i < width * height; i++) pixels[i * 4 + 3] = Math.round(pixels[i * 4 + 3] * alpha[i] / 255);
  // Retain unsoftened coverage separately so reopening never compounds edits.
  const rawCoverage = softness ? await sharp(coverage).removeAlpha().greyscale().raw().toBuffer() : alpha;
  const basePixels = Buffer.from(original.data);
  for (let i = 0; i < width * height; i++) basePixels[i * 4 + 3] = Math.round(basePixels[i * 4 + 3] * rawCoverage[i] / 255);
  const maskBase = await sharp(basePixels, { raw: original.info }).png().toBuffer();
  pixels = cleanDesignEdges(pixels, width, height, edgeCleanup);
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    if (pixels[i * 4 + 3]) { left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y); }
  }
  if (right < left) throw Object.assign(new Error("Keep at least one visible pixel before applying the mask"), { status: 422 });
  const bounds = { left, top, width: right - left + 1, height: bottom - top + 1 };
  const full = await sharp(pixels, { raw: original.info }).png().toBuffer();
  const trimmed = await sharp(full).extract(bounds).png().toBuffer();
  return { full, trimmed, maskBase, bounds, width, height, edgeCleanup };
}
export function maskedLayer(layer, rendered, urls) {
  const asset = maskAsset(layer), frame = asset.frame;
  const ratio = asset.width / layer.width;
  const placement = value => {
    const scale = value.scale / ratio;
    return { scale, x: value.x + (rendered.bounds.left - frame.left) * scale, y: value.y + (rendered.bounds.top - frame.top) * scale };
  };
  const next = { ...layer, url: urls.url, width: rendered.bounds.width, height: rendered.bounds.height,
    composition: placement(layer.composition), layout: placement(layer.layout),
    maskSourceUrl: asset.source, maskBaseUrl: urls.full, originalMaskUrl: layer.originalMaskUrl || asset.mask,
    nativeFrame: { width: rendered.width, height: rendered.height, left: rendered.bounds.left, top: rendered.bounds.top },
    baseVariant: layer.baseVariant || layerAsset(layer), enhancedVariant: layer.enhancedVariant || null, enhancement: null, acceptedVersion: "mask", maskRevision: (layer.maskRevision || 0) + 1 };
  return { ...next, maskedVariant: layerAsset(next) };
}
