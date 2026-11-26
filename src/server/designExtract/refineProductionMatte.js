import { DESIGN_IMAGE_MAX_PIXELS } from "@/lib/designExtractImagePolicy";

// Clear pixels in the mask provide evidence of the backdrop's color. Remove
// matching pixels only when connected to that backdrop through the source.
// Enclosed ink and non-uniform backdrops keep their existing coverage.
export function refineProductionMatte(original, box, alpha) {
  const { left, top, width, height } = box;
  const count = width * height;
  if (count > DESIGN_IMAGE_MAX_PIXELS) return alpha;
  const pixels = original.data;
  const stride = original.info.width * 4;
  const start = top * stride + left * 4;
  const pixelOffset = index => start + Math.floor(index / width) * stride + index % width * 4;
  const step = Math.max(1, Math.floor(count / 25000));
  const colors = new Map();
  let samples = 0, winner = 0, frequency = 0;
  for (let i = 0; i < count; i += step) {
    if (alpha[i] > 8) continue;
    const p = pixelOffset(i);
    if (pixels[p + 3] < 250) continue;
    const color = pixels[p] * 65536 + pixels[p + 1] * 256 + pixels[p + 2];
    const occurrences = (colors.get(color) || 0) + 1;
    colors.set(color, occurrences);
    if (occurrences > frequency) { winner = color; frequency = occurrences; }
    samples++;
  }
  if (samples < 120 || frequency < samples * .64) return alpha;
  const r = winner >> 16, g = winner >> 8 & 255, b = winner & 255;
  const distance = p => Math.max(Math.abs(pixels[p] - r), Math.abs(pixels[p + 1] - g), Math.abs(pixels[p + 2] - b));
  const tolerance = 7;
  let matches = 0;
  for (let i = 0; i < count; i += step) {
    const p = pixelOffset(i);
    if (alpha[i] <= 8 && pixels[p + 3] >= 250 && distance(p) <= tolerance) matches++;
  }
  if (matches < samples * .94) return alpha;

  const backdrop = new Uint8Array(count);
  const queue = new Uint32Array(count);
  let tail = 0, retained = 0, before = 0;
  const enqueue = (index, p) => {
    if (!backdrop[index] && pixels[p + 3] >= 250 && distance(p) <= tolerance) {
      backdrop[index] = 1;
      queue[tail++] = index;
    }
  };
  for (let y = 0, i = 0; y < height; y++) for (let x = 0, p = start + y * stride; x < width; x++, i++, p += 4) {
    if (alpha[i] >= 128) before++;
    if (alpha[i] <= 8) enqueue(i, p);
  }
  for (let head = 0; head < tail; head++) {
    const index = queue[head], x = index % width, p = pixelOffset(index);
    if (x > 0) enqueue(index - 1, p - 4);
    if (x < width - 1) enqueue(index + 1, p + 4);
    if (index >= width) enqueue(index - width, p - stride);
    if (index < count - width) enqueue(index + width, p + stride);
  }
  const refined = Uint8Array.from(alpha);
  for (let y = 0, i = 0; y < height; y++) for (let x = 0, p = start + y * stride; x < width; x++, i++, p += 4) {
    if (backdrop[i]) refined[i] = 0;
    else if (alpha[i] > 0 && (x > 0 && backdrop[i - 1] || x + 1 < width && backdrop[i + 1] ||
        y > 0 && backdrop[i - width] || y + 1 < height && backdrop[i + width])) {
      // Blend only the near-backdrop fringe. High-contrast detail stays intact.
      const edge = Math.min(1, Math.max(0, (distance(p) - tolerance) / 8));
      refined[i] = Math.round(alpha[i] * edge);
    }
    if (refined[i] >= 128) retained++;
  }
  return retained >= Math.max(4, before * .15) ? refined : alpha;
}
