const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));

export function moveRectangle(rect, start, point) {
  return { ...rect, x: clamp(rect.x + point.x - start.x, 0, 1 - rect.width), y: clamp(rect.y + point.y - start.y, 0, 1 - rect.height) };
}

export function resizeRectangle(rect, handle, point) {
  const left = handle.includes("w") ? clamp(point.x) : rect.x;
  const right = handle.includes("e") ? clamp(point.x) : rect.x + rect.width;
  const top = handle.includes("n") ? clamp(point.y) : rect.y;
  const bottom = handle.includes("s") ? clamp(point.y) : rect.y + rect.height;
  return { kind: "rect", x: Math.min(left, right), y: Math.min(top, bottom), width: Math.abs(right - left), height: Math.abs(bottom - top) };
}

export function selectionBounds(shapes, aspectRatio = 1) {
  let left = 1, top = 1, right = 0, bottom = 0, found = false;
  for (const shape of shapes) {
    if (shape.erase) continue;
    found = true;
    if (shape.kind === "rect") {
      left = Math.min(left, shape.x); top = Math.min(top, shape.y);
      right = Math.max(right, shape.x + shape.width); bottom = Math.max(bottom, shape.y + shape.height);
    } else for (const point of shape.points) {
      left = Math.min(left, point.x - shape.radius); top = Math.min(top, point.y - shape.radius / aspectRatio);
      right = Math.max(right, point.x + shape.radius); bottom = Math.max(bottom, point.y + shape.radius / aspectRatio);
    }
  }
  return found ? { x: clamp(left), y: clamp(top), width: clamp(right) - clamp(left), height: clamp(bottom) - clamp(top) } : null;
}
