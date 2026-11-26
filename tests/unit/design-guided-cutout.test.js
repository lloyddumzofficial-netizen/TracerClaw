import sharp from "sharp";
import { expect, it } from "vitest";
import { guidedPreview, renderGuidedCutout } from "@/server/designExtract/guidedCutout";
import { blendGuidedBackground, prepareGuidedBackground } from "@/server/designExtract/guidedBackground";
import { acceptLayers } from "@/lib/designExtract";

const pixel = (rgba, width, x, y) => [...rgba.subarray((y * width + x) * 4, (y * width + x + 1) * 4)];
const png = (data, width, height) => sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();

it("sends a proportional crop and keeps isolated elements aligned with native source pixels", async () => {
  const width = 40, height = 30;
  const raw = Buffer.alloc(width * height * 4);
  for (let i = 0; i < raw.length; i += 4) raw.set([193, 109, 38, 255], i);
  const source = await png(raw, width, height);
  const box = { left: 4, top: 6, width: 16, height: 12 };
  expect((await guidedPreview(source, box)).info).toMatchObject({ width: 16, height: 12 });
  const preview = { width: 8, height: 6 };
  const provider = Buffer.alloc(preview.width * preview.height * 4);
  for (let y = 1; y < 5; y++) for (let x = 1; x < 5; x++) provider.set([7, 20, 200, 254], (y * preview.width + x) * 4);
  const mask = await png(provider, preview.width, preview.height);
  const [first] = await Array.fromAsync(renderGuidedCutout(source, mask, { name: "Crown", box, preview }, []));
  const result = await sharp(first.bytes).raw().toBuffer();
  expect(first).toMatchObject({ name: "Crown", guidedElement: true });
  expect(pixel(result, width, 10, 12)).toEqual([193, 109, 38, 255]);
  expect(pixel(result, width, 0, 0)).toEqual([0, 0, 0, 0]);
  const [second] = await Array.fromAsync(renderGuidedCutout(source, mask, { name: "Lettering", box: { ...box, left: 22 }, preview }, [first.bytes]));
  const secondPixels = await sharp(second.bytes).raw().toBuffer();
  expect(pixel(secondPixels, width, 28, 12)).toEqual([193, 109, 38, 255]);
  expect(pixel(secondPixels, width, 10, 12)).toEqual([0, 0, 0, 0]);
});

it("fills both removed elements, leaves the surrounding texture byte-for-byte intact, and preserves source alpha", async () => {
  const width = 100, height = 90;
  const rgba = Buffer.alloc(width * height * 4);
  for (let p = 0; p < rgba.length; p += 4) rgba.set([111, 145, 150, 255], p);
  rgba[3] = 0;
  const subject = Buffer.alloc(rgba.length);
  for (const left of [28, 55]) for (let y = 35; y < 45; y++) for (let x = left; x < left + 9; x++) subject[(y * width + x) * 4 + 3] = 254;
  const original = await png(rgba, width, height);
  const prepared = await prepareGuidedBackground(original, [await png(subject, width, height)]);
  const fromModel = await sharp({ create: { ...prepared.preview, channels: 3, background: "#275d54" } }).png().toBuffer();
  const fill = await blendGuidedBackground(original, fromModel, prepared.blend, prepared);
  const output = await sharp(fill).raw().toBuffer();
  expect(pixel(output, width, 30, 39)).toEqual([39, 93, 84, 255]);
  expect(pixel(output, width, 27, 39)).toEqual([39, 93, 84, 255]);
  expect(pixel(output, width, 57, 39)).toEqual([39, 93, 84, 255]);
  expect(pixel(output, width, 20, 28)).toEqual([111, 145, 150, 255]);
  expect(pixel(output, width, 0, 0)).toEqual([111, 145, 150, 0]);
  expect(output.filter((_, index) => index % 4 === 3)).toEqual(rgba.filter((_, index) => index % 4 === 3));
});

it("rejects opaque or resized provider output instead of offering a rectangle as a cutout", async () => {
  const source = await sharp({ create: { width: 24, height: 24, channels: 4, background: "#a9b852" } }).png().toBuffer();
  const settings = { name: "Emblem", box: { left: 0, top: 0, width: 24, height: 24 }, preview: { width: 24, height: 24 } };
  await expect(Array.fromAsync(renderGuidedCutout(source, source, settings, []))).rejects.toMatchObject({ status: 422 });
  const wrongSize = await sharp(source).resize(23, 24).png().toBuffer();
  await expect(Array.fromAsync(renderGuidedCutout(source, wrongSize, settings, []))).rejects.toMatchObject({ status: 422 });
});

it("restores a demonstrably flat production backdrop without generating new graphics", async () => {
  const width = 100, height = 100;
  const rgba = Buffer.alloc(width * height * 4);
  const mask = Buffer.alloc(rgba.length);
  for (let p = 0; p < rgba.length; p += 4) rgba.set([12, 12, 12, 255], p);
  for (let y = 20; y < 80; y++) for (let x = 0; x < 22; x++) {
    rgba.set([212, 163, 45, 255], (y * width + x) * 4);
    mask[(y * width + x) * 4 + 3] = 255;
  }
  rgba.set([11, 10, 12, 255], 0);
  rgba.set([119, 151, 63, 255], (35 * width + 22) * 4);
  rgba[7] = 0;
  const result = await prepareGuidedBackground(await png(rgba, width, height), [await png(mask, width, height)], { detectFlat: true });
  const output = await sharp(result.restored).raw().toBuffer();
  expect(pixel(output, width, 0, 0)).toEqual([11, 10, 12, 255]);
  expect(pixel(output, width, 1, 0)[3]).toBe(0);
  expect(pixel(output, width, 0, 40)).toEqual([12, 12, 12, 255]);
  expect(pixel(output, width, 22, 35)).toEqual([12, 12, 12, 255]);
});

