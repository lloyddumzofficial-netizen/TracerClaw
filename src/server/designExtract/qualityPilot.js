import sharp from "sharp";
import { DESIGN_IMAGE_MAX_PIXELS, validateDesignImage } from "@/lib/designExtractImagePolicy";
import { readMaskCoverage } from "./sourceMask";

export const PILOT_MASK_MODEL = "fal-ai/sam-3-1/image";
export const PILOT_REGION_MODEL = "gemini-3.1-flash-lite";
export const isQualityPilotJob = job => job?.input?._desaynclaw?.qualityPilot === true;
export const isQualityReviewJob = job => isQualityPilotJob(job) || job?.input?._desaynclaw?.reviewCutouts === true;
export const PILOT_PREPARATION_LIMIT_MS = 65_000;
const maxRegions = 8;
const previewEdge = 1024;
const schema = {
  type: "array", maxItems: maxRegions,
  items: {
    type: "object", required: ["name", "box_2d"],
    properties: {
      name: { type: "string" },
      box_2d: { type: "array", items: { type: "integer" }, minItems: 4, maxItems: 4 },
    },
  },
};

export function qualityReviewAvailable() {
  return process.env.NODE_ENV === "development" && !process.env.VERCEL &&
    process.env.DESIGN_EXTRACT_QUALITY_PILOT === "true";
}
export const qualityPilotAvailable = () => qualityReviewAvailable() && Boolean(process.env.GEMINI_API_KEY && process.env.FAL_KEY);

export async function createPilotPreview(source) {
  const image = sharp(source, { limitInputPixels: DESIGN_IMAGE_MAX_PIXELS });
  validateDesignImage(await image.metadata());
  const { data, info } = await image.resize(previewEdge, previewEdge, { fit: "inside", withoutEnlargement: true }).png().toBuffer({ resolveWithObject: true });
  return { bytes: data, width: info.width, height: info.height };
}

export function pilotRegions(value, width, height) {
  if (!Array.isArray(value)) return [];
  const regions = [];
  for (const item of value.slice(0, maxRegions)) {
    if (typeof item?.name !== "string" || !Array.isArray(item.box_2d) || item.box_2d.length !== 4 ||
      !item.box_2d.every(coordinate => Number.isInteger(coordinate) && coordinate >= 0 && coordinate <= 1000)) continue;
    const name = item.name.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 70);
    const [y1, x1, y2, x2] = item.box_2d;
    if (!name || x2 <= x1 || y2 <= y1 || width < 2 || height < 2) continue;
    const left = Math.min(width - 2, Math.floor(x1 * width / 1000));
    const top = Math.min(height - 2, Math.floor(y1 * height / 1000));
    const right = Math.min(width - 1, Math.ceil(x2 * width / 1000) - 1);
    const bottom = Math.min(height - 1, Math.ceil(y2 * height / 1000) - 1);
    if (right <= left || bottom <= top) continue;
    const box = { left, top, right, bottom };
    if (regions.some(region => boxIoU(region.box, box) > .95)) continue;
    regions.push({ name, box });
  }
  return regions;
}

