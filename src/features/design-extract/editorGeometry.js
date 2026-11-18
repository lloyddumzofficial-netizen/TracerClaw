export function layerBounds(layer, view) {
  const placement = layer?.[view];
  if (!placement || ![placement.x, placement.y, placement.scale, layer.width, layer.height].every(Number.isFinite) || placement.scale <= 0) return null;
  return { x: placement.x, y: placement.y, width: layer.width * placement.scale, height: layer.height * placement.scale };
}

export function artworkBounds(layers, view, source) {
  const boxes = layers.filter(layer => layer.visible !== false).map(layer => layerBounds(layer, view)).filter(Boolean);
  if (source?.width > 0 && source?.height > 0) {
    boxes.push(view === "composition" ? { x: 0, y: 0, width: source.width, height: source.height } : { x: 0, y: 0, width: 240, height: 240 * source.height / source.width });
  }
  if (!boxes.length) return null;
  const x = Math.min(...boxes.map(box => box.x));
  const y = Math.min(...boxes.map(box => box.y));
  return { x, y, width: Math.max(...boxes.map(box => box.x + box.width)) - x, height: Math.max(...boxes.map(box => box.y + box.height)) - y };
}

export function frameArtwork(bounds, viewport, maxZoom = 1) {
  if (!bounds || !viewport || bounds.width <= 0 || bounds.height <= 0 || viewport.width <= 0 || viewport.height <= 0) return null;
  const zoom = Math.max(.05, Math.min(maxZoom, (viewport.width - 96) / bounds.width, (viewport.height - 120) / bounds.height));
  return { zoom, x: (viewport.width - bounds.width * zoom) / 2 - bounds.x * zoom, y: (viewport.height - bounds.height * zoom) / 2 - bounds.y * zoom + 16 };
}