it("removes connected backdrop leakage while keeping the enclosed dark ink and fine gold line", async () => {
  const width = 96, height = 64;
  const rgba = Buffer.alloc(width * height * 4);
  const mask = Buffer.alloc(rgba.length);
  for (let i = 0; i < width * height; i++) {
    rgba.set([4, 4, 4, 255], i * 4);
    const x = i % width, y = Math.floor(i / width);
    if (x >= 8 && x < 85 && y >= 8 && y < 56) mask[i * 4 + 3] = 255;
    if (x >= 30 && x <= 70 && y >= 16 && y <= 45 &&
        (x === 30 || x === 70 || y === 16 || y === 45) || x === 22 && y >= 20 && y < 40) {
      rgba.set([218, 168, 72, 255], i * 4);
    }
    if (x === 29 && y === 28) rgba.set([15, 5, 4, 255], i * 4);
  }
  const settings = {
    name: "Panel with enclosed ink", preview: { width, height },
    box: { left: 0, top: 0, width, height }, tightBox: { left: 8, top: 8, width: 77, height: 48 },
  };
  const [cutout] = await Array.fromAsync(renderGuidedCutout(
    await png(rgba, width, height), await png(mask, width, height), settings, [],
  ));
  const output = await sharp(cutout.bytes).raw().toBuffer();
  expect(pixel(output, width, 10, 22)).toEqual([0, 0, 0, 0]);
  expect(pixel(output, width, 50, 30)).toEqual([4, 4, 4, 255]);
  expect(pixel(output, width, 22, 30)).toEqual([218, 168, 72, 255]);
  expect(pixel(output, width, 29, 28)).toEqual([15, 5, 4, 128]);
});

it("keeps lettering and detached ornaments with the main design in one PNG", async () => {
  const width = 40, height = 40;
  const artwork = await sharp({ create: { width, height, channels: 4, background: "#ceab58" } }).png().toBuffer();
  const mask = Buffer.alloc(width * height * 4);
  for (const [left, top, right, bottom] of [[12, 9, 27, 21], [7, 14, 10, 19], [29, 14, 32, 19], [12, 26, 27, 28]]) {
    for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) mask[(y * width + x) * 4 + 3] = 255;
  }
  const outputs = await Array.fromAsync(renderGuidedCutout(artwork, await png(mask, width, height), {
    name: "Complete emblem", box: { left: 0, top: 0, width, height }, preview: { width, height },
  }, []));
  expect(outputs).toHaveLength(1);
  const rgba = await sharp(outputs[0].bytes).raw().toBuffer();
  for (const [x, y] of [[18, 17], [8, 15], [31, 15], [18, 27]]) expect(pixel(rgba, width, x, y)).toEqual([206, 171, 88, 255]);
  expect(pixel(rgba, width, 18, 24)).toEqual([0, 0, 0, 0]);
});

it("recovers missed letters from flat artwork without collecting the neighboring design or its background", async () => {
  const width = 100, height = 72;
  const source = Buffer.alloc(width * height * 4);
  const mask = Buffer.alloc(source.length);
  for (let i = 0; i < source.length; i += 4) source.set([250, 250, 250, 255], i);
  const paint = (left, top, w, h, color, selected = false) => {
    for (let y = top; y < top + h; y++) for (let x = left; x < left + w; x++) {
      const offset = (y * width + x) * 4;
      source.set([...color, 255], offset);
      if (selected) mask[offset + 3] = 255;
    }
  };
  const ink = [23, 74, 60];
  paint(20, 25, 8, 20, ink, true);
  paint(38, 25, 9, 20, ink);
  paint(58, 25, 8, 20, ink);
  paint(19, 25, 1, 20, [218, 225, 222], true);
  paint(76, 11, 11, 6, [239, 99, 141], true);
  const settings = { name: "Wordmark", box: { left: 0, top: 0, width, height }, preview: { width, height } };
  const original = await png(source, width, height);
  const [layer] = await Array.fromAsync(renderGuidedCutout(original, await png(mask, width, height), settings, [], [
    { left: 72, top: 7, width: 22, height: 15 },
  ]));
  const rendered = await sharp(layer.bytes).raw().toBuffer();
  for (const x of [23, 41, 61]) expect(pixel(rendered, width, x, 32)).toEqual([...ink, 255]);
  for (const [x, y] of [[19, 32], [31, 32], [81, 13]]) expect(pixel(rendered, width, x, y)[3]).toBe(0);

  const fill = await prepareGuidedBackground(original, [layer.bytes]);
  const removal = await sharp(fill.blend).greyscale().raw().toBuffer();
  for (const x of [23, 41, 61]) expect(removal[(32 - fill.box.top) * fill.box.width + x - fill.box.left]).toBe(255);
  expect(removal[(13 - fill.box.top) * fill.box.width + 81 - fill.box.left]).toBe(0);
});

it("replaces the previous guided background on acceptance and keeps every accepted element", () => {
  const layer = (id, props) => ({ id, width: 24, height: 24, layout: { x: 0, y: 0, scale: 1 }, composition: { x: 0, y: 0, scale: 1 }, ...props });
  const manifest = { width: 40, height: 30, layers: [layer("old-background", { guidedBackground: true }), layer("first", { guidedElement: true })] };
  const result = { replaceGuidedBackground: true, layers: [layer("second", { guidedElement: true }), layer("background", { guidedBackground: true })] };
  expect(acceptLayers(manifest, { kind: "segment", result }).layers.map(item => item.id)).toEqual(["background", "first", "second"]);
});
