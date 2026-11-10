import sharp from "sharp";

const ratios = [["1:1", 1], ["4:3", 4 / 3], ["3:2", 1.5], ["16:9", 16 / 9], ["3:4", .75], ["2:3", 2 / 3], ["9:16", 9 / 16], ["5:4", 1.25], ["4:5", .8]];
export const CONTEXT_VERSION = 1;

// Keep the transform with the job, rather than relying on mutable crop heuristics
// when a queued result is recovered by a later deployment.
export function editContext(source, union) {
  let left = source.width, top = source.height, right = 0, bottom = 0;
  for (let p = 0; p < union.length; p++) {
    if (!union[p]) continue;
    const x = p % source.width, y = Math.floor(p / source.width);
    left = Math.min(left, x); right = Math.max(right, x + 1);
    top = Math.min(top, y); bottom = Math.max(bottom, y + 1);
  }
  if (right <= left || bottom <= top) throw new Error("Select an area before editing.");
  const padding = Math.max(32, Math.ceil(Math.max(right - left, bottom - top) * .2));
  const targetWidth = Math.min(source.width, Math.max(256, right - left + padding * 2));
  const targetHeight = Math.min(source.height, Math.max(256, bottom - top + padding * 2));
  const candidates = ratios.map(([aspectRatio, ratio]) => {
    const height = Math.ceil(Math.max(targetHeight, targetWidth / ratio));
    return { width: Math.ceil(height * ratio), height, aspectRatio };
  }).filter(size => size.width <= source.width && size.height <= source.height);
  const size = candidates.sort((a, b) => a.width * a.height - b.width * b.height)[0]
    || { width: targetWidth, height: targetHeight, aspectRatio: "auto" };
  return {
    version: CONTEXT_VERSION, sourceWidth: source.width, sourceHeight: source.height,
    left: Math.max(0, Math.min(source.width - size.width, Math.floor((left + right - size.width) / 2))),
    top: Math.max(0, Math.min(source.height - size.height, Math.floor((top + bottom - size.height) / 2))),
    ...size,
  };
}

export function validateContext(context, source) {
  if (context?.version !== CONTEXT_VERSION || context.sourceWidth !== source.width || context.sourceHeight !== source.height
    || !["left", "top", "width", "height"].every(key => Number.isInteger(context[key]))
    || context.left < 0 || context.top < 0 || context.width < 1 || context.height < 1
    || context.left + context.width > source.width || context.top + context.height > source.height) {
    throw new Error("Invalid saved artwork edit context.");
  }
  return context;
}

export function cropMask(mask, sourceWidth, context) {
  const output = Buffer.alloc(context.width * context.height);
  for (let y = 0; y < context.height; y++) {
    const start = (context.top + y) * sourceWidth + context.left;
    mask.copy(output, y * context.width, start, start + context.width);
  }
  return output;
}

export async function cropSource(source, context) {
  const { data, info } = await sharp(source.data, { raw: { width: source.width, height: source.height, channels: 4 } })
    .extract({ left: context.left, top: context.top, width: context.width, height: context.height })
    .raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

export function sourcePng(source) {
  return sharp(source.data, { raw: { width: source.width, height: source.height, channels: 4 } }).png().toBuffer();
}

function outputError(code) {
  return Object.assign(new Error(code), { artworkOutputCode: code });
}

// Conservative geometric check, not OCR or a guarantee of semantic accuracy.
// A changed component spilling into protected context would otherwise be cut
// off silently by the authoritative mask compositor.
export async function checkEditBoundary(source, generated, union, { reviewOnly = false } = {}) {
  const metadata = await sharp(generated, { limitInputPixels: 20_000_000 }).metadata();
  if (!metadata.width || !metadata.height || Math.abs((metadata.width / metadata.height) / (source.width / source.height) - 1) > .035) {
    throw outputError("EDIT_FRAME_CHANGED");
  }
  const scale = Math.min(1, 768 / Math.max(source.width, source.height));
  const width = Math.max(1, Math.round(source.width * scale)), height = Math.max(1, Math.round(source.height * scale));
  const original = await sharp(source.data, { raw: { width: source.width, height: source.height, channels: 4 } })
    .resize(width, height).blur(.6).raw().toBuffer();
  const edited = await sharp(generated, { limitInputPixels: 20_000_000 }).toColourspace("srgb").ensureAlpha()
    .resize(width, height, { fit: "fill" }).blur(.6).raw().toBuffer();
  const mask = await sharp(union, { raw: { width: source.width, height: source.height, channels: 1 } })
    .resize(width, height, { kernel: "nearest", fit: "fill" }).raw().toBuffer();
  const stride = width + 1, integral = new Uint32Array(stride * (height + 1));
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      row += mask[y * width + x] > 0 ? 1 : 0;
      integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + row;
    }
  }
  const radius = 4;
  let protectedPixels = 0, contextChanges = 0, borderPixels = 0, borderChanges = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = y * width + x;
    if (mask[p]) continue;
    protectedPixels++;
    const changed = [0, 1, 2, 3].some(channel => Math.abs(original[p * 4 + channel] - edited[p * 4 + channel]) > 64);
    if (changed) contextChanges++;
    const x0 = Math.max(0, x - radius), x1 = Math.min(width, x + radius + 1);
    const y0 = Math.max(0, y - radius), y1 = Math.min(height, y + radius + 1);
    const near = integral[y1 * stride + x1] - integral[y0 * stride + x1] - integral[y1 * stride + x0] + integral[y0 * stride + x0];
    if (near) { borderPixels++; if (changed) borderChanges++; }
  }
  const needsReview = (borderChanges >= 12 && borderChanges / Math.max(1, borderPixels) > .04)
    || (contextChanges >= 64 && contextChanges / Math.max(1, protectedPixels) > .03);
  if (needsReview && !reviewOnly) {
    throw outputError("EDIT_OUTSIDE_SELECTION");
  }
  return { protectedPixels, contextChanges, borderPixels, borderChanges, needsReview };
}

export async function buildContextPreview(source, generated, union, context, { reviewBoundary = false } = {}) {
  const crop = await cropSource(source, context);
  const mask = cropMask(union, source.width, context);
  // Resynthesized context is discarded by the mask below. It can signal a
  // visible seam, but cannot reliably prove that the selected edit is invalid.
  // New jobs surface this as a review warning; old jobs retain their policy.
  const boundary = await checkEditBoundary(crop, generated, mask, { reviewOnly: reviewBoundary });
  const edited = await sharp(generated, { limitInputPixels: 20_000_000 }).toColourspace("srgb").ensureAlpha()
    .resize(context.width, context.height, { fit: "fill" }).raw().toBuffer();
  const output = Buffer.from(source.data);
  for (let y = 0; y < context.height; y++) for (let x = 0; x < context.width; x++) {
    const local = y * context.width + x, global = (y + context.top) * source.width + x + context.left;
    if (!union[global]) continue;
    const alpha = union[global] / 255;
    for (let c = 0; c < 4; c++) output[global * 4 + c] = Math.round(source.data[global * 4 + c] * (1 - alpha) + edited[local * 4 + c] * alpha);
  }
  return {
    buffer: await sourcePng({ ...source, data: output }),
    warningCode: boundary.needsReview ? "EDIT_BOUNDARY_REVIEW" : null,
  };
}

export async function compositeContextEdit(source, generated, union, context) {
  return (await buildContextPreview(source, generated, union, context)).buffer;
}
