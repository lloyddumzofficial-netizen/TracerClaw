import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  calculateLogoUpscaleDimensions,
  prepareLogoSource,
  upscaleLogoDeterministically,
} from "@/server/logoProcessing";

describe("deterministic logo processing", () => {
  it("normalizes a transparent source without flattening its alpha channel", async () => {
    const source = await sharp({
      create: {
        width: 10,
        height: 6,
        channels: 4,
        background: { r: 120, g: 20, b: 220, alpha: 0.5 },
      },
    }).png().toBuffer();

    const prepared = await prepareLogoSource(source);
    const metadata = await sharp(prepared.buffer).metadata();

    expect(prepared.mimeType).toBe("image/png");
    expect([prepared.width, prepared.height]).toEqual([10, 6]);
    expect(metadata.hasAlpha).toBe(true);
  });

  it("keeps aspect ratio while respecting edge and pixel limits", () => {
    expect(calculateLogoUpscaleDimensions(1000, 1000)).toEqual({
      width: 4000,
      height: 4000,
      scale: 4,
    });

    expect(calculateLogoUpscaleDimensions(4000, 2000)).toEqual({
      width: 6000,
      height: 3000,
      scale: 1.5,
    });
  });

  it("upscales pixels without invoking a generative image model", async () => {
    const source = await sharp({
      create: {
        width: 1200,
        height: 600,
        channels: 4,
        background: { r: 10, g: 30, b: 80, alpha: 1 },
      },
    }).png().toBuffer();

    const result = await upscaleLogoDeterministically(source);

    expect(result.mimeType).toBe("image/png");
    expect(result.scale).toBe(5);
    expect([result.width, result.height]).toEqual([6000, 3000]);
  });

  it("restores edge contrast instead of only enlarging soft pixels", async () => {
    const hardEdge = await sharp({
      create: {
        width: 80,
        height: 40,
        channels: 3,
        background: { r: 20, g: 20, b: 20 },
      },
    })
      .composite([{
        input: {
          create: {
            width: 40,
            height: 40,
            channels: 3,
            background: { r: 235, g: 235, b: 235 },
          },
        },
        left: 40,
        top: 0,
      }])
      .blur(2)
      .png()
      .toBuffer();

    const target = calculateLogoUpscaleDimensions(80, 40);
    const plainResize = await sharp(hardEdge)
      .resize(target.width, target.height, { kernel: sharp.kernel.lanczos3 })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const restored = await upscaleLogoDeterministically(hardEdge);
    const restoredRaw = await sharp(restored.buffer)
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const strongestHorizontalEdge = ({ data, info }) => {
      let strongest = 0;
      const row = Math.floor(info.height / 2) * info.width;
      for (let x = 1; x < info.width; x += 1) {
        strongest = Math.max(strongest, Math.abs(data[row + x] - data[row + x - 1]));
      }
      return strongest;
    };

    expect(strongestHorizontalEdge(restoredRaw)).toBeGreaterThan(
      strongestHorizontalEdge(plainResize),
    );
  });
});
