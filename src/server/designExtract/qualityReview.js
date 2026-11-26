import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { DESIGN_IMAGE_MAX_PIXELS } from "@/lib/designExtractImagePolicy";
import { arrangeOverview } from "@/lib/designExtractLayout";
import { cleanDesignEdges, edgeCleanupSettings } from "@/lib/designEdgeCleanup";
import { renderMask } from "./mask";
import { automaticCutouts } from "./automaticCutouts";
import { separateElements } from "./separateElements";
import { MAX_LAYERS } from "@/lib/designExtract";
import { ownsPrivateDesignAsset, privateDesignKey, readPrivateDesignAsset, uploadDesignAsset } from "./storage";

const invalid = (message, status = 422) => Object.assign(new Error(message), { status, designExtractError: true });
const root = (project, job) => `users/${project.user_id}/design-extract/${project.id}/${job.id}/review/`;
const keyOf = (project, job, draft) => root(project, job) + draft;
const alphaOf = bytes => sharp(bytes, { limitInputPixels: DESIGN_IMAGE_MAX_PIXELS }).ensureAlpha().extractChannel(3).raw().toBuffer();
const over = (under, top) => Math.round(top + under * (255 - top) / 255);

// Drafts are immutable snapshots. Acceptance references one draft explicitly,
// so two tabs cannot replace each other's proposals through a last write.
export async function readQualityDraft(project, job, draftId) {
  if (!draftId) return job.result;
  if (typeof draftId !== "string" || !/^[0-9a-f-]{36}$/.test(draftId)) throw invalid("Invalid review draft", 400);
  const bytes = await readPrivateDesignAsset(`r2-private://design-extract/${keyOf(project, job, draftId)}.json`, 128 * 1024);
  return JSON.parse(bytes.toString("utf8"));
}

async function encodeDraftLayer(original, alpha, layer, key, settings, baseAlpha = alpha) {
  const { width, height } = original.info;
  let pixels = Buffer.from(original.data);
  for (let i = 0; i < alpha.length; i++) pixels[i * 4 + 3] = alpha[i];
  pixels = cleanDesignEdges(pixels, width, height, settings);
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0, i = 0; y < height; y++) for (let x = 0; x < width; x++, i++) {
    if (!pixels[i * 4 + 3]) continue;
    left = Math.min(left, x); top = Math.min(top, y);
    right = Math.max(right, x); bottom = Math.max(bottom, y);
  }
  if (right < left) return null;
  const bounds = { left, top, width: right - left + 1, height: bottom - top + 1 };
  const trimmed = await sharp(pixels, { raw: original.info }).extract(bounds).png().toBuffer();
  // The brush initializes from alpha. RGB for future restores comes from the
  // separately retained original, so this intermediate can be a compact PNG.
  pixels.fill(0);
  for (let i = 0; i < baseAlpha.length; i++) pixels[i * 4 + 3] = baseAlpha[i];
  const fullMask = await sharp(pixels, { raw: original.info }).png().toBuffer();
  const url = await uploadDesignAsset(trimmed, key + ".png", "image/png");
  const maskBaseUrl = await uploadDesignAsset(fullMask, key + "-mask.png", "image/png");
  return { ...layer, url, maskBaseUrl, width: bounds.width, height: bounds.height, nativeFrame: { width, height, left, top },
    composition: { x: left, y: top, scale: 1 }, visible: true, locked: false, extractionMethod: "source-pixels" };
}

async function addLayerAlpha(coverage, layer, width, readAsset) {
  const alpha = await alphaOf(await readAsset(layer.url));
  const { left, top } = layer.nativeFrame;
  for (let y = 0; y < layer.height; y++) for (let x = 0; x < layer.width; x++) {
    const i = (top + y) * width + left + x;
    coverage[i] = over(coverage[i], alpha[y * layer.width + x]);
  }
}

