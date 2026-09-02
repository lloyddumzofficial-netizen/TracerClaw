import JSZip from "jszip";
import { createHash } from "node:crypto";
import { segmentImageToElements } from "./segmentImage";
import { ELEMENT_PACK_VERSION } from "./constants";
import { elementFileName, safeElementPackName } from "./fileNames";

export function buildElementPackSignature(project, sourceUrl) {
  return createHash("sha256")
    .update(JSON.stringify({
      version: ELEMENT_PACK_VERSION,
      projectId: project.id,
      updatedAt: project.updated_at,
      sourceUrl,
    }))
    .digest("hex");
}

export async function createElementPackZip({ project, sourceBuffer, sourceUrl }) {
  const baseName = safeElementPackName(project.name);
  const pack = await segmentImageToElements(sourceBuffer);
  const zip = new JSZip();

  zip.file(`DesaynClaw_${baseName}_Reference.png`, pack.previewPng);

  const manifest = {
    app: "DesaynClaw",
    type: "Element Pack",
    version: ELEMENT_PACK_VERSION,
    projectId: project.id,
    projectName: project.name,
    sourceUrl,
    canvas: { width: pack.width, height: pack.height },
    generatedAt: new Date().toISOString(),
    elements: pack.elements.map((element) => {
      const { left, top, width, height, sourcePixels } = element.box;
      return {
        name: elementFileName(element.index, element.box),
        bounds: { left, top, width, height },
        sourcePixels,
      };
    }),
  };

  for (const element of pack.elements) {
    zip.file(elementFileName(element.index, element.box), element.buffer);
  }

  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  zip.file(
    "README.txt",
    [
      "DesaynClaw Element Pack",
      "",
      "Open the PNG files inside /elements in Photoshop, Illustrator, Canva, or any editor that supports transparent PNGs.",
      "This pack is generated with local image segmentation first, so it does not spend AI credits unless a future AI refine mode is added.",
    ].join("\n")
  );

  const zipBuffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });

  return {
    zipBuffer,
    elementCount: pack.elements.length,
    previewPng: pack.previewPng,
    manifest,
    fileName: `DesaynClaw_${baseName}_ElementPack.zip`,
  };
}
