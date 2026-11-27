import { arrangeOverview } from "./designExtractLayout";
export const MAX_LAYERS = 32;
export const DESIGN_OPERATION_DEADLINE_MS = 45 * 60 * 1000;
export const LAYER_MODEL = "fal-ai/sam2/auto-segment";
export const LEGACY_LAYER_MODEL = "fal-ai/qwen-image-layered";
export const SEGMENT_MODEL = "fal-ai/sam2/image";
export const LEGACY_SEGMENT_MODEL = "fal-ai/sam-3/image";
export function emptyManifest(width, height) {
  return { version: 1, width, height, layers: [] };
}
export function validateEdits(input, current) {
  if (!input || !Array.isArray(input.layers) || input.layers.length > MAX_LAYERS) throw new Error("Invalid layers");
  const ids = new Set();
  const layers = input.layers.map(layer => {
    const original = current.layers.find(item => item.id === layer.id) || current.retiredLayers?.find(item=>item.id===layer.id);
    if (!original || ids.has(layer.id)) throw new Error("Unknown or duplicate layer");
    ids.add(layer.id);
    const placement = value => {
      if (!value || ![value.x, value.y, value.scale].every(Number.isFinite) || Math.abs(value.x) > 32768 || Math.abs(value.y) > 32768 || value.scale < .01 || value.scale > 20) throw new Error("Invalid placement");
      return { x: value.x, y: value.y, scale: value.scale };
    };
    const visibility=layer.visibility?{overview:layer.visibility.overview!==false,composition:layer.visibility.composition!==false}:original.visibility?{overview:layer.visible!==false,composition:layer.visible!==false}:undefined;
    return { ...original, ...(visibility&&{visibility}), name: String(layer.name || "Layer").slice(0, 100), visible: visibility?visibility.composition:layer.visible !== false, locked: Boolean(layer.locked), composition: placement(layer.composition), layout: placement(layer.layout) };
  });
  const retiredLayers=[...(current.retiredLayers||[]),...current.layers.filter(layer=>!ids.has(layer.id))].filter((layer,index,array)=>!ids.has(layer.id)&&array.findIndex(item=>item.id===layer.id)===index).slice(-64);
  return { ...current, layers, ...(retiredLayers.length?{retiredLayers}:{}) };
}
export function acceptLayers(manifest, job) {
  const parent = manifest.layers.find(layer => layer.id === job.layer_id);
  const additions = arrangeOverview(job.result.layers, manifest).map(layer => ({ ...layer,
    composition: parent ? { x: parent.composition.x + layer.composition.x * parent.composition.scale, y: parent.composition.y + layer.composition.y * parent.composition.scale, scale: parent.composition.scale * layer.composition.scale } : layer.composition,
  }));
  // Segmentation adds a cutout; decomposition replaces its parent only on accept.
  const retained = job.result.replaceExtraction ? [] : job.kind === "split" ? manifest.layers.filter(layer => layer.id !== job.layer_id)
    : job.result.replaceGuidedBackground ? manifest.layers.filter(layer => !layer.guidedBackground) : manifest.layers;
  if (retained.length) {
    const bottom = Math.max(...retained.map(layer => layer.layout.y + layer.height * layer.layout.scale));
    for (const layer of additions) layer.layout = { ...layer.layout, y: layer.layout.y + bottom + 64 };
  }
  if (retained.length + additions.length > MAX_LAYERS) throw new Error("Maximum 32 layers");
  const background = additions.find(layer => layer.guidedBackground);
  return { ...manifest, ...(job.kind === "extract" && additions.length && { extractionComplete: true }),
    layers: background ? [background, ...retained, ...additions.filter(layer => layer !== background)] : [...retained, ...additions] };
}
