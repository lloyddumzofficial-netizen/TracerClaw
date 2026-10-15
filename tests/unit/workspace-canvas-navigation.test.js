import { describe, expect, it } from "vitest";
import {
  calculateFittedArtworkLayout,
  calculateSynchronizedPan,
  calculateZoomLayerSize,
} from "@/lib/workspaceCanvasNavigation";

describe("calculateSynchronizedPan", () => {
  it("moves both equal canvases by the drag distance", () => {
    const result = calculateSynchronizedPan({
      sourceStartLeft: 300,
      sourceStartTop: 200,
      deltaX: -40,
      deltaY: 25,
      sourceMaxLeft: 800,
      sourceMaxTop: 600,
      linkedMaxLeft: 800,
      linkedMaxTop: 600,
    });

    expect(result).toEqual({
      source: { left: 340, top: 175 },
      linked: { left: 340, top: 175 },
    });
  });

  it("keeps differently sized canvases at the same normalized position", () => {
    const result = calculateSynchronizedPan({
      sourceStartLeft: 200,
      sourceStartTop: 150,
      deltaX: -100,
      deltaY: -50,
      sourceMaxLeft: 600,
      sourceMaxTop: 400,
      linkedMaxLeft: 1200,
      linkedMaxTop: 800,
    });

    expect(result.source).toEqual({ left: 300, top: 200 });
    expect(result.linked).toEqual({ left: 600, top: 400 });
  });

  it("clamps at canvas boundaries without overshooting the linked pane", () => {
    const result = calculateSynchronizedPan({
      sourceStartLeft: 50,
      sourceStartTop: 40,
      deltaX: 500,
      deltaY: -900,
      sourceMaxLeft: 700,
      sourceMaxTop: 500,
      linkedMaxLeft: 350,
      linkedMaxTop: 250,
    });

    expect(result.source).toEqual({ left: 0, top: 500 });
    expect(result.linked).toEqual({ left: 0, top: 250 });
  });

  it("remains stable when a pane has no scrollable overflow", () => {
    const result = calculateSynchronizedPan({
      sourceStartLeft: 0,
      sourceStartTop: 0,
      deltaX: -100,
      deltaY: -100,
      sourceMaxLeft: 0,
      sourceMaxTop: 0,
      linkedMaxLeft: 500,
      linkedMaxTop: 500,
    });

    expect(result).toEqual({
      source: { left: 0, top: 0 },
      linked: { left: 0, top: 0 },
    });
  });
});

describe("calculateZoomLayerSize", () => {
  it("grows only the scroll layer above 100% to avoid double scaling", () => {
    expect(calculateZoomLayerSize(3.73)).toEqual({
      scrollPercent: 373,
      artworkPercent: 100,
    });
  });

  it("shrinks only the centered artwork below 100%", () => {
    expect(calculateZoomLayerSize(0.5)).toEqual({
      scrollPercent: 100,
      artworkPercent: 50,
    });
  });
});

describe("calculateFittedArtworkLayout", () => {
  it("scales portrait artwork without multiplying its side letterboxing", () => {
    const result = calculateFittedArtworkLayout({
      viewportWidth: 800,
      viewportHeight: 800,
      aspectRatio: 0.5,
      zoom: 3.73,
      padding: 24,
    });

    expect(result.artworkWidth).toBeCloseTo(1402.48);
    expect(result.artworkHeight).toBeCloseTo(2804.96);
    expect(result.surfaceWidth).toBeCloseTo(1450.48);
    expect(result.surfaceHeight).toBeCloseTo(2852.96);
  });

  it("keeps the surface equal to the viewport while artwork is zoomed out", () => {
    const result = calculateFittedArtworkLayout({
      viewportWidth: 1000,
      viewportHeight: 700,
      aspectRatio: 16 / 9,
      zoom: 0.5,
      padding: 24,
    });

    expect(result.surfaceWidth).toBe(1000);
    expect(result.surfaceHeight).toBe(700);
    expect(result.artworkWidth).toBeLessThan(1000);
    expect(result.artworkHeight).toBeLessThan(700);
  });
});
