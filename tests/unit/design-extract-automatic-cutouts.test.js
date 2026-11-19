import { describe, it, expect, vi } from "vitest";
import sharp from "sharp";
import { automaticCutouts } from "@/server/designExtract/automaticCutouts";
import { readMaskCoverage } from '@/server/designExtract/sourceMask';
const png = (data, width, height, channels) => sharp(Buffer.from(data), { raw: { width, height, channels } }).png().toBuffer();
async function collect(source, masks, limit = 32) {
  const readMask = vi.fn(async url => masks[Number(url)]), warnings = new Set(), layers = [];
  for await (const layer of automaticCutouts(source, masks.map((_, index) => ({ url: String(index) })), { readMask, limit, warnings })) layers.push(layer);
  return { layers, warnings, readMask };
}
async function checkPixels(layers, original, width, height) {
  const alpha = new Uint8Array(width * height);
  for (const layer of layers) {
    const data = await sharp(layer.bytes).ensureAlpha().raw().toBuffer();
    for (let i = 0; i < alpha.length; i++) {
      if (data[i * 4 + 3]) expect([...data.subarray(i * 4, i * 4 + 3)]).toEqual([...original.subarray(i * 4, i * 4 + 3)]);
      alpha[i] = Math.round(data[i * 4 + 3] + alpha[i] * (255 - data[i * 4 + 3]) / 255);
    }
  }
  for (let i = 0; i < alpha.length; i++) expect(Math.abs(alpha[i] - original[i * 4 + 3])).toBeLessThanOrEqual(1);
}
describe("automatic source-pixel cutouts", () => {
  it('reads native grayscale masks without expanding an RGBA frame or changing coverage',async()=>{
    const coverage=Buffer.from([0,1,127,254,255]);
    const mask=await sharp(coverage,{raw:{width:5,height:1,channels:1}}).toColourspace('b-w').png().toBuffer();
    expect((await sharp(mask).metadata()).space).toBe('b-w');
    expect(await readMaskCoverage(mask,5,1)).toEqual(coverage);
  });
  it("deduplicates masks, isolates children from parents and retains unmatched artwork", async () => {
    const original = Buffer.from(Array.from({ length: 16 }, () => [21, 117, 203, 255]).flat());
    const source = await png(original, 4, 4, 4);
    const child = await png([255, 255, 0, 0, ...Array(12).fill(0)], 4, 4, 1);
    const parent = await png([...Array(12).fill(255), 0, 0, 0, 0], 4, 4, 1);
    const { layers } = await collect(source, [parent, child, child]);
    expect(layers).toHaveLength(3); expect(layers.at(-1).name).toBe("Remaining artwork");
    expect(layers.map(layer => layer.index)).toEqual([0, 1, 2]);
    const first = await sharp(layers[0].bytes).raw().toBuffer(), second = await sharp(layers[1].bytes).raw().toBuffer();
    expect(first[3]).toBe(255); expect(second[3]).toBe(0);
    await checkPixels(layers, original, 4, 4);
  });
  it("preserves soft original alpha and native RGB across overlapping masks", async () => {
    const original = Buffer.from([21, 117, 203, 128, 14, 80, 170, 200, 100, 40, 9, 255, 11, 12, 13, 0]);
    const source = await png(original, 4, 1, 4);
    const a = await png([180, 0, 128, 0], 4, 1, 1), b = await png([255, 190, 255, 0], 4, 1, 1);
    const { layers } = await collect(source, [a, b]);
    await checkPixels(layers, original, 4, 1);
  });
  it("reserves residual content within the available project layer budget", async () => {
    const original = Buffer.from(Array.from({ length: 4 }, () => [10, 40, 80, 255]).flat());
    const source = await png(original, 4, 1, 4), masks = [];
    for (let i = 0; i < 4; i++) masks.push(await png(Array.from({ length: 4 }, (_, j) => i === j ? 255 : 0), 4, 1, 1));
    const { layers, warnings } = await collect(source, masks, 2);
    expect(layers).toHaveLength(2); expect(warnings.size).toBe(1);
    await checkPixels(layers, original, 4, 1);
  });
  it("rejects empty, mismatched and colored-preview masks without treating the source as a successful extraction", async () => {
    const source = await png([10, 20, 30, 255], 1, 1, 4);
    await expect(collect(source, [await png([0], 1, 1, 1)])).rejects.toMatchObject({ status: 422 });
    await expect(collect(source, [await png([255, 255], 2, 1, 1)])).rejects.toMatchObject({ status: 422 });
    await expect(collect(source, [await png([255, 0, 0], 1, 1, 3)])).rejects.toMatchObject({ status: 422 });
  });
});
