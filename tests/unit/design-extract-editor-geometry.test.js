import { describe, expect, it } from "vitest";
import { artworkBounds, frameArtwork, layerBounds } from "@/features/design-extract/editorGeometry";
const layer = (x, y, width = 100, height = 200, scale = 1) => ({ width, height, visible: true, layout: { x, y, scale }, composition: { x, y, scale } });
describe("Design Extract artwork framing", () => {
  it("includes the upload guide when centering and fitting a new document", () => {
    const guide = { x: 300, y: 0, width: 300, height: 390 };
    const bounds = artworkBounds([], "layout", { width: 800, height: 1200 }, [guide]);
    expect(bounds).toEqual({ x: 0, y: 0, width: 600, height: 390 });
    const camera = frameArtwork(bounds, { width: 1120, height: 650 }, 4);
    expect(bounds.width * camera.zoom + camera.x).toBeLessThanOrEqual(1072);
    expect(camera.x).toBeCloseTo((1120 - bounds.width * camera.zoom) / 2);
    expect(artworkBounds([], "layout", { width: 800, height: 1200 }, [null])).toEqual({ x: 0, y: 0, width: 240, height: 360 });
  });
  it("frames moved layers with negative coordinates rather than a hardcoded board", () => {
    const bounds = artworkBounds([layer(-300, -120), layer(1600, 900)], "layout", { width: 400, height: 600 });
    expect(bounds).toEqual({ x: -300, y: -120, width: 2000, height: 1220 });
    const camera = frameArtwork(bounds, { width: 1200, height: 800 });
    expect(bounds.x * camera.zoom + camera.x).toBeGreaterThanOrEqual(48);
    expect((bounds.x + bounds.width) * camera.zoom + camera.x).toBeLessThanOrEqual(1152);
    expect(bounds.y * camera.zoom + camera.y).toBeGreaterThanOrEqual(60);
    expect((bounds.y + bounds.height) * camera.zoom + camera.y).toBeLessThanOrEqual(756);
  });
  it("ignores hidden layers and preserves the original composition canvas", () => {
    expect(artworkBounds([{ ...layer(9000, 9000), visible: false }], "composition", { width: 400, height: 600 })).toEqual({ x: 0, y: 0, width: 400, height: 600 });
  });
  it("focuses scaled layers without changing their position or exceeding the zoom limit", () => {
    const input = layer(350, 50, 40, 60, 2);
    expect(layerBounds(input, "layout")).toEqual({ x: 350, y: 50, width: 80, height: 120 });
    expect(frameArtwork(layerBounds(input, "layout"), { width: 1200, height: 800 }, 2).zoom).toBe(2);
    expect(input.layout).toEqual({ x: 350, y: 50, scale: 2 });
  });
  it("does not move the camera for an unavailable or invalid target", () => {
    expect(layerBounds(null, "layout")).toBeNull();
    expect(frameArtwork(null, { width: 1200, height: 800 })).toBeNull();
    expect(frameArtwork({ x: 0, y: 0, width: 0, height: 100 }, { width: 0, height: 800 })).toBeNull();
  });
});
