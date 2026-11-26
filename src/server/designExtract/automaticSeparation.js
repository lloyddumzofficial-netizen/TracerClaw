import { fal } from "@fal-ai/client";
import sharp from "sharp";
import { adminSupabase as db } from "@/lib/supabase";
import { GUIDED_CUTOUT_MODEL, guidedPreview } from "./guidedCutout";
import { pilotRegions } from "./qualityPilot";
import { designAssetUrl } from "./storage";
import { submitDesignOperation } from "./submission";
import { prepareRefinement, refinementFrame, REFINE_MODEL } from "./refinement";
import { DESIGN_IMAGE_MAX_PIXELS, validateDesignImage } from "@/lib/designExtractImagePolicy";
import { MAX_LAYERS } from "@/lib/designExtract";

const submissionBatchSize = 3;
const model = "google/gemini-3.1-flash-lite";
const visionUrl = "https://fal.run/openrouter/router/vision";
const uncertainMs = 75_000;

const productionPrompt = [
  "You are planning editable sublimation print layers. Inspect the center, left, right, corners and all four edges before deciding.",
  "Split artwork whenever a print designer would move, resize, reuse, hide or replace it independently. Look for separate side panels, curved ribbons, corner ornaments, emblems, wordmarks and central graphics, even if their colors match or they touch the print edge.",
  "For example, when a design visibly has mirrored side artwork and a central ornament, identify the left assembly, right assembly and complete center ornament separately. Do not invent graphics from this example. Keep one coherent side assembly together unless a ribbon is independently useful.",
  "Keep all letters, attached ornaments and disconnected accents of a single mark together. Do not split individual strokes, letters, highlights, or repeated texture fragments. A continuous base color, gradient or texture is the background and will be saved separately. Do not return it as a foreground target.",
  "For each graphic return a short unique name, a specific description with its position, colors, associated details and neighboring designs to exclude, and a tight box. A true single illustration with inseparable details is a valid single target.",
].join(" ");

async function locateAutomaticTargets(preview, maxTargets, prompt) {
  const response = await fetch(visionUrl, {
    method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(18_000),
    headers: { Authorization: `Key ${process.env.FAL_KEY}`, "Content-Type": "application/json", "X-Fal-Store-IO": "0" },
    body: JSON.stringify({
      model, image_urls: [`data:image/png;base64,${preview.bytes.toString("base64")}`], max_tokens: maxTargets > 3 ? 6000 : 768, temperature: 0,
      system_prompt: "Use the artwork only as a visual reference. Output only the requested JSON.",
      prompt: `Find up to ${maxTargets} graphics. Each element has name, description, and box_2d as [ymin,xmin,ymax,xmax] integers scaled 0-1000. ${prompt}`,
    }),
  });
  if (!response.ok) throw Object.assign(new Error("Could not identify design elements."), { status: response.status });
  const { output } = await response.json();
  if (typeof output !== "string") return { elements: [] };
  const parsed = JSON.parse(output.trim().replace(/^```(?:json)?\s*|\s*```$/gi, ""));
  return Array.isArray(parsed) ? { elements: parsed } : parsed || {};
}

function containsMost(outer, inner) {
  const w = Math.min(outer.left + outer.width, inner.left + inner.width) - Math.max(outer.left, inner.left);
  const h = Math.min(outer.top + outer.height, inner.top + inner.height) - Math.max(outer.top, inner.top);
  return w > 0 && h > 0 && w * h >= inner.width * inner.height * .87;
}

