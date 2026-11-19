import sharp from "sharp";
import { DESIGN_IMAGE_MAX_PIXELS, validateDesignImage } from "@/lib/designExtractImagePolicy";

// Preserve source RGB exactly; the model supplies only coverage, never artwork.
export async function readMaskCoverage(mask, width, height) {
  const maskImage = sharp(mask, { limitInputPixels: DESIGN_IMAGE_MAX_PIXELS });
  const metadata = await maskImage.metadata();
  validateDesignImage(metadata);
  if (width !== metadata.width || height !== metadata.height) throw Object.assign(new Error("Segmentation mask dimensions do not match the original image"), { status: 422 });
  // SAM grayscale masks need one byte per pixel, not an expanded RGBA frame.
  if (metadata.space === 'b-w' && !metadata.hasAlpha) return maskImage.greyscale().raw().toBuffer();
  const maskPixels = await maskImage.toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
  const channels = maskPixels.info.channels;
  const coverage = maskPixels.data, result = Buffer.alloc(width * height);
  let useAlpha = false;
  if (channels === 4) for (let i = 3; i < coverage.length; i += 4) if (coverage[i] !== 255) { useAlpha = true; break; }
  for (let i = 0; i < coverage.length; i += channels) {
    if (!useAlpha && (Math.abs(coverage[i] - coverage[i + 1]) > 1 || Math.abs(coverage[i] - coverage[i + 2]) > 1)) throw Object.assign(new Error("Provider returned a colored preview instead of a segmentation mask"), { status: 422 });
    result[i / channels] = useAlpha ? coverage[i + 3] : coverage[i];
  }
  return result;
}
export async function applySourceMask(source, mask) {
  const sourceImage = sharp(source, { limitInputPixels: DESIGN_IMAGE_MAX_PIXELS });
  validateDesignImage(await sourceImage.metadata());
  const sourcePixels = await sourceImage.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const coverage = await readMaskCoverage(mask, sourcePixels.info.width, sourcePixels.info.height);
  const pixels = Buffer.from(sourcePixels.data);
  for (let i = 0; i < coverage.length; i++) pixels[i * 4 + 3] = Math.round(pixels[i * 4 + 3] * coverage[i] / 255);
  return sharp(pixels, { raw: sourcePixels.info }).png().toBuffer();
}
