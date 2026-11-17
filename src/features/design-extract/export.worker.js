import { initializeCanvas, writePsd } from "ag-psd";
import JSZip from "jszip";

initializeCanvas((width, height) => new OffscreenCanvas(width, height));
async function bitmap(blob, width, height) {
  const image = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(width || image.width, height || image.height);
  canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
  image.close();
  return canvas;
}
self.onmessage = async ({ data: { format, manifest, files, source } }) => {
  try {
    let blob;
    if (format === "zip") {
      const zip = new JSZip();
      zip.file("manifest.json", JSON.stringify(manifest, null, 2));
      for (const [index, layer] of manifest.layers.entries()) zip.file(`${index + 1}-${layer.name.replace(/[^a-zA-Z0-9_-]/g, "_")}.png`, files[index]);
      blob = await zip.generateAsync({ type: "blob" });
    } else {
      const { width, height } = manifest;
      let totalPixels = width * height;
      for (const layer of manifest.layers) totalPixels += Math.ceil(layer.width * layer.composition.scale) * Math.ceil(layer.height * layer.composition.scale);
      if (width > 16000 || height > 16000 || totalPixels > 64000000) throw new Error("This PSD is too large for browser export. Reduce layer sizes or export PNG/ZIP.");
      const composite = new OffscreenCanvas(width, height);
      const ctx = composite.getContext("2d");
      const children = [{ name: "Original reference", hidden: true, canvas: await bitmap(source) }];
      for (const [index, layer] of manifest.layers.entries()) {
        const placement = layer.composition;
        const canvas = await bitmap(files[index], Math.max(1, Math.round(layer.width * placement.scale)), Math.max(1, Math.round(layer.height * placement.scale)));
        const left = Math.round(placement.x), top = Math.round(placement.y);
        children.push({ name: layer.name, hidden: !layer.visible, transparencyProtected: layer.locked, left, top, canvas });
        if (layer.visible) ctx.drawImage(canvas, left, top);
      }
      blob = new Blob([writePsd({ width, height, canvas: composite, children }, { generateThumbnail: false })], { type: "application/octet-stream" });
    }
    self.postMessage({ blob });
  } catch (error) { self.postMessage({ error: error.message }); }
};