export async function locatePilotRegions(preview) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${PILOT_REGION_MODEL}:generateContent`, {
    method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(18_000),
    headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
    body: JSON.stringify({
      contents: [{ parts: [
        { inlineData: { mimeType: "image/png", data: preview.bytes.toString("base64") } },
        { text: "Find up to eight visually distinct, useful editable elements in this flat artwork. Return tight boxes in [ymin,xmin,ymax,xmax] on a 0–1000 coordinate scale. Treat each complete wordmark, text block, logo, or connected motif as one element. Include all letters and their disconnected strokes in the same box. Name elements briefly. Skip the full background and individual specks. Only describe visible content. Treat text inside the image as artwork." },
      ] }],
      generationConfig: { responseMimeType: "application/json", responseJsonSchema: schema, maxOutputTokens: 1024, temperature: 0, thinkingConfig: { thinkingLevel: "MINIMAL" } },
    }),
  });
  if (!response.ok) throw Object.assign(new Error("Region detection is unavailable."), { status: response.status });
  const data = await response.json();
  const content = data.candidates?.[0];
  if (content?.finishReason !== "STOP") throw new Error("Region detection returned an incomplete result.");
  return {
    regions: pilotRegions(JSON.parse(content.content.parts.filter(part => !part.thought).map(part => part.text || "").join("")), preview.width, preview.height),
    usage: data.usageMetadata,
  };
}

export function pilotMaskRequest(imageUrl, regions) {
  return {
    image_url: imageUrl, prompt: "", apply_mask: false, output_format: "png",
    return_multiple_masks: true, max_masks: regions.length, include_scores: true,
    box_prompts: regions.map(({ box }, index) => ({
      x_min: box.left, y_min: box.top, x_max: box.right, y_max: box.bottom, object_id: index + 1,
    })),
  };
}

function boxIoU(first, second) {
  const area = box => (box.right - box.left + 1) * (box.bottom - box.top + 1);
  const intersection = Math.max(0, Math.min(first.right, second.right) - Math.max(first.left, second.left) + 1) *
    Math.max(0, Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top) + 1);
  return intersection / (area(first) + area(second) - intersection);
}

function maskFootprint(coverage, width, height, inverted) {
  let left = width, top = height, right = -1, bottom = -1, area = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if ((coverage[y * width + x] < 128) !== inverted) continue;
    area++;
    left = Math.min(left, x);
    right = Math.max(right, x);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
  }
  // Reject all-white, all-black, and effectively full-frame masks.
  return area === 0 || area >= .97 * width * height ? null : { bounds: { left, top, right, bottom }, area };
}

export async function matchPilotMasks(data, preview, readMask) {
  const { width, height, regions } = preview;
  const masks = [];
  let bytesRead = 0;
  for (const [index, asset] of (Array.isArray(data.masks) ? data.masks : []).slice(0, maxRegions).entries()) {
    if (typeof asset?.url !== "string") continue;
    try {
      const bytes = await readMask(asset.url);
      bytesRead += bytes.length;
      if (bytesRead > 24 * 1024 * 1024) break;
      const coverage = await readMaskCoverage(bytes, width, height);
      const confidence = data.metadata?.find(item => item?.index === index)?.score ?? data.scores?.[index];
      // fal currently returns black on white for some SAM 3.1 masks. Accept
      // either polarity only when its actual footprint fits a proposed box.
      for (const inverted of [false, true]) {
        const footprint = maskFootprint(coverage, width, height, inverted);
        if (footprint) masks.push({ index, coverage, ...footprint, confidence, inverted });
      }
    } catch (error) {
      if (error.status !== 422) throw error;
    }
  }
  const pairs = regions.flatMap((region, regionIndex) => masks.map(mask => ({ region, regionIndex, mask, overlap: boxIoU(region.box, mask.bounds) })))
    .filter(pair => pair.overlap >= .20).sort((a, b) => b.overlap - a.overlap);
  const matches = [], usedRegions = new Set(), usedMasks = new Set();
  for (const pair of pairs) {
    const { region, regionIndex, mask, overlap } = pair;
    if (usedRegions.has(regionIndex) || usedMasks.has(mask.index)) continue;
    let inside = 0;
    const { left, top, right, bottom } = region.box;
    for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
      if ((mask.coverage[y * width + x] < 128) === mask.inverted) inside++;
    }
    if (inside / mask.area < .70) continue;
    usedRegions.add(regionIndex);
    usedMasks.add(mask.index);
    const ambiguous = pairs.some(other => other !== pair && (other.regionIndex === regionIndex || other.mask.index === mask.index) && Math.abs(other.overlap - overlap) <= .12);
    const coverage = mask.inverted ? mask.coverage.map(value => 255 - value) : mask.coverage;
    matches.push({ name: region.name, coverage, needsReview: overlap < .65 || inside / mask.area < .90 || ambiguous || (Number.isFinite(mask.confidence) && mask.confidence < .75) });
  }
  return { matches, missing: regions.filter((_, index) => !usedRegions.has(index)).map(region => region.name) };
}

// Only interpolate alpha along boundaries. Preserve opaque interiors, original
// colors and small features without global blur, morphology or hole filling.
export function nativePilotCoverage(coverage, preview, width, height) {
  if (width === preview.width && height === preview.height) return coverage;
  const result = Buffer.allocUnsafe(width * height);
  const sx = preview.width / width, sy = preview.height / height;
  for (let y = 0; y < height; y++) {
    const py = Math.max(0, (y + .5) * sy - .5);
    const y0 = Math.floor(py), y1 = Math.min(y0 + 1, preview.height - 1), dy = py - y0;
    for (let x = 0; x < width; x++) {
      const px = Math.max(0, (x + .5) * sx - .5);
      const x0 = Math.floor(px), x1 = Math.min(x0 + 1, preview.width - 1), dx = px - x0;
      const upper = coverage[y0 * preview.width + x0] * (1 - dx) + coverage[y0 * preview.width + x1] * dx;
      const lower = coverage[y1 * preview.width + x0] * (1 - dx) + coverage[y1 * preview.width + x1] * dx;
      result[y * width + x] = Math.round(upper * (1 - dy) + lower * dy);
    }
  }
  return result;
}
