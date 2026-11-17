import sharp from "sharp";

// Preserve source RGB exactly; the model supplies only coverage, never artwork.
export async function applySourceMask(source, mask) {
  const sourcePixels = await sharp(source, { limitInputPixels: 24000000 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const maskPixels = await sharp(mask, { limitInputPixels: 24000000 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (sourcePixels.info.width !== maskPixels.info.width || sourcePixels.info.height !== maskPixels.info.height) throw Object.assign(new Error("Segmentation mask dimensions do not match the original image"), { status: 422 });
  const pixels = Buffer.from(sourcePixels.data), coverage = maskPixels.data;
  let useAlpha = false;
  for (let i = 3; i < coverage.length; i += 4) if (coverage[i] !== 255) { useAlpha = true; break; }
  for (let i = 0; i < pixels.length; i += 4) {
    if (!useAlpha && (Math.abs(coverage[i] - coverage[i + 1]) > 1 || Math.abs(coverage[i] - coverage[i + 2]) > 1)) throw Object.assign(new Error("Provider returned a colored preview instead of a segmentation mask"), { status: 422 });
    pixels[i + 3] = Math.round(pixels[i + 3] * (useAlpha ? coverage[i + 3] : coverage[i]) / 255);
  }
  return sharp(pixels, { raw: sourcePixels.info }).png().toBuffer();
}
