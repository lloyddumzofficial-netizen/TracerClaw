// Shared by the editor preflight and worker. Check before downloading/decoding
// private layer files; ZIP and individual PNG remain available above this limit.
export function designPsdLimit(manifest) {
  const { width, height, layers = [] } = manifest;
  // The composite and hidden original reference both retain a full frame.
  let totalPixels = 2 * width * height;
  let vectorPaths=0,vectorKnots=0;
  for (const layer of layers) {
    if(layer.kind==='svg'){vectorPaths+=layer.vector?.pathCount||0;vectorKnots+=layer.vector?.knotCount||0;}
    const scale = layer.composition?.scale;
    if (![layer.width, layer.height, scale].every(value => Number.isFinite(value) && value > 0)) return 'This PSD has invalid layer dimensions. Reload the project before exporting.';
    const w = Math.max(1, Math.round(layer.width * scale));
    const h = Math.max(1, Math.round(layer.height * scale));
    if (![w, h].every(Number.isSafeInteger) || w > 16000 || h > 16000) return 'This PSD is too large for browser export. Export individual PNGs or ZIP instead.';
    totalPixels += w * h;
  }
  if(vectorPaths>5000||vectorKnots>250000)return 'This PSD exceeds editable shape limits. Download SVG or ZIP instead.';
  if (![width, height].every(value => Number.isSafeInteger(value) && value > 0) || width > 16000 || height > 16000 || totalPixels > 64000000) {
    return 'This PSD is too large for browser export. Export individual PNGs or ZIP instead.';
  }
  return null;
}