async function colorDraft(project, job, source, draftId, key) {
  const layers = [];
  for await (const output of automaticCutouts(source, [], { limit: MAX_LAYERS, requireFlatColors: true })) {
    const { data, info } = await sharp(output.bytes, { limitInputPixels: DESIGN_IMAGE_MAX_PIXELS }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const [part] = separateElements(data, info.width, info.height, 1);
    if (!part) continue;
    const { left, top, width, height } = part.bounds;
    const trimmed = await sharp(data, { raw: info }).extract(part.bounds).png().toBuffer();
    const url = await uploadDesignAsset(trimmed, `${key}-${output.index}.png`, "image/png");
    const maskBaseUrl = await uploadDesignAsset(output.bytes, `${key}-${output.index}-mask.png`, "image/png");
    layers.push({ id: `${draftId}-${output.index}`, name: output.name, url, maskBaseUrl, width, height, maskSourceUrl: job.input.image_url,
      nativeFrame: { width: info.width, height: info.height, left, top }, composition: { x: left, y: top, scale: 1 },
      visible: true, locked: false, extractionMethod: "source-pixels", ...(!output.candidate && { remainder: true }) });
  }
  return saveDraft(draftId, key, { groupedByColor: true, layers: arrangeOverview(layers, project.manifest) });
}

async function saveDraft(draftId, key, result) {
  await uploadDesignAsset(Buffer.from(JSON.stringify(result)), key + ".json", "application/json");
  return { draftId, result };
}

export async function editQualityDraft(project, job, body, readAsset, wand) {
  const draft = await readQualityDraft(project, job, body.draftId);
  const source = await readAsset(job.input.image_url);
  const draftId = randomUUID(), key = keyOf(project, job, draftId);
  if (body.edit === "regroup-colors") return colorDraft(project, job, source, draftId, key);
  const layers = draft.layers.filter(layer => !layer.remainder);
  const target = layers.find(layer => layer.id === body.layerId);
  const original = await sharp(source, { limitInputPixels: DESIGN_IMAGE_MAX_PIXELS }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = original.info;
  let accepted = layers;
  if (body.edit === "group") {
    const ids = body.layerIds;
    if (!Array.isArray(ids) || new Set(ids).size !== ids.length || ids.length < 2 || ids.length > layers.length) throw invalid("Choose two or more fragments to group.");
    const grouped = layers.filter(layer => ids.includes(layer.id));
    if (grouped.length !== ids.length) throw invalid("Choose fragments from this extraction.");
    const coverage = Buffer.alloc(width * height);
    for (const layer of grouped) await addLayerAlpha(coverage, layer, width, readAsset);
    const item = { id: randomUUID(), name: grouped[0].name + " · Group", maskSourceUrl: job.input.image_url, needsReview: false };
    const rendered = await encodeDraftLayer(original, coverage, item, key + "-group");
    const group = { ...rendered, reviewBase: rendered };
    const remaining = layers.filter(layer => !ids.includes(layer.id));
    remaining.splice(layers.indexOf(grouped[0]), 0, group);
    accepted = remaining;
  } else if (body.edit === "reset") {
    if (!target?.reviewBase) throw invalid("No mask changes to reset.");
    accepted = layers.map(layer => layer.id === target.id ? target.reviewBase : layer);
  } else if (body.edit === "wand") {
    if (!wand || layers.length >= 31) throw invalid("Make room for the cutout. Maximum 32 layers.");
    const result = await wand(source);
    const coverage = await alphaOf(await result.image.png().toBuffer());
    const item = { id: randomUUID(), name: "Color cutout", maskSourceUrl: job.input.image_url };
    const rendered = await encodeDraftLayer(original, coverage, item, key + "-wand");
    accepted = [...layers, rendered];
  } else if (body.edit === "mask") {
    if (!target) throw invalid("Select a proposed layer to refine.");
    const upload = body.maskUrl;
    if (!ownsPrivateDesignAsset(upload, project.user_id) || !privateDesignKey(upload).startsWith(`staging/design-extract/${project.user_id}/`)) throw invalid("Unauthorized mask asset", 403);
    const softness = body.softness ?? 0;
    if (!Number.isFinite(softness) || softness < 0 || softness > 20) throw invalid("Invalid edge softness");
    const coverage = await readAsset(upload);
    const settings = edgeCleanupSettings(body.edgeCleanup);
    // Render softness first. Cleanup is applied once below to the previewed pixels.
    const result = await renderMask(source, coverage, softness);
    const alpha = await alphaOf(result.full);
    const base = softness ? await alphaOf(result.maskBase) : alpha;
    const item = { ...target, needsReview: false, reviewBase: target.reviewBase || target, edgeSoftness: softness, edgeCleanup: settings };
    const rendered = await encodeDraftLayer(original, alpha, item, key + "-edited", settings, base);
    if (!rendered) throw invalid("Keep at least one visible pixel before applying the mask.");
    accepted = layers.map(layer => layer.id === target.id ? rendered : layer);
  } else throw invalid("Invalid review edit", 400);

  // Recompute the remainder from the proposed layers in native coordinates.
  // Removing coverage from an element returns those pixels to the remainder.
  const covered = Buffer.alloc(width * height);
  for (const layer of accepted) await addLayerAlpha(covered, layer, width, readAsset);
  for (let i = 0; i < covered.length; i++) {
    const native = original.data[i * 4 + 3];
    covered[i] = covered[i] < native ? Math.round((native - covered[i]) * 255 / (255 - covered[i])) : 0;
  }
  const remainder = await encodeDraftLayer(original, covered, { id: job.id + "-remainder", name: "Remaining artwork", remainder: true, maskSourceUrl: job.input.image_url }, key + "-remainder");
  const result = { ...draft, layers: arrangeOverview(remainder ? [...accepted, remainder] : accepted, project.manifest) };
  return saveDraft(draftId, key, result);
}
