// Split disconnected visible regions without another AI request. Nearby pieces
// stay together (for example lettering and the small parts of a logo). This does
// not invent hidden pixels or separate shapes that share one connected region.
export function* separateElements(pixels, width, height, limit = 8) {
  const count = width * height;
  if (!Number.isSafeInteger(count) || count < 1 || pixels.length !== count * 4 || !Number.isInteger(limit) || limit < 1 || limit > 32) throw new Error("Invalid element separation dimensions");
  if (limit === 1) { yield whole(pixels, width, height); return; }
  const labels = new Uint16Array(count), parts = [];
  let queue = new Uint32Array(Math.min(count, 4096));
  for (let start = 0; start < count; start++) {
    if (labels[start] || !pixels[start * 4 + 3]) continue;
    // Pattern textures can contain thousands of tiny regions. Keep that layer
    // intact instead of consuming unbounded memory or throwing detail away.
    if (parts.length === 512) { yield whole(pixels, width, height); return; }
    const id = parts.length + 1;
    const part = { ids: [id], left: width, top: height, right: -1, bottom: -1, area: 0 };
    let head = 0, tail = 1, queued = 1;
    queue[0] = start; labels[start] = id;
    while (queued) {
      const i = queue[head]; head = (head + 1) % queue.length; queued--;
      const x = i % width, y = Math.floor(i / width);
      part.left = Math.min(part.left, x); part.right = Math.max(part.right, x);
      part.top = Math.min(part.top, y); part.bottom = Math.max(part.bottom, y); part.area++;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if ((!dx && !dy) || x + dx < 0 || x + dx >= width || y + dy < 0 || y + dy >= height) continue;
        const next = i + dy * width + dx;
        if (labels[next] || !pixels[next * 4 + 3]) continue;
        if (queued === queue.length) {
          const grown = new Uint32Array(Math.min(count, queue.length * 2));
          for (let k = 0; k < queued; k++) grown[k] = queue[(head + k) % queue.length];
          queue = grown; head = 0; tail = queued;
        }
        queue[tail] = next; tail = (tail + 1) % queue.length; queued++; labels[next] = id;
      }
    }
    parts.push(part);
  }
  if (parts.length <= 1) { if (parts.length) yield whole(pixels, width, height); return; }
  const gap = Math.max(3, Math.min(16, Math.round(Math.min(width, height) / 80)));
  const distance = (a, b) => Math.hypot(Math.max(0, a.left - b.right - 1, b.left - a.right - 1), Math.max(0, a.top - b.bottom - 1, b.top - a.bottom - 1));
  const merge = (a, b) => ({ ids: [...a.ids, ...b.ids], left: Math.min(a.left, b.left), top: Math.min(a.top, b.top), right: Math.max(a.right, b.right), bottom: Math.max(a.bottom, b.bottom), area: a.area + b.area });
  let groups = [];
  // Merge nearby connected components transitively, preserving every pixel.
  for (const part of parts) {
    let next = part, changed = true;
    while (changed) {
      changed = false;
      for (let i = groups.length - 1; i >= 0; i--) if (distance(next, groups[i]) <= gap) { next = merge(next, groups[i]); groups.splice(i, 1); changed = true; }
    }
    groups.push(next);
  }
  // Attach tiny isolated marks to the nearest element rather than losing them
  // or turning a single antialiased dot into its own exported layer.
  const minimum = Math.max(4, Math.round(count / 100000));
  for (let i = groups.length - 1; i >= 0 && groups.length > 1; i--) {
    if (groups[i].area >= minimum) continue;
    const part = groups.splice(i, 1)[0];
    const nearest = groups.reduce((best, item, index) => distance(part, item) < distance(part, groups[best]) ? index : best, 0);
    groups[nearest] = merge(groups[nearest], part);
  }
  while (groups.length > limit) {
    let a = 0, b = 1, nearest = Infinity;
    for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) {
      const d = distance(groups[i], groups[j]);
      if (d < nearest) { a = i; b = j; nearest = d; }
    }
    groups[a] = merge(groups[a], groups[b]); groups.splice(b, 1);
  }
  if (groups.length === 1) { yield whole(pixels, width, height); return; }
  groups.sort((a, b) => a.top - b.top || a.left - b.left);
  for (const group of groups) {
    const bounds = { left: group.left, top: group.top, width: group.right - group.left + 1, height: group.bottom - group.top + 1 };
    const included = new Set(group.ids), data = new Uint8Array(bounds.width * bounds.height * 4);
    for (let y = 0; y < bounds.height; y++) for (let x = 0; x < bounds.width; x++) {
      const source = (bounds.top + y) * width + bounds.left + x;
      if (included.has(labels[source])) data.set(pixels.subarray(source * 4, source * 4 + 4), (y * bounds.width + x) * 4);
    }
    yield { data, bounds, separated: true };
  }
}
function whole(data, width, height) {
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (data[(y * width + x) * 4 + 3]) { left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y); }
  return { data, bounds: { left, top, width: right - left + 1, height: bottom - top + 1 }, separated: false };
}
