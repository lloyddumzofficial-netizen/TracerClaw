import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/supabase", () => ({ adminSupabase: {} }));
import sharp from "sharp";
import { renderMask, maskedLayer } from "@/server/designExtract/mask";
import { enhancedLayer } from "@/server/designExtract/enhancement";
import { selectVariant } from "@/lib/designExtractVariants";

describe("native mask editing", () => {
  it("preserves every source RGB byte, soft alpha, and computes trimmed bounds", async () => {
    const pixels = Buffer.from([19, 53, 173, 255, 201, 72, 9, 255, 28, 107, 213, 128, 199, 39, 71, 255]);
    const source = await sharp(pixels, { raw: { width: 4, height: 1, channels: 4 } }).png().toBuffer();
    const coverage = await sharp(Buffer.from([0, 128, 255, 0]), { raw: { width: 4, height: 1, channels: 1 } }).png().toBuffer();
    const result = await renderMask(source, coverage);
    const output = await sharp(result.full).raw().toBuffer();
    for (let i = 0; i < 4; i++) expect([...output.subarray(i * 4, i * 4 + 3)]).toEqual([...pixels.subarray(i * 4, i * 4 + 3)]);
    expect([...output].filter((_, i) => i % 4 === 3)).toEqual([0, 128, 128, 0]);
    expect(result.bounds).toEqual({ left: 1, top: 0, width: 2, height: 1 });
  });
  it("rejects wrong dimensions and an entirely erased element", async () => {
    const image = size => sharp({ create: { width: size, height: size, channels: 4, background: "white" } }).png().toBuffer();
    await expect(renderMask(await image(2), await image(3))).rejects.toMatchObject({ status: 422 });
    const black = await sharp({ create: { width: 2, height: 2, channels: 3, background: "black" } }).png().toBuffer();
    await expect(renderMask(await image(2), black)).rejects.toMatchObject({ status: 422 });
  });
  it("retains uncleaned native coverage and recalculates export bounds after cleanup", async () => {
    const data = Buffer.alloc(8 * 8 * 4);
    const put = (x, y) => data.set([130, 70, 40, 255], (y * 8 + x) * 4);
    put(0, 0);
    for (let y = 3; y < 6; y++) for (let x = 3; x < 6; x++) put(x, y);
    const source = await sharp(data, { raw: { width: 8, height: 8, channels: 4 } }).png().toBuffer();
    const coverage = await sharp({ create: { width: 8, height: 8, channels: 3, background: "white" } }).png().toBuffer();
    const result = await renderMask(source, coverage, 0, { specks: 4 });
    expect(result.bounds).toEqual({ left: 3, top: 3, width: 3, height: 3 });
    const rawBase = await sharp(result.maskBase).raw().toBuffer();
    expect(rawBase[3]).toBe(255);
    const cleaned = await sharp(result.full).raw().toBuffer();
    expect(cleaned[3]).toBe(0);
    expect(await sharp(result.trimmed).metadata()).toMatchObject({ width: 3, height: 3 });
    await expect(renderMask(source, coverage, 0, { specks: 500 })).rejects.toMatchObject({ status: 422 });
  });
  it("maps trimmed mask offsets in both arrangements and preserves version size", () => {
    const layer = { url: "base", width: 10, height: 20, maskSourceUrl: "source", maskBaseUrl: "mask", nativeFrame: { width: 100, height: 100, left: 8, top: 12 }, layout: { x: 40, y: 50, scale: 2 }, composition: { x: 80, y: 120, scale: 3 } };
    const enhanced = enhancedLayer(layer, "enhanced", { width: 40, height: 80, scale: 4 });
    const base = selectVariant(enhanced, "base");
    expect(base.url).toBe("base"); expect(base.composition).toEqual(layer.composition);
    const edited = maskedLayer(enhanced, { bounds: { left: 10, top: 15, width: 6, height: 8 }, width: 100, height: 100 }, { url: "accepted", full: "full" });
    expect(edited.layout).toEqual({ x: 44, y: 56, scale: 2 });
    expect(edited.composition).toEqual({ x: 86, y: 129, scale: 3 });
    expect(edited.maskSourceUrl).toBe("source"); expect(edited.originalMaskUrl).toBe("mask");
    expect(edited.baseVariant.url).toBe("base");
    expect(selectVariant(edited, "enhanced").url).toBe("enhanced");
    expect(selectVariant(selectVariant(edited, "base"), "mask").url).toBe("accepted");
  });
});
