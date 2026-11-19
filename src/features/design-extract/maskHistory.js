// Mask history stores coverage only: RGB is immutable and the three gray mask
// channels are identical. Avoid retaining four bytes per pixel per undo step.
export function packMaskCoverage(rgba) {
  const coverage = new Uint8Array(rgba.length / 4);
  for (let i = 0; i < coverage.length; i++) coverage[i] = rgba[i * 4];
  return coverage;
}
export function unpackMaskCoverage(coverage) {
  const rgba = new Uint8ClampedArray(coverage.length * 4);
  for (let i = 0; i < coverage.length; i++) {
    rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = coverage[i];
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}
export function maskHistoryLimit(width, height) {
  return Math.max(1, Math.min(12, Math.floor(64_000_000 / (width * height))));
}
