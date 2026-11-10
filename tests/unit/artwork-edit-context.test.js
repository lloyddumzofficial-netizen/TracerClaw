import { expect, it } from "vitest";
import sharp from "sharp";
import { buildEditMasks, sourcePixels } from "@/server/artworkEdits/images";
import { editContext, cropSource, cropMask, sourcePng, compositeContextEdit, buildContextPreview, checkEditBoundary, validateContext } from "@/server/artworkEdits/context";
import { buildArtworkEditPrompt } from "@/server/artworkEdits/prompt";
import { EDIT_REGION_COLORS } from "@/server/artworkEdits/regionColors";

const instruction = (x, y, width, height) => ({ prompt: "Recolor the letters red without moving them.", shapes: [{ kind: "rect", x, y, width, height }] });
const image = async (width, height, svg = "") => sharp(Buffer.from(`<svg width="${width}" height="${height}"><rect width="100%" height="100%" fill="white"/>${svg}</svg>`)).png().toBuffer();

it("focuses tiny lettering while retaining context, all selections, and image-edge bounds", async () => {
  const source = await sourcePixels(await image(1696, 2528));
  for (const instructions of [[instruction(.63, .24, .26, .02)], [instruction(0, 0, .04, .03), instruction(.95, .96, .05, .04)]]) {
    const { union } = await buildEditMasks(instructions, source.width, source.height);
    const context = validateContext(editContext(source, union), source);
    const focused = cropMask(union, source.width, context);
    expect(focused.reduce((sum, value) => sum + value, 0)).toBe(union.reduce((sum, value) => sum + value, 0));
    if (instructions.length === 1) expect(context.width * context.height).toBeLessThan(source.width * source.height / 5);
  }
  expect(() => validateContext({ version: 1, sourceWidth: source.width, sourceHeight: source.height, left: -1 }, source)).toThrow("Invalid");
});

it("places a focused recolor at its original coordinates and preserves every outside pixel", async () => {
  const source = await sourcePixels(await image(600, 800, '<path fill="black" d="M250 350h12v30h-12z M270 350h12v30h-12z M290 350h12v30h-12z"/>'));
  const { union } = await buildEditMasks([instruction(.4, .425, .15, .075)], source.width, source.height);
  const context = editContext(source, union), crop = await cropSource(source, context);
  const red = Buffer.from(crop.data);
  for (let p = 0; p < red.length; p += 4) if (red[p] < 20) { red[p] = 230; red[p + 1] = 35; red[p + 2] = 40; }
  const result = await sourcePixels(await compositeContextEdit(source, await sourcePng({ ...crop, data: red }), union, context));
  let changed = 0, outsideChanged = 0;
  for (let p = 0; p < union.length; p++) {
    if (!union[p]) { if ([0, 1, 2, 3].some(c => result.data[p * 4 + c] !== source.data[p * 4 + c])) outsideChanged++; }
    else if (result.data[p * 4] !== source.data[p * 4]) changed++;
  }
  expect(changed).toBeGreaterThan(500);
  expect(outsideChanged).toBe(0);
  expect(result.data[(355 * 600 + 255) * 4]).toBe(230);
});

it("rejects a text-like component crossing the selection instead of silently clipping it", async () => {
  const source = await sourcePixels(await image(400, 400, '<rect x="120" y="160" width="120" height="25"/>'));
  const { union } = await buildEditMasks([instruction(.25, .35, .4, .15)], 400, 400);
  const moved = await image(400, 400, '<rect x="120" y="125" width="160" height="40"/>');
  await expect(checkEditBoundary(source, moved, union)).rejects.toMatchObject({ artworkOutputCode: "EDIT_OUTSIDE_SELECTION" });
  await expect(checkEditBoundary(source, await image(600, 400), union)).rejects.toMatchObject({ artworkOutputCode: "EDIT_FRAME_CHANGED" });
});

