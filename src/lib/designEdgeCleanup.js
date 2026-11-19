// Shared by the native-pixel preview worker and the export renderer.
export function edgeCleanupSettings(value = {}) {
  const defringe = value?.defringe ?? 0, specks = value?.specks ?? 0;
  if (!Number.isInteger(defringe) || defringe < 0 || defringe > 3 || ![0, 4, 16].includes(specks)) {
    throw Object.assign(new Error("Invalid edge cleanup settings"), { status: 422 });
  }
  return { defringe, specks };
}

export function cleanDesignEdges(input, width, height, options) {
  const { defringe, specks } = edgeCleanupSettings(options);
  if (input.length !== width * height * 4) throw new Error("Invalid cleanup image dimensions");
  const output = new Uint8ClampedArray(input), count = width * height;
  if (specks) {
    const visited = new Uint8Array(count), queue = new Int32Array(specks + 1);
    for (let start = 0; start < count; start++) {
      if (visited[start] || !output[start * 4 + 3]) continue;
      let length = 1, large = false;
      queue[0] = start; visited[start] = 1;
      for (let head = 0; head < length && !large; head++) {
        const pixel = queue[head], x = pixel % width, y = Math.floor(pixel / width);
        for (let dy = -1; dy <= 1 && !large; dy++) for (let dx = -1; dx <= 1; dx++) {
          if ((!dx && !dy) || x + dx < 0 || x + dx >= width || y + dy < 0 || y + dy >= height) continue;
          const next = pixel + dy * width + dx;
          if (!output[next * 4 + 3]) continue;
          if (visited[next] === 2) { large = true; break; }
          if (visited[next]) continue;
          visited[next] = 1; queue[length++] = next;
          if (length > specks) { large = true; break; }
        }
      }
      for (let i = 0; i < length; i++) {
        visited[queue[i]] = large ? 2 : 3;
        if (!large) output[queue[i] * 4 + 3] = 0;
      }
    }
  }
  if (!defringe) return output;
  // Distance to transparency identifies only the narrow edge band. Solid
  // interior pixels supply colour; the original coverage is never expanded.
  const distance = new Uint8Array(count), cap = defringe + 1;
  for (let i = 0; i < count; i++) distance[i] = output[i * 4 + 3] < 250 ? 0 : cap;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    distance[i] = Math.min(distance[i], x ? distance[i - 1] + 1 : 1, y ? distance[i - width] + 1 : 1);
  }
  for (let y = height - 1; y >= 0; y--) for (let x = width - 1; x >= 0; x--) {
    const i = y * width + x;
    distance[i] = Math.min(distance[i], x + 1 < width ? distance[i + 1] + 1 : 1, y + 1 < height ? distance[i + width] + 1 : 1);
  }
  const radius = defringe + 2;
  // Bounded, linear-time nearest-solid propagation avoids searching a square
  // neighbourhood for every pixel in large semitransparent artwork.
  const nearest = new Uint32Array(count);
  for (let i = 0; i < count; i++) if (distance[i] > defringe && output[i * 4 + 3] === 255) nearest[i] = i + 1;
  const consider = (i, candidate, x, y) => {
    if (!candidate) return;
    const seed = candidate - 1, d = Math.abs(seed % width - x) + Math.abs(Math.floor(seed / width) - y);
    if (d > radius) return;
    const current = nearest[i] - 1;
    if (!nearest[i] || d < Math.abs(current % width - x) + Math.abs(Math.floor(current / width) - y)) nearest[i] = candidate;
  };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    if (x) consider(i, nearest[i - 1], x, y);
    if (y) consider(i, nearest[i - width], x, y);
  }
  for (let y = height - 1; y >= 0; y--) for (let x = width - 1; x >= 0; x--) {
    const i = y * width + x;
    if (x + 1 < width) consider(i, nearest[i + 1], x, y);
    if (y + 1 < height) consider(i, nearest[i + width], x, y);
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    if (!output[i * 4 + 3] || distance[i] > defringe) continue;
    const best = nearest[i] - 1;
    if (best >= 0) for (let c = 0; c < 3; c++) output[i * 4 + c] = input[best * 4 + c];
  }
  return output;
}
