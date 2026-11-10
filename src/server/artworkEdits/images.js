import sharp from "sharp";
import { selectionSvg } from "@/lib/artworkEdits";
import { EDIT_REGION_COLORS } from "./regionColors";

export async function buildEditMasks(instructions, width, height) {
  const masks = [];
  const union = Buffer.alloc(width * height);
  for (const [index, instruction] of instructions.entries()) {
    const mask = await sharp(Buffer.from(selectionSvg(instruction.shapes, width, height))).removeAlpha().greyscale().raw().toBuffer();
    let selected = 0;
    for (let p = 0; p < union.length; p++) {
      if (!mask[p]) continue;
      if (union[p]) throw new Error("Selections overlap. Adjust the areas or combine their instructions.");
      selected++;
    }
    if (selected < 4) throw new Error(`Select a larger area for instruction ${index + 1}.`);
    for (let p = 0; p < union.length; p++) union[p] = Math.max(union[p], mask[p]);
    masks.push(mask);
  }
  return { masks, union };
}

export async function sourcePixels(buffer) {
  const { data, info } = await sharp(buffer, { limitInputPixels: 20_000_000 }).rotate().toColourspace("srgb").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

export async function compositeEdit(source, generated, union) {
  const edited = await sharp(generated, { limitInputPixels: 20_000_000 }).resize(source.width, source.height, { fit: "fill" }).toColourspace("srgb").ensureAlpha().raw().toBuffer();
  const output = Buffer.from(source.data);
  for (let p = 0; p < union.length; p++) {
    if (!union[p]) continue; // Deliberately byte-identical outside the selection.
    const alpha = union[p] / 255;
    for (let c = 0; c < 4; c++) output[p * 4 + c] = Math.round(source.data[p * 4 + c] * (1 - alpha) + edited[p * 4 + c] * alpha);
  }
  return sharp(output, { raw: { width: source.width, height: source.height, channels: 4 } }).png().toBuffer();
}

export async function referenceImage(source, masks) {
  const output = Buffer.from(source.data);
  // Location guide only. Never rasterize numbers, circles, pins or other UI
  // annotations: the image-editing model can reproduce them as real artwork.
  masks.forEach((mask, index) => {
    const color = EDIT_REGION_COLORS[index].rgb;
    for (let p = 0; p < mask.length; p++) {
      if (!mask[p]) continue;
      const alpha = .4 * mask[p] / 255;
      for (let c = 0; c < 3; c++) output[p * 4 + c] = Math.round(output[p * 4 + c] * (1 - alpha) + color[c] * alpha);
    }
  });
  return sharp(output, { raw: { width: source.width, height: source.height, channels: 4 } }).png().toBuffer();
}
