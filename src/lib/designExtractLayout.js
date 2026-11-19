// Match the reference's displayed height without stretching native pixels.
export function arrangeOverview(layers, source) {
  const height = 240 * source.height / source.width;
  let x = 300, y = 0;
  return layers.map((layer, index) => {
    if (index && index % 4 === 0) { x = 300; y += height + 64; }
    const scale = Math.max(.01, Math.min(20, height / layer.height));
    const next = { ...layer, layout: { x, y, scale } };
    x += layer.width * scale + 48;
    return next;
  });
}
