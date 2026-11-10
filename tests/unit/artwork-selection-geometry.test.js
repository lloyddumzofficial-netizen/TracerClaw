import { describe, expect, it } from "vitest";
import { moveRectangle, resizeRectangle, selectionBounds } from "../../src/components/workspace/artwork-editor/selectionGeometry";

describe("artwork selection transforms", () => {
  const rect = { kind: "rect", x: .2, y: .3, width: .4, height: .3 };
  it("moves without resizing and clamps to all image edges", () => {
    expect(moveRectangle(rect, { x: .3, y: .4 }, { x: .4, y: .5 })).toMatchObject({ x: expect.closeTo(.3), y: expect.closeTo(.4), width: .4, height: .3 });
    expect(moveRectangle(rect, { x: 0, y: 0 }, { x: 1, y: 1 })).toMatchObject({ x: .6, y: .7 });
    expect(moveRectangle(rect, { x: 1, y: 1 }, { x: 0, y: 0 })).toMatchObject({ x: 0, y: 0 });
  });
  it("resizes one edge without shifting the other axis", () => {
    expect(resizeRectangle(rect, "e", { x: .9, y: .9 })).toMatchObject({ x: .2, y: .3, width: expect.closeTo(.7), height: expect.closeTo(.3) });
    expect(resizeRectangle(rect, "n", { x: 0, y: .1 })).toMatchObject({ x: .2, y: .1, width: expect.closeTo(.4), height: expect.closeTo(.5) });
  });
  it("keeps rectangles valid when a handle crosses the opposite corner", () => {
    expect(resizeRectangle(rect, "nw", { x: .9, y: .8 })).toMatchObject({ x: expect.closeTo(.6), y: expect.closeTo(.6), width: expect.closeTo(.3), height: expect.closeTo(.2) });
  });
  it("accounts for source aspect ratio in brush bounds and ignores eraser strokes", () => {
    const bounds = selectionBounds([{ kind: "brush", radius: .1, points: [{ x: .5, y: .5 }] }, { kind: "brush", radius: .2, erase: true, points: [{ x: 0, y: 0 }] }], 2);
    expect(bounds).toMatchObject({ x: .4, y: .45, width: expect.closeTo(.2), height: expect.closeTo(.1) });
    expect(selectionBounds([])).toBeNull();
  });
});
