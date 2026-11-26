import sharp from "sharp";
import { expect, it, vi } from "vitest";
import { automaticCutouts } from "@/server/designExtract/automaticCutouts";
import { flatColorMasks } from "@/server/designExtract/flatColorMasks";

const raw = bytes => sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

it("groups both sides of a flat print and preserves every native pixel across the stack", async () => {
  const source = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="160" height="192" viewBox="0 0 160 192">
    <rect width="160" height="192" fill="#fcfaf9"/>
    <path d="M0 0h54L0 78Z M106 0h54v78Z" fill="#074b36"/>
    <path d="M0 44Q64 92 39 167Q90 98 0 44Z" fill="#fa8bac"/>
    <path d="M160 46Q102 91 126 168Q75 95 160 46Z" fill="#d1809d"/>
    <path d="M4 177L51 138L32 175Z M102 177L109 149L157 183Z" fill="#a9b67d"/>
  </svg>`)).png().toBuffer();
  const readMask = vi.fn();
  const layers = [];
  for await (const { name, bytes } of automaticCutouts(source, [{ url: "unneeded-mask" }], { readMask, limit: 32, groupFlatColors: true })) {
    layers.push({ name, ...(await raw(bytes)) });
  }
  expect(readMask).not.toHaveBeenCalled();
  expect(layers.map(layer => layer.name).sort()).toEqual(["Olive artwork", "Pink artwork", "Remaining artwork", "Teal artwork"]);
  const pink = layers.find(layer => layer.name === "Pink artwork"), { width } = pink.info;
  for (const [left, right] of [[0, 79], [80, 159]]) {
    let visible = 0;
    for (let y = 48; y < 155; y++) for (let x = left; x <= right; x++) if (pink.data[(y * width + x) * 4 + 3] > 200) visible++;
    expect(visible).toBeGreaterThan(100);
  }
  const original = (await raw(source)).data;
  let identical = true;
  for (let offset = 0; offset < original.length; offset += 4) {
    let alpha = 0;
    for (const layer of layers) {
      const over = layer.data[offset + 3];
      if (over && layer.data.subarray(offset, offset + 3).compare(original.subarray(offset, offset + 3)) !== 0) identical = false;
      alpha = Math.round(over + alpha * (255 - over) / 255);
    }
    if (alpha !== original[offset + 3]) identical = false;
  }
  expect(identical).toBe(true);
});

it("keeps gradients on the segmentation path", async () => {
  const width = 64, height = 64;
  const data = Buffer.alloc(width * height * 4, 255);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = (y * width + x) * 4;
    data[offset] = x * 4;
    data[offset + 1] = y * 4;
    data[offset + 2] = (63 - x) * 4;
  }
  const info = { width, height, channels: 4 };
  expect(flatColorMasks({ data, info }, 32)).toBeNull();
  const mask = Buffer.alloc(width * height);
  mask.fill(255, 0, width * 12);
  const png = await sharp(mask, { raw: { width, height, channels: 1 } }).png().toBuffer();
  const readMask = vi.fn(async () => png), source = await sharp(data, { raw: info }).png().toBuffer();
  const outputs = await Array.fromAsync(automaticCutouts(source, [{ url: "segmentation-mask" }], { readMask, limit: 32, groupFlatColors: true }));
  expect(readMask).toHaveBeenCalledExactlyOnceWith("segmentation-mask");
  expect(outputs.map(layer => layer.name)).toEqual(["Element 1", "Remaining artwork"]);
});
