import { it, expect } from "vitest";
import { arrangeOverview } from "@/lib/designExtractLayout";

it("matches source height, preserves aspect ratios and composition, and leaves gaps between rows", () => {
  const input = Array.from({ length: 5 }, (_, index) => ({ id: String(index), width: 100 + index * 20, height: 200 + index * 40, composition: { x: 10, y: 20, scale: 1 } }));
  const output = arrangeOverview(input, { width: 448, height: 896 });
  output.forEach((layer, index) => {
    expect(layer.height * layer.layout.scale).toBeCloseTo(480);
    expect(layer.composition).toEqual(input[index].composition);
    expect(layer.width / layer.height).toBe(input[index].width / input[index].height);
    if (index > 0 && index < 4) expect(layer.layout.x).toBeGreaterThan(output[index - 1].layout.x + output[index - 1].width * output[index - 1].layout.scale);
  });
  expect(output.slice(0, 4).every(layer => layer.layout.y === 0)).toBe(true);
  expect(output[4].layout.y).toBe(544);
  expect(input[0].layout).toBeUndefined();
});