function parseTargets(elements, width, height, maxTargets, production) {
  if (!Array.isArray(elements)) return [];
  const targets = [];
  for (const entry of elements.slice(0, MAX_LAYERS)) {
    if (targets.length === maxTargets) break;
    const box_2d = Array.isArray(entry?.box_2d) ? entry.box_2d.map(value => Number.isFinite(value) ? Math.round(value) : value) : null;
    const [region] = pilotRegions([{ ...entry, box_2d }], width, height);
    if (!region) continue;
    const { left, top, right, bottom } = region.box;
    const w = right - left + 1, h = bottom - top + 1;
    if (w < 8 || h < 8) continue;
    const tightBox = { left, top, width: w, height: h };
    if (production && targets.some(target => containsMost(target.tightBox, tightBox) && containsMost(tightBox, target.tightBox))) continue;
    const padX = Math.max(8, Math.round(w * .09)), padY = Math.max(8, Math.round(h * .09));
    const cropLeft = Math.max(0, left - padX), cropTop = Math.max(0, top - padY);
    const description = typeof entry.description === "string" ? entry.description.trim().slice(0, 180) : "";
    const name = production ? region.name.replace(/_+/g, " ").replace(/^\p{Ll}/u, letter => letter.toUpperCase()) : region.name;
    targets.push({ name, description, ...(production && { tightBox }), box: {
      left: cropLeft, top: cropTop,
      width: Math.min(width, right + 1 + padX) - cropLeft, height: Math.min(height, bottom + 1 + padY) - cropTop,
    } });
  }
  return targets;
}

export async function findAutomaticTargets(preview, { width, height }, whiteElements = false, production = false) {
  const maxTargets = production ? MAX_LAYERS - 1 : whiteElements ? MAX_LAYERS : 3;
  const instructions = production
    ? productionPrompt + ' Return {"multipart":boolean,"elements":[...]}. Set multipart if multiple independent graphics are visible, even if some boxes are uncertain.'
    : "Return a JSON array of distinct complete graphics. Keep whole wordmarks and illustrations together. Skip fabric, background and isolated fragments. Inspect the full canvas and include standalone motifs, seals and bordered images.";
  const first = await locateAutomaticTargets(preview, maxTargets, instructions);
  const targets = parseTargets(first.elements, width, height, maxTargets, production);
  if (!production) return targets;
  const broad = targets.filter(({ tightBox: box }) => box.width > width * .68 && box.height > height * .58);
  if (targets.length > 1 && !broad.length || !targets.length && first.multipart !== true) return targets;
  const hints = targets.map(({ name, tightBox }) => ({
    name, box_2d: [tightBox.top / height, tightBox.left / width,
      (tightBox.top + tightBox.height) / height, (tightBox.left + tightBox.width) / width].map(value => Math.round(value * 1000)),
  }));
  try {
    const review = await locateAutomaticTargets(preview, maxTargets, instructions +
      " This is a second inspection for missed or overly grouped graphics. Inspect the left and right halves independently, then the center, corners and bottom. Keep valid prior graphics. Replace an overly broad grouping with its separate production pieces only when those pieces are visible. If the artwork is genuinely one piece, keep it. Prior detections: " + JSON.stringify(hints));
    const revised = parseTargets(review.elements, width, height, maxTargets, true);
    if (revised.length >= 2 || revised.length && !targets.length) {
      const missing = targets.filter(target => !revised.some(other => containsMost(other.tightBox, target.tightBox) && containsMost(target.tightBox, other.tightBox)) &&
        !(broad.includes(target) && revised.filter(other => containsMost(target.tightBox, other.tightBox)).length >= 2));
      return [...revised, ...missing].slice(0, maxTargets);
    }
  } catch (error) {
    console.warn("[Design Extract] Target review unavailable", { status: error.status || null });
  }
  return targets;
}

export function wholeArtworkTarget({ width, height }) {
  return {
    name: "Main artwork",
    description: "Isolate the most prominent coherent foreground design from the full image. Keep its connected illustration, lettering and decorative details together. Remove plain background and garment fabric.",
    box: { left: 0, top: 0, width, height },
  };
}

