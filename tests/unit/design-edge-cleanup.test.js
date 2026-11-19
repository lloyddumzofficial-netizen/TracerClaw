import { describe, expect, it } from "vitest";
import { cleanDesignEdges, edgeCleanupSettings } from "../../src/lib/designEdgeCleanup";
const pixel = (data, width, x, y, color = [30, 80, 120, 255]) => data.set(color, (y * width + x) * 4);
describe("native edge cleanup", () => {
  it("preserves disabled artwork and never mutates input", () => {
    const input = Uint8ClampedArray.from([231, 45, 123, 82, 1, 2, 3, 255]), original = input.slice();
    expect(cleanDesignEdges(input, 2, 1, {})).toEqual(original);
    cleanDesignEdges(input, 2, 1, { specks: 4 }); expect(input).toEqual(original);
  });
  it("removes islands while preserving connected fine lines and diagonal connections", () => {
    const data = new Uint8ClampedArray(20 * 20 * 4);
    pixel(data, 20, 0, 0); pixel(data, 20, 19, 0);
    for (let i = 0; i < 18; i++) pixel(data, 20, i, i + 2);
    const result = cleanDesignEdges(data, 20, 20, { specks: 4 });
    expect(result[3]).toBe(0); expect(result[19 * 4 + 3]).toBe(0);
    for (let i = 0; i < 18; i++) expect(result[((i + 2) * 20 + i) * 4 + 3]).toBe(255);
  });
  it("does not wrap opposite row edges into one island", () => {
    const data = new Uint8ClampedArray(5 * 5 * 4);
    for (let x = 0; x < 5; x++) pixel(data, 5, x, 0);
    pixel(data, 5, 0, 2); pixel(data, 5, 4, 1);
    const result = cleanDesignEdges(data, 5, 5, { specks: 4 });
    expect(result[2 * 5 * 4 + 3]).toBe(0); expect(result[(5 + 4) * 4 + 3]).toBe(255);
  });
  it("defringes boundary RGB while preserving all alpha and interior colour", () => {
    const data = new Uint8ClampedArray(11 * 11 * 4);
    for (let y = 2; y < 9; y++) for (let x = 2; x < 9; x++) pixel(data, 11, x, y, [20, 70, 110, 255]);
    for (let x = 2; x < 9; x++) pixel(data, 11, x, 2, [230, 230, 230, 128]);
    const result = cleanDesignEdges(data, 11, 11, { defringe: 1 });
    for (const y of [2, 5]) expect([...result.slice((y * 11 + 5) * 4, (y * 11 + 5) * 4 + 3)]).toEqual([20, 70, 110]);
    for (let i = 3; i < data.length; i += 4) expect(result[i]).toBe(data[i]);
  });
  it("rejects unbounded settings", () => {
    for (const value of [{ defringe: 99 }, { defringe: .5 }, { specks: 500 }, { specks: "4" }]) expect(() => edgeCleanupSettings(value)).toThrow("Invalid edge");
  });
});
