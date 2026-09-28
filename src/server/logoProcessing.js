import sharp from "sharp";

const LOGO_TARGET_EDGE = 6000;
const LOGO_TARGET_PIXELS = 20e6;
const LOGO_MAX_SCALE = 5;

export function calculateLogoUpscaleDimensions(width, height) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("Logo image dimensions are invalid");
  }

  const byEdge = LOGO_TARGET_EDGE / Math.max(width, height);
  const byArea = Math.sqrt(LOGO_TARGET_PIXELS / (width * height));
  let scale = Math.floor(Math.min(LOGO_MAX_SCALE, byEdge, byArea) * 2) / 2;
  scale = Math.max(1, scale);

  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale,
  };
}

export async function prepareLogoSource(sourceBuffer) {
  const { data, info } = await sharp(sourceBuffer, { failOn: "none" })
    .rotate()
    .png({ compressionLevel: 6, effort: 3 })
    .toBuffer({ resolveWithObject: true });

  return {
    buffer: data,
    width: info.width,
    height: info.height,
    mimeType: "image/png",
  };
}

export async function upscaleLogoDeterministically(sourceBuffer) {
  const metadata = await sharp(sourceBuffer, { failOn: "none" }).metadata();
  const target = calculateLogoUpscaleDimensions(metadata.width, metadata.height);

  // Logo sources are commonly small JPEGs or screenshots. A plain Lanczos
  // resize only magnifies their blur and block noise. Remove isolated source
  // compression specks *before* enlargement, then restore edge acutance with
  // a controlled unsharp mask. This is deterministic image restoration: it
  // cannot redraw letters, mascots, colors, or composition.
  const cleanedSource = target.scale > 1
    ? await sharp(sourceBuffer, { failOn: "none" })
      .median(3)
      .png({ compressionLevel: 3, effort: 1 })
      .toBuffer()
    : sourceBuffer;

  const { data, info } = await sharp(cleanedSource, { failOn: "none" })
    .resize(target.width, target.height, {
      fit: "fill",
      kernel: sharp.kernel.lanczos3,
    })
    .sharpen({
      sigma: 1.15,
      m1: 1.15,
      m2: 2,
      x1: 2,
      y2: 10,
      y3: 20,
    })
    .png({ compressionLevel: 6, effort: 3 })
    .toBuffer({ resolveWithObject: true });

  return {
    buffer: data,
    width: info.width,
    height: info.height,
    scale: target.scale,
    mimeType: "image/png",
  };
}
