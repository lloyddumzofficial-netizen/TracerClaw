import sharp from "sharp";
import { readMaskCoverage } from "./sourceMask";
import { DESIGN_IMAGE_MAX_PIXELS, DESIGN_ASSET_MAX_BYTES, validateDesignImage } from "@/lib/designExtractImagePolicy";

function similar(a, b) {
  let union = 0, intersection = 0;
  for (let i = 0; i < a.length; i++) { const x = a[i] >= 128, y = b[i] >= 128; if (x || y) union++; if (x && y) intersection++; }
  return union && intersection / union > .95;
}

// Parent masks often include smaller objects. Allocate smaller regions first,
// then subtract their already-composited alpha from parent/background masks.
// The residual layer retains any source content the model did not isolate.
export async function* automaticCutouts(source, images, { readMask, limit, warnings = new Set() }) {
  if (!Number.isInteger(limit) || limit < 2 || limit > 32) throw Object.assign(new Error("Make room for at least two extracted layers"), { status: 422 });
  const image = sharp(source, { limitInputPixels: DESIGN_IMAGE_MAX_PIXELS });
  validateDesignImage(await image.metadata());
  const original = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = original.info, count = width * height;
  let retained = [], totalBytes = 0;
  if (images.length > 64) warnings.add("Some small regions stayed in Remaining artwork because the detection limit was reached.");
  for (const entry of images.slice(0, 64)) {
    if (typeof entry?.url !== "string") throw Object.assign(new Error("Provider returned an invalid mask"), { status: 422 });
    const bytes = await readMask(entry.url);
    totalBytes += bytes.length;
    if (totalBytes > DESIGN_ASSET_MAX_BYTES) throw Object.assign(new Error("Segmentation masks exceed safe processing limits"), { status: 422 });
    const coverage = await readMaskCoverage(bytes, width, height);
    let area = 0;
    for (let i = 0; i < count; i++) if (coverage[i] && original.data[i * 4 + 3]) area++;
    if (!area) continue;
    const thumbnail = await sharp(coverage, { raw: { width, height, channels: 1 } }).resize(96, 96, { kernel: "nearest", fit: "fill" }).raw().toBuffer();
    if (retained.some(candidate => similar(candidate.thumbnail, thumbnail))) continue;
    retained.push({ bytes, area, thumbnail });
  }
  if (retained.length >= limit) {
    retained.sort((a, b) => b.area - a.area);
    retained = retained.slice(0, limit - 1);
    warnings.add("Some small regions stayed in Remaining artwork to keep this project within its layer limit.");
  }
  retained.sort((a, b) => a.area - b.area);
  const covered = new Uint8Array(count);
  let index = 0;
  async function render(coverage, residual = false) {
    const pixels = Buffer.from(original.data);
    let visible = false;
    for (let i = 0; i < count; i++) {
      const previous = covered[i], nativeAlpha = original.data[i * 4 + 3];
      const target = residual ? nativeAlpha : Math.round(nativeAlpha * coverage[i] / 255);
      const alpha = previous < target ? Math.min(255, Math.round((target - previous) * 255 / (255 - previous))) : 0;
      pixels[i * 4 + 3] = alpha;
      if (!alpha) pixels[i * 4] = pixels[i * 4 + 1] = pixels[i * 4 + 2] = 0;
      covered[i] = Math.round(alpha + previous * (255 - alpha) / 255);
      if (alpha) visible = true;
    }
    return visible ? sharp(pixels, { raw: original.info }).png().toBuffer() : null;
  }
  for (const candidate of retained) {
    const coverage = await readMaskCoverage(candidate.bytes, width, height);
    const bytes = await render(coverage);
    if (bytes) yield { index: index++, name: `Element ${index}`, bytes };
  }
  if (!index) throw Object.assign(new Error("No visible elements were detected. Your original artwork is unchanged."), { status: 422, designExtractError: true });
  const residual = await render(null, true);
  if (residual) yield { index, name: "Remaining artwork", bytes: residual };
}
