import sharp from "sharp";
import { DESIGN_IMAGE_MAX_PIXELS } from "@/lib/designExtractImagePolicy";

export const GUIDED_BACKGROUND_MODEL = "fal-ai/ideogram/object-removal";
const limitInputPixels = DESIGN_IMAGE_MAX_PIXELS;
const invalid = message => Object.assign(new Error(message), { status: 422, designExtractError: true });

async function restoreFlatBackground(source, union, width, height) {
  const { data, info } = await sharp(source, { limitInputPixels }).toColourspace("srgb").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const histogram = new Map();
  let samples = 0;
  const sampleStep = Math.max(1, Math.floor(union.length / 50000));
  for (let i = 0; i < union.length; i += sampleStep) {
    const offset = i * 4;
    if (union[i] || data[offset + 3] !== 255) continue;
    const key = data[offset] * 65536 + data[offset + 1] * 256 + data[offset + 2];
    histogram.set(key, (histogram.get(key) || 0) + 1);
    samples++;
  }
  if (samples < 80 || samples < union.length / sampleStep * .08) return null;
  let mode = 0, frequency = 0;
  for (const [color, count] of histogram) if (count > frequency) { mode = color; frequency = count; }
  if (frequency < samples * .62) return null;
  const color = [mode >> 16, mode >> 8 & 255, mode & 255];
  const distance = offset => Math.max(Math.abs(color[0] - data[offset]), Math.abs(color[1] - data[offset + 1]), Math.abs(color[2] - data[offset + 2]));
  let outliers = 0;
  for (let i = 0; i < union.length; i += sampleStep) {
    const offset = i * 4;
    if (!union[i] && data[offset + 3] === 255 && distance(offset) > 10) outliers++;
  }
  if (outliers > samples * .025) return null;
  // The visible base is demonstrably flat. Clean sparse missed foreground
  // pixels as part of the repair, retaining nearby backdrop pixels and alpha.
  for (let i = 0; i < width * height; i++) {
    const offset = i * 4;
    if ((!union[i] && distance(offset) <= 10) || !data[offset + 3]) continue;
    data[offset] = color[0]; data[offset + 1] = color[1]; data[offset + 2] = color[2];
  }
  return sharp(data, { raw: info }).png().toBuffer();
}

export async function prepareGuidedBackground(source, masks, { detectFlat = false } = {}) {
  const { width, height } = await sharp(source, { limitInputPixels }).metadata();
  const union = Buffer.alloc(width * height);
  for await (const bytes of masks) {
    const image = sharp(bytes, { limitInputPixels });
    const info = await image.metadata();
    if (!info.hasAlpha || info.width !== width || info.height !== height) throw invalid("The background mask does not align with the original.");
    const alpha = await image.extractChannel(3).raw().toBuffer();
    for (let i = 0; i < alpha.length; i++) if (alpha[i] >= 8) union[i] = 255;
  }
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0, i = 0; y < height; y++) for (let x = 0; x < width; x++, i++) {
    if (!union[i]) continue;
    left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  if (right < left) throw invalid("No visible area was selected for the background fill.");
  if (detectFlat) {
    const restored = await restoreFlatBackground(source, union, width, height);
    if (restored) return { restored };
  }
  const padding = Math.max(24, Math.round(Math.max(right - left, bottom - top) * .20));
  const box = { left: Math.max(0, left - padding), top: Math.max(0, top - padding) };
  box.width = Math.min(width, right + padding + 1) - box.left;
  box.height = Math.min(height, bottom + padding + 1) - box.top;

  const rawMask = { width, height, channels: 1 };
  const core = await sharp(union, { raw: rawMask }).extract(box).greyscale().raw().toBuffer();
  const frame = { width: box.width, height: box.height, channels: 1 };
  const bleed = Math.min(16, Math.max(3, Math.ceil(Math.max(right - left, bottom - top) * .012)));
  // Sharp's erode operation expands white (the removal area). Include the
  // antialiased logo fringe before feathering into untouched fabric.
  const solid = await sharp(core, { raw: frame }).erode(bleed).greyscale().raw().toBuffer();
  const blend = await sharp(solid, { raw: frame }).blur(.85).greyscale().raw().toBuffer();
  for (let i = 0; i < blend.length; i++) {
    if (solid[i]) blend[i] = 255;
    else if (blend[i] < 4) blend[i] = 0;
  }
  const crop = await sharp(source, { limitInputPixels }).extract(box).png().toBuffer();
  const { data: image, info } = await sharp(crop).resize(1536, 1536, { fit: "inside", withoutEnlargement: true }).png().toBuffer({ resolveWithObject: true });
  const preview = { width: info.width, height: info.height };
  const mask = await sharp(blend, { raw: frame }).resize(preview.width, preview.height, { fit: "fill" }).threshold(1).png().toBuffer();
  const blendPng = await sharp(blend, { raw: frame }).greyscale().png().toBuffer();
  return { image, mask, blend: blendPng, box, preview };
}

// The model can change an entire crop. Only its masked pixels are accepted.
// The original canvas alpha remains valid, including any pre-existing holes.
export async function blendGuidedBackground(source, output, blend, { box, preview }) {
  const replacement = sharp(output, { limitInputPixels });
  const info = await replacement.metadata();
  if (info.width !== preview.width || info.height !== preview.height) throw invalid("The filled background did not align with the original.");
  const filled = await replacement.resize(box.width, box.height, { fit: "fill" }).toColourspace("srgb").ensureAlpha().raw().toBuffer();
  const coverage = await sharp(blend, { limitInputPixels }).greyscale().raw().toBuffer();
  const original = await sharp(source, { limitInputPixels }).toColourspace("srgb").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (coverage.length !== box.width * box.height || box.left + box.width > original.info.width || box.top + box.height > original.info.height) throw invalid("The background blend mask did not align.");
  for (let y = 0, i = 0; y < box.height; y++) for (let x = 0; x < box.width; x++, i++) {
    const weight = coverage[i] / 255;
    if (!weight) continue;
    if (filled[i * 4 + 3] !== 255) throw invalid("The filled background still has transparency in the area being repaired.");
    const target = ((box.top + y) * original.info.width + box.left + x) * 4;
    for (let c = 0; c < 3; c++) original.data[target + c] = Math.round(original.data[target + c] * (1 - weight) + filled[i * 4 + c] * weight);
  }
  return sharp(original.data, { raw: original.info }).png().toBuffer();
}
