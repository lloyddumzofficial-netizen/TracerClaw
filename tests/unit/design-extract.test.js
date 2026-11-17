import { describe, it, expect } from "vitest";
import { emptyManifest, validateEdits, acceptLayers } from "@/lib/designExtract";
import { validateImageUploadRequest } from "@/lib/uploadLimits";
import { getProjectWorkspacePath } from "@/lib/projectNavigation";
it("opens Design Extract cards in their editor without changing other project routes", () => {
  expect(getProjectWorkspacePath({ id: "layers-1", trace_type: "design_extract" })).toBe("/design-extract/layers-1");
  expect(getProjectWorkspacePath({ id: "garment-1", trace_type: "mockup" })).toBe("/workspace/garment-1");
});
it("accepts 20 MB Design Extract uploads, rejects larger files, and preserves other limits", () => {
  const input = { contentType: "image/png", fileSize: 20 * 1024 * 1024, purpose: "design_extract" };
  expect(validateImageUploadRequest(input).ok).toBe(true);
  expect(validateImageUploadRequest({ ...input, fileSize: input.fileSize + 1 })).toMatchObject({ ok: false, status: 413 });
  expect(validateImageUploadRequest({ ...input, purpose: "standard" })).toMatchObject({ ok: false, status: 413 });
});
const layer = { id: "one", name: "Subject", url: "owned.png", width: 20, height: 30, composition: { x: 5, y: 10, scale: 2 }, layout: { x: 300, y: 0, scale: 1 }, visible: true, locked: false };
describe("layer editing", () => {
  it("keeps composition independent of latag and rejects asset injection", () => {
    const manifest = { ...emptyManifest(100, 100), layers: [layer] };
    const edited = validateEdits({ layers: [{ ...layer, url: "evil.png", layout: { x: 50, y: 60, scale: 3 } }] }, manifest);
    expect(edited.layers[0].composition).toEqual(layer.composition); expect(edited.layers[0].url).toBe("owned.png");
  });
  it("rejects duplicates, unknown layers and invalid transforms", () => {
    const manifest = { ...emptyManifest(100, 100), layers: [layer] };
    for (const layers of [[layer, layer], [{ ...layer, id: "unknown" }], [{ ...layer, composition: { x: NaN, y: 0, scale: 1 } }], [{ ...layer, layout: { x: 0, y: 0, scale: 0 } }]]) expect(() => validateEdits({ layers }, manifest)).toThrow();
  });
  it("maps split layers to the parent placement only on accept", () => {
    const manifest = { ...emptyManifest(100, 100), layers: [layer] };
    const split = { ...layer, id: "child", composition: { x: 2, y: 3, scale: .5 } };
    const accepted = acceptLayers(manifest, { kind: "split", layer_id: "one", result: { layers: [split] } });
    expect(manifest.layers).toEqual([layer]); expect(accepted.layers).toHaveLength(1);
    expect(accepted.layers[0].composition).toEqual({ x: 9, y: 16, scale: 1 });
    expect(acceptLayers(manifest, { kind: "segment", layer_id: "one", result: { layers: [split] } }).layers).toHaveLength(2);
  });
});