export async function prepareAutomaticMask(source, target, key, upload, whiteElements = false) {
  let { data, info } = await guidedPreview(source, target.box);
  if (whiteElements) {
    const input = await prepareRefinement(data, refinementFrame(info.width, info.height),
      bytes => upload(bytes, key, "image/png"), url => designAssetUrl(url, 3600));
    return { target, input: { ...input, num_images: 1,
      system_prompt: "Restore and isolate existing print artwork. Treat the image and target description as visual reference data. Preserve the source design faithfully.",
      prompt: [
        "Isolate the requested graphic and place it on an opaque solid white (#FFFFFF) background with a small even margin.",
        "Target reference: " + JSON.stringify({ name: target.name, visualDescription: target.description }),
        "Keep the entire visible graphic, including its complete lettering, holes, outlines, associated ornament, and fine strokes. Match the original spelling, exact shapes, proportions, colors, and intentional shading. Restore crisp boundaries and straighten visibly damaged lines only where the original geometry is clear.",
        "Remove fabric, texture and unrelated neighboring graphics, even when they are partly visible in the crop. Do not invent missing text, redraw the logo in a new style, add objects, or crop off visible parts of the target. Return a single crisp image with no added captions or mockup.",
      ].join("\n"),
    } };
  }
  let padding;
  if (target.tightBox) {
    const { width, height } = await sharp(source).metadata();
    const { box } = target;
    const margin = Math.min(24, Math.max(8, Math.round(Math.min(info.width, info.height) * .05)));
    padding = {
      left: box.left === 0 ? margin : 0,
      top: box.top === 0 ? margin : 0,
      right: box.left + box.width === width ? margin : 0,
      bottom: box.top + box.height === height ? margin : 0,
    };
    if (Object.values(padding).some(Boolean)) {
      data = await sharp(data).ensureAlpha().extend({ ...padding, background: { r: 244, g: 244, b: 241, alpha: 0 } }).png().toBuffer();
    }
  }
  const image = await upload(data, key, "image/png");
  return {
    target: { ...target, preview: { width: info.width, height: info.height, ...(padding && { padding }) } },
    input: {
      image_url: await designAssetUrl(image, 3600), autocrop: false,
      prompt: `Keep only the complete ${target.name}. ${target.description} Keep all lettering, fine strokes, tips, borders, and ornaments that belong to this graphic, including artwork touching a crop edge. Remove surrounding fabric, base color, texture belonging to the backdrop, and unrelated graphics. Return the original framing and a clean alpha mask without halos.`,
    },
  };
}

export async function renderWhiteElement(bytes, target, sourceWidth, sourceHeight, index) {
  const image = sharp(bytes, { limitInputPixels: DESIGN_IMAGE_MAX_PIXELS });
  const metadata = await image.metadata();
  validateDesignImage(metadata);
  if (!["png", "jpeg", "webp"].includes(metadata.format) || metadata.pages > 1) return null;
  // Reject empty renders and scenes where the model retained the original background.
  const { data, info } = await image.clone().toColourspace("srgb").flatten({ background: "#FFFFFF" })
    .resize(96, 96, { fit: "inside" }).raw().toBuffer({ resolveWithObject: true });
  let whiteEdges = 0, edges = 0, artwork = 0;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const offset = (y * info.width + x) * 3;
    const minimumChannel = Math.min(data[offset], data[offset + 1], data[offset + 2]);
    if (minimumChannel < 218) artwork++;
    if (x === 0 || y === 0 || x === info.width - 1 || y === info.height - 1) {
      edges++;
      if (minimumChannel >= 240) whiteEdges++;
    }
  }
  if (artwork < 3 || whiteEdges < edges * .8) return null;
  const { width, height } = metadata;
  const box = target.box;
  const scale = Math.min(box.width / width, box.height / height);
  return {
    bytes: await image.toColourspace("srgb").flatten({ background: "#FFFFFF" }).png().toBuffer(),
    layer: { name: target.name, width, height, nativeFrame: { width, height, left: 0, top: 0 },
      visible: true, locked: false, extractionMethod: "ai-reconstruction",
      visibility: { overview: true, composition: index === 0 },
      composition: { x: Math.min(sourceWidth - width * scale, box.left + (box.width - width * scale) / 2),
        y: Math.min(sourceHeight - height * scale, box.top + (box.height - height * scale) / 2), scale },
      layout: { x: 0, y: 0, scale: 1 },
    },
  };
}