it("accepts unchanged downsampled context and preserves brush eraser holes", async () => {
  const source = await sourcePixels(await image(500, 500, '<rect x="30" y="30" width="440" height="440" fill="#18375a"/>'));
  const instructions = [{ prompt: "Recolor", shapes: [{ kind: "brush", radius: .08, points: [{ x: .5, y: .5 }] }, { kind: "brush", radius: .03, points: [{ x: .5, y: .5 }], erase: true }] }];
  const { union } = await buildEditMasks(instructions, 500, 500);
  const context = editContext(source, union), crop = await cropSource(source, context);
  const result = await sourcePixels(await compositeContextEdit(source, await sourcePng(crop), union, context));
  expect(result.data).toEqual(source.data);
});

it("offers boundary differences for explicit review while preserving every protected pixel", async () => {
  const source = await sourcePixels(await image(400, 400));
  const { union } = await buildEditMasks([instruction(.25, .35, .4, .15)], 400, 400);
  const context = editContext(source, union);
  const generated = await image(context.width, context.height, '<rect width="100%" height="100%" fill="red"/>');
  const preview = await buildContextPreview(source, generated, union, context, { reviewBoundary: true });
  expect(preview.warningCode).toBe("EDIT_BOUNDARY_REVIEW");
  const result = await sourcePixels(preview.buffer);
  let insideChanged = 0, outsideChanged = 0;
  for (let p = 0; p < union.length; p++) {
    if (!union[p]) { if ([0, 1, 2, 3].some(c => result.data[p * 4 + c] !== source.data[p * 4 + c])) outsideChanged++; }
    else if (result.data[p * 4 + 1] !== source.data[p * 4 + 1]) insideChanged++;
  }
  expect(outsideChanged).toBe(0);
  expect(insideChanged).toBeGreaterThan(100);
  await expect(buildContextPreview(source, await image(600, 400), union, context, { reviewBoundary: true }))
    .rejects.toMatchObject({ artworkOutputCode: "EDIT_FRAME_CHANGED" });
});

it("keeps the focused edit instructions separate from locked extraction prompts", () => {
  const prompt = buildArtworkEditPrompt([instruction(.2, .2, .3, .3)], { focused: true });
  expect(prompt).toContain("focused context crop");
  expect(prompt).toContain("line count");
  expect(prompt).toContain("Removal of a nearby icon must never pull text upward");
});

it("reinforces the exact replacement spelling without rewriting the user's instruction", () => {
  const instruction = "Replace the selected text with Desaynclaw. Match its style and position.";
  const prompt = buildArtworkEditPrompt([{ prompt: instruction }], { focused: true });
  const payload = JSON.parse(prompt.slice(prompt.lastIndexOf("\n") + 1));
  expect(payload).toEqual([{ region: 1, selection_color: "red", instruction, replacement_text: "Desaynclaw", replacement_characters: Array.from("Desaynclaw") }]);
  const freeform = 'Recolor the text red. Do not replace it with "green".';
  const other = buildArtworkEditPrompt([{ prompt: freeform }]);
  expect(JSON.parse(other.slice(other.lastIndexOf("\n") + 1))).toEqual([{ region: 1, selection_color: "red", instruction: freeform }]);
});

it("routes all five instructions by the renderer's colors without asking for painted numeric markers", () => {
  const instructions=EDIT_REGION_COLORS.map(({name})=>({prompt:`Keep ${name} region unchanged.`}));
  const prompt=buildArtworkEditPrompt(instructions,{focused:true});
  const payload=JSON.parse(prompt.slice(prompt.lastIndexOf("\n")+1));
  expect(payload.map(row=>row.selection_color)).toEqual(EDIT_REGION_COLORS.map(row=>row.name));
  expect(payload.map(row=>row.instruction)).toEqual(instructions.map(row=>row.prompt));
  expect(prompt).toContain("no added numbers, labels, circles, or pins");
  expect(prompt).toContain("Region IDs in the JSON are routing metadata, not characters to draw");
  expect(prompt).toContain("Original artwork lettering and numbers in image 1 remain intact");
  expect(prompt).toContain("Replace the selected wording as a complete text unit with replacement_text only");
  expect(prompt).toContain("exact replacement wording takes priority over preserving the old number of words or lines");
  expect(prompt).not.toContain("colored areas and numbers in image 2");
});
