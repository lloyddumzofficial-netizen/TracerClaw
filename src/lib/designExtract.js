export const MAX_LAYERS = 32;
export const LAYER_MODEL = "fal-ai/qwen-image-layered";
export const SEGMENT_MODEL = "fal-ai/sam-3/image";
export function emptyManifest(width, height) {
  return { version: 1, width, height, layers: [] };
}
export function validateEdits(input, current) {
  if (!input || !Array.isArray(input.layers) || input.layers.length > MAX_LAYERS) throw new Error("Invalid layers");
  const ids = new Set();
  const layers = input.layers.map(layer => {
    const original = current.layers.find(item => item.id === layer.id);
    if (!original || ids.has(layer.id)) throw new Error("Unknown or duplicate layer");
    ids.add(layer.id);
    const placement = value => {
      if (!value || ![value.x, value.y, value.scale].every(Number.isFinite) || Math.abs(value.x) > 32768 || Math.abs(value.y) > 32768 || value.scale < .01 || value.scale > 20) throw new Error("Invalid placement");
      return { x: value.x, y: value.y, scale: value.scale };
    };
    return { ...original, name: String(layer.name || "Layer").slice(0, 100), visible: layer.visible !== false, locked: Boolean(layer.locked), composition: placement(layer.composition), layout: placement(layer.layout) };
  });
  return { ...current, layers };
}
export function acceptLayers(manifest, job) {
  const parent = manifest.layers.find(layer => layer.id === job.layer_id);
  const additions = job.result.layers.map((layer, index) => ({ ...layer,
    composition: parent ? { x: parent.composition.x + layer.composition.x * parent.composition.scale, y: parent.composition.y + layer.composition.y * parent.composition.scale, scale: parent.composition.scale * layer.composition.scale } : layer.composition,
    layout: { x: (index % 4) * 260 + 300, y: Math.floor(index / 4) * 300, scale: Math.min(220 / layer.width, 250 / layer.height, 1) },
  }));
  // Segmentation adds a cutout; decomposition replaces its parent only on accept.
  const retained = job.kind === "split" ? manifest.layers.filter(layer => layer.id !== job.layer_id) : manifest.layers;
  if (retained.length + additions.length > MAX_LAYERS) throw new Error("Maximum 32 layers");
  return { ...manifest, layers: [...retained, ...additions] };
}
