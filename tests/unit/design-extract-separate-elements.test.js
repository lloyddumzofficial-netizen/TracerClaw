import { describe, it, expect } from "vitest";
import { separateElements } from "../../src/server/designExtract/separateElements";
function rectangle(data, width, x, y, w, h, rgba = [140, 30, 210, 128]) {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) data.set(rgba, (yy * width + xx) * 4);
}
function reconstructed(parts, width, height) {
  const result = new Uint8Array(width * height * 4);
  for (const part of parts) {
    if (!part.separated) return new Uint8Array(part.data);
    const { left, top, width: w, height: h } = part.bounds;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (part.data[i + 3]) result.set(part.data.subarray(i, i + 4), ((top + y) * width + left + x) * 4);
    }
  }
  return result;
}
describe("automatic element separation", () => {
  it("isolates distant shapes, keeps nearby logo parts together, and preserves native RGBA", () => {
    const data = new Uint8Array(100 * 80 * 4);
    rectangle(data, 100, 5, 5, 5, 8); rectangle(data, 100, 12, 5, 5, 8);
    rectangle(data, 100, 70, 50, 10, 10, [20, 190, 50, 255]);
    const original = data.slice(), parts = [...separateElements(data, 100, 80)];
    expect(parts).toHaveLength(2);
    expect(parts[0].bounds).toEqual({ left: 5, top: 5, width: 12, height: 8 });
    expect(parts[1].bounds).toEqual({ left: 70, top: 50, width: 10, height: 10 });
    expect(reconstructed(parts, 100, 80)).toEqual(original); expect(data).toEqual(original);
  });
  it("preserves connected artwork and diagonal connections", () => {
    const data = new Uint8Array(40 * 40 * 4);
    rectangle(data, 40, 3, 3, 10, 10); rectangle(data, 40, 13, 13, 10, 10);
    const parts = [...separateElements(data, 40, 40)];
    expect(parts).toHaveLength(1); expect(parts[0].separated).toBe(false);
    expect(reconstructed(parts, 40, 40)).toEqual(data);
  });
  it("retains tiny isolated details and merges to a bounded layer budget", () => {
    const data = new Uint8Array(100 * 100 * 4);
    for (const [x, y] of [[4, 4], [40, 40], [80, 80]]) rectangle(data, 100, x, y, 5, 5);
    rectangle(data, 100, 99, 99, 1, 1);
    const parts = [...separateElements(data, 100, 100, 2)];
    expect(parts).toHaveLength(2); expect(reconstructed(parts, 100, 100)).toEqual(data);
  });
  it("keeps dense texture intact instead of producing hundreds of fragments", () => {
    const data = new Uint8Array(160 * 160 * 4);
    for (let y = 0; y < 160; y += 5) for (let x = 0; x < 160; x += 5) rectangle(data, 160, x, y, 1, 1);
    const parts = [...separateElements(data, 160, 160)];
    expect(parts).toHaveLength(1); expect(parts[0].separated).toBe(false); expect(parts[0].data).toEqual(data);
  });
  it("ignores empty artwork and rejects invalid budgets", () => {
    expect([...separateElements(new Uint8Array(400), 10, 10)]).toHaveLength(0);
    expect(() => [...separateElements(new Uint8Array(400), 10, 10, 33)]).toThrow();
  });
});
