import { beforeEach, expect, it, vi } from "vitest";
import sharp from "sharp";
import { createPilotPreview, matchPilotMasks, nativePilotCoverage, pilotMaskRequest, pilotRegions } from "@/server/designExtract/qualityPilot";
import { automaticCutouts } from "@/server/designExtract/automaticCutouts";
import { editQualityDraft, readQualityDraft } from "@/server/designExtract/qualityReview";

const files = vi.hoisted(() => new Map());
vi.mock("@/server/designExtract/storage", () => ({
  privateDesignKey: url => url?.replace("r2-private://design-extract/", ""),
  ownsPrivateDesignAsset: (url, userId) => url?.startsWith(`r2-private://design-extract/staging/design-extract/${userId}/`),
  readPrivateDesignAsset: async url => {
    if (!files.has(url)) throw new Error("Missing asset");
    return files.get(url);
  },
  uploadDesignAsset: async (bytes, key) => {
    const url = "r2-private://design-extract/" + key;
    files.set(url, bytes);
    return url;
  },
}));
beforeEach(() => files.clear());

const width = 12, height = 6;
const monochrome = predicate => sharp(Buffer.from(Array.from({ length: width * height }, (_, i) => predicate(i % width, Math.floor(i / width)) ? 255 : 0)), { raw: { width, height, channels: 1 } }).png().toBuffer();
const cropped = (w, h, color) => sharp({ create: { width: w, height: h, channels: 4, background: color } }).png().toBuffer();

it("preserves portrait aspect ratio and validates normalized boxes", async () => {
  const preview = await createPilotPreview(await cropped(765, 1500, "#916040"));
  expect([preview.width, preview.height]).toEqual([522, 1024]);
  const regions = pilotRegions([
    { name: "Wordmark", box_2d: [25, 50, 775, 600] },
    { name: "duplicate", box_2d: [25, 50, 775, 600] },
    { name: "inverted", box_2d: [200, 0, 100, 800] },
    { name: "out of bounds", box_2d: [0, -1, 775, 600] },
  ], preview.width, preview.height);
  expect(regions).toHaveLength(1);
  expect(pilotMaskRequest("private", regions)).toMatchObject({ apply_mask: false, max_masks: 1, box_prompts: [{ object_id: 1, x_min: 26, y_min: 25, x_max: 313, y_max: 793 }] });
});

it("matches shuffled masks by overlap and keeps disconnected letters in one original-pixel layer", async () => {
  const preview = { width, height, regions: [
    { name: "Wordmark", box: { left: 1, top: 1, right: 5, bottom: 4 } },
    { name: "Mark", box: { left: 8, top: 1, right: 10, bottom: 4 } },
    { name: "Symbol", box: { left: 6, top: 0, right: 7, bottom: 1 } },
  ] };
  const word = await monochrome((x, y) => [1, 2, 4, 5].includes(x) && y >= 1 && y <= 4);
  const mark = await monochrome((x, y) => !(x >= 8 && x <= 10 && y >= 1 && y <= 4));
  const read = async url => ({ word, mark })[url];
  const blank = await monochrome(() => true);
  const { matches, missing } = await matchPilotMasks({ masks: [{ url: "mark" }, { url: "word" }, { url: "blank" }], scores: [.7, .9] }, preview, url => url === "blank" ? blank : read(url));
  expect(missing).toEqual(["Symbol"]);
  expect(matches.find(mask => mask.name === "Mark").needsReview).toBe(true);
  const source = await cropped(24, 12, "#913e57");
  const namedMasks = matches.map(candidate => ({ ...candidate, nativeCoverage: (w, h) => nativePilotCoverage(candidate.coverage, preview, w, h) }));
  const outputs = Object.fromEntries(await Array.fromAsync((async function* () {
    for await (const entry of automaticCutouts(source, [], { namedMasks, limit: 10 })) yield [entry.name, await sharp(entry.bytes).raw().toBuffer()];
  })()));
  expect(Object.keys(outputs).sort()).toEqual(["Mark", "Remaining artwork", "Wordmark"]);
  const pixel = (part, x, y) => [...outputs[part].subarray((y * 24 + x) * 4, (y * 24 + x) * 4 + 4)];
  expect(pixel("Wordmark", 3, 4)).toEqual([145, 62, 87, 255]);
  expect(pixel("Wordmark", 6, 4)[3]).toBeLessThan(128);
  expect(pixel("Wordmark", 9, 4)).toEqual([145, 62, 87, 255]);
  expect(pixel("Remaining artwork", 0, 0)).toEqual([145, 62, 87, 255]);
  const stack = Object.values(outputs);
  for (let i = 3; i < stack[0].length; i += 4) expect(stack.reduce((sum, pixels) => Math.round(pixels[i] + sum * (255 - pixels[i]) / 255), 0)).toBe(255);
});

it("groups native fragments, returns erased pixels to the remainder, and resets an immutable draft", async () => {
  const project = { id: "project", user_id: "owner", manifest: { width, height } };
  const url = "source";
  files.set(url, await cropped(width, height, "#954560"));
  const art = await cropped(2, 2, "#954560");
  files.set("first", art); files.set("second", art);
  const fragment = (id, left) => ({ id, name: id, url: id, width: 2, height: 2, nativeFrame: { width, height, left, top: 1 }, composition: { x: left, y: 1, scale: 1 } });
  const job = { id: "job", input: { image_url: url }, result: { layers: [fragment("first", 1), fragment("second", 7)] } };
  const read = async key => files.get(key);
  const group = await editQualityDraft(project, job, { edit: "group", layerIds: ["second", "first"] }, read);
  const layer = group.result.layers[0];
  expect(layer).toMatchObject({ width: 8, height: 2, composition: { x: 1, y: 1, scale: 1 } });
  const reduced = await monochrome((x, y) => x >= 7 && x <= 8 && y >= 1 && y <= 2);
  const upload = "r2-private://design-extract/staging/design-extract/owner/mask.png";
  files.set(upload, reduced);
  const edited = await editQualityDraft(project, job, { edit: "mask", layerId: layer.id, draftId: group.draftId, maskUrl: upload }, read);
  expect(edited.result.layers[0]).toMatchObject({ width: 2, height: 2, composition: { x: 7, y: 1, scale: 1 } });
  const editedRemainder = await sharp(await read(edited.result.layers[1].url)).raw().toBuffer();
  expect([...editedRemainder.subarray((width + 1) * 4, (width + 2) * 4)]).toEqual([149, 69, 96, 255]);
  const reset = await editQualityDraft(project, job, { edit: "reset", layerId: layer.id, draftId: edited.draftId }, read);
  expect(reset.result.layers[0].url).toEqual(layer.url);
  expect((await readQualityDraft(project, job, group.draftId)).layers[0]).toEqual(layer);
  await expect(readQualityDraft({ ...project, id: "different" }, job, group.draftId)).rejects.toThrow("Missing asset");
});
