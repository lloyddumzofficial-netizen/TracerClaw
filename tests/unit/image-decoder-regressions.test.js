import { describe, expect, it } from "vitest";
import sharp from "sharp";

describe("patched native image decoder", () => {
  it.each(["png", "jpeg", "webp", "avif"])("keeps supported %s source dimensions and produces a readable PNG", async format => {
    const source = await sharp({ create: { width: 32, height: 24, channels: 3, background: "#2458a8" } })[format]().toBuffer();
    const meta = await sharp(source).metadata();
    expect(meta).toMatchObject({ width: 32, height: 24 });
    const output = await sharp(source).png().toBuffer();
    expect(await sharp(output).metadata()).toMatchObject({ format: "png", width: 32, height: 24 });
  });

  it("preserves PNG transparency and renders existing SVG artwork", async () => {
    const source = await sharp({ create: { width: 32, height: 24, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    const { data } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(data.every(byte => byte === 0)).toBe(true);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="24"><path fill="#2458a8" d="M0 0h32v24H0z"/></svg>');
    const rendered = await sharp(svg).png().toBuffer();
    expect(await sharp(rendered).metadata()).toMatchObject({ format: "png", width: 32, height: 24 });
  });

  it.each([Buffer.alloc(0), Buffer.from("not an image"), Buffer.from([0x89, 0x50, 0x4e, 0x47])])("rejects malformed or truncated uploads", async source => {
    await expect(async () => sharp(source).metadata()).rejects.toThrow();
  });
});
