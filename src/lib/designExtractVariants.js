const assetKeys = ["url", "width", "height", "nativeFrame", "maskBaseUrl", "maskSourceUrl", "originalMaskUrl", "coverageUrl", "edgeSoftness", "edgeCleanup", "enhancement"];
export function layerAsset(layer) {
  return Object.fromEntries(assetKeys.map(key => [key, layer[key] ?? null]));
}
export function selectVariant(layer, version) {
  const asset = version === "base" ? layer.baseVariant : version === "enhanced" ? layer.enhancedVariant : version === "mask" ? layer.maskedVariant : null;
  if (!asset) return layer;
  const ratio = layer.width / asset.width;
  return { ...layer, ...asset, acceptedVersion: version,
    layout: { ...layer.layout, scale: layer.layout.scale * ratio },
    composition: { ...layer.composition, scale: layer.composition.scale * ratio } };
}
export function maskAsset(layer) {
  const base = layer.acceptedVersion === "mask" ? layer : layer.baseVariant || layer;
  return { ...base, source: base.maskSourceUrl || base.url, mask: base.maskBaseUrl || base.url,
    frame: base.maskBaseUrl ? base.nativeFrame : { width: base.width, height: base.height, left: 0, top: 0 } };
}