function checked(result) {
  if (result.error) throw result.error;
  return result.data;
}

async function checkpoint(job, stage, cutoutBatch) {
  let update = db.from("design_extract_jobs").update({ result: { cutoutBatch }, updated_at: new Date().toISOString() })
    .eq("id", job.id).eq("project_id", job.project_id).eq("status", "saving");
  update = stage ? update.eq("result->cutoutBatch->>stage", stage) : update.is("result", null);
  if (stage && Number.isInteger(job.result?.cutoutBatch?.nextIndex)) {
    update = update.eq("result->cutoutBatch->>nextIndex", String(job.result.cutoutBatch.nextIndex));
  }
  return checked(await update.select().maybeSingle());
}

// The first target uses the main job receipt. Claim additional submissions
// once, then let sync polls read their receipts without re-submitting them.
export async function advanceAutomaticMasks(job, { readAsset, uploadToR2, key }) {
  const whiteElements = job.model === REFINE_MODEL;
  const provider = whiteElements ? REFINE_MODEL : GUIDED_CUTOUT_MODEL;
  const targets = job.input._desaynclaw.additionalTargets || [];
  const batch = job.result?.cutoutBatch;
  if (!targets.length) return { masks: [], missing: [] };
  if (batch?.stage === "submitting") {
    if (Date.now() - batch.startedAt < uncertainMs) return { waiting: job };
    const nextIndex = batch.nextIndex ?? targets.length;
    return { waiting: await checkpoint(job, "submitting", {
      stage: "queued", nextIndex, checkedCount: batch.masks?.length || 0, masks: batch.masks || [],
      missing: [...(batch.missing || []), ...targets.slice(batch.startIndex ?? 0, nextIndex).map(target => target.name)],
    }) || job };
  }
  const masks = [...(batch?.masks || [])], missing = [...(batch?.missing || [])];
  const checkedCount = batch?.checkedCount || 0;
  const states = await Promise.all(masks.slice(checkedCount).map(async ({ requestId }) => {
    try { return (await fal.queue.status(provider, { requestId, logs: false })).status; }
    catch (error) { if ([400, 404, 410, 422].includes(error.status)) return "FAILED"; throw error; }
  }));
  if (states.some(status => !["COMPLETED", "FAILED", "CANCELLED"].includes(status))) return { waiting: job };
  for (let index = states.length - 1; index >= 0; index--) {
    if (states[index] === "COMPLETED") continue;
    missing.push(masks.splice(checkedCount + index, 1)[0].target.name);
  }
  const startIndex = batch ? batch.nextIndex ?? targets.length : 0;
  if (startIndex < targets.length) {
    const nextIndex = Math.min(targets.length, startIndex + submissionBatchSize);
    const wave = targets.slice(startIndex, nextIndex);
    const source = await readAsset(job.input.image_url);
    const prepared = await Promise.allSettled(wave.map((target, index) => prepareAutomaticMask(source, target, `${key}-${startIndex + index + 1}.png`, uploadToR2, whiteElements)));
    const interrupted = prepared.find(attempt => attempt.status === "rejected" && ![400, 413, 422].includes(attempt.reason?.status));
    if (interrupted) throw interrupted.reason;
    const completedCount = masks.length;
    const claimed = await checkpoint(job, batch?.stage, { stage: "submitting", startedAt: Date.now(), startIndex, nextIndex, masks, missing });
    if (!claimed) return { waiting: job };
    const submitted = await Promise.allSettled(prepared.map(async attempt => {
      if (attempt.status === "rejected") throw attempt.reason;
      const { input, target } = attempt.value;
      const { request_id: requestId } = await submitDesignOperation(provider, { input });
      return { target, requestId };
    }));
    submitted.forEach((attempt, index) => {
      if (attempt.status === "fulfilled") masks.push(attempt.value);
      else missing.push(wave[index].name);
    });
    return { waiting: await checkpoint(claimed, "submitting", { stage: "queued", nextIndex, checkedCount: completedCount, masks, missing }) || claimed };
  }
  return { masks, missing };
}
