import { fal } from "@fal-ai/client";
import { adminSupabase as db } from "@/lib/supabase";
import { arrangeOverview } from "@/lib/designExtractLayout";
import { designAssetUrl } from "./storage";
import { GUIDED_BACKGROUND_MODEL, blendGuidedBackground, prepareGuidedBackground } from "./guidedBackground";
import { submitDesignOperation } from "./submission";
import { isAutomaticSeparationJob } from "./guidedCutout";

const uncertainMs = 120_000;
const failure = "Could not fill the background. Your saved artwork is intact.";
export const interruptedCutoutError = "Provider returned no usable layers";
export function hasRecoverableBackground(job) {
  const fill = job?.result?.backgroundFill;
  return job?.status === "failed" && job.error === interruptedCutoutError &&
    job.billing_state !== "refunded" && job.result?.layers?.length > 0 &&
    fill?.stage === "queued" && /^[\w-]{8,120}$/.test(fill.requestId || "");
}
function checked(result) {
  if (result.error) throw result.error;
  return result.data;
}
const current = async job => checked(await db.from("design_extract_jobs").select("*").eq("project_id", job.project_id).eq("id", job.id).single());

export function readyCutoutsWithoutFill(job, warning) {
  if (job.processor !== "local" || !isAutomaticSeparationJob(job) || !job.result?.layers?.length) return null;
  const { backgroundFill: _fill, productionOutput: pending, ...result } = job.result;
  return { status: "ready", error: null, result: {
    ...result, missing: [...new Set([...(result.missing || []), ...(pending?.targets.slice(pending.nextIndex).map(({ target }) => target.name) || [])])],
    warnings: [...new Set([...(result.warnings || []), warning])],
  } };
}

async function checkpoint(job, stage, values, branch = "backgroundFill") {
  let change = db.from("design_extract_jobs").update({ ...values, updated_at: new Date().toISOString() })
    .eq("project_id", job.project_id).eq("id", job.id).eq("status", job.status);
  change = stage ? change.eq(`result->${branch}->>stage`, stage) : change.is("result", null);
  return checked(await change.select().maybeSingle());
}

export async function prepareGuidedFillJob(project, job, result, { readAsset, uploadToR2, prefix }) {
  if (job.processor === "local" && isAutomaticSeparationJob(job) && !job.result?.backgroundFill) {
    return await checkpoint(job, job.result?.cutoutBatch?.stage, {
      result: { ...result, backgroundFill: { stage: "preparing" } },
    }, "cutoutBatch") || current(job);
  }
  const cleanBackground = !result.replaceExtraction && project.manifest.layers.find(layer => layer.guidedBackground && layer.filledGuidedBackground);
  const sourceUrl = cleanBackground?.maskBaseUrl || job.input.image_url;
  async function* removalMasks() {
    // Older projects can contain a background with holes. Rebuild it from the
    // original and all its accepted cutouts when the next one is extracted.
    if (!cleanBackground && !result.replaceExtraction) {
      for (const layer of project.manifest.layers) if (layer.guidedElement && layer.guidedMaskUrl) yield await readAsset(layer.guidedMaskUrl);
    }
    for (const selected of result.layers) yield await readAsset(selected.guidedMaskUrl);
  }
  const inputs = await prepareGuidedBackground(await readAsset(sourceUrl), removalMasks(), { detectFlat: job.input?._desaynclaw?.productionLayers === true });
  const key = `${prefix(project)}${job.id}/background`;
  if (inputs.restored) {
    return await publishBackground(project, job, result, inputs.restored, { uploadToR2, prefix }, "preparing", "source-pixels");
  }
  const imageUrl = await uploadToR2(inputs.image, key + "-input.png", "image/png");
  const maskUrl = await uploadToR2(inputs.mask, key + "-mask.png", "image/png");
  const blendUrl = await uploadToR2(inputs.blend, key + "-blend.png", "image/png");
  const backgroundFill = { stage: "pending", sourceUrl, imageUrl, maskUrl, blendUrl, box: inputs.box, preview: inputs.preview };
  if (job.result?.backgroundFill?.stage === "preparing") {
    return await checkpoint(job, "preparing", { result: { ...result, backgroundFill } }) || current(job);
  }
  return await checkpoint(job, job.result?.cutoutBatch?.stage, { result: { ...result, backgroundFill } }, "cutoutBatch") || current(job);
}

async function failed(job, detail = failure) {
  const partial = readyCutoutsWithoutFill(job, "The cutouts are ready. The background fill could not be saved.");
  return await checkpoint(job, job.result.backgroundFill.stage, partial || { result: null, status: "failed", error: detail }) || current(job);
}

async function publishBackground(project, job, result, png, { uploadToR2, prefix }, stage, extractionMethod) {
  const url = await uploadToR2(png, `${prefix(project)}${job.id}/background-filled.png`, "image/png");
  const { nativeWidth: width, nativeHeight: height } = result;
  const background = { id: `${job.id}-background`, name: "Background · Filled", url, maskBaseUrl: url, maskSourceUrl: url,
    width, height, nativeFrame: { width, height, left: 0, top: 0 }, composition: { x: 0, y: 0, scale: 1 }, visible: true, locked: false,
    guidedBackground: true, filledGuidedBackground: true, extractionMethod,
    ...(result.missing?.length && { needsReview: true }) };
  const patch = {
    status: "ready", error: null,
    result: { ...result, layers: arrangeOverview([background, ...result.layers], project.manifest) },
  };
  const recoveringLegacy = job.status === "failed" && job.processor === "legacy";
  let ready;
  try {
    ready = await checkpoint(job, stage, { ...patch, ...(job.status === "failed" && { processor: "local" }) });
  } catch (error) {
    const oldProcessorConstraint = error.code === "23514" && error.message?.includes("design_extract_jobs_processor_check");
    if (!recoveringLegacy || !oldProcessorConstraint || project.manifest.layers.length || project.revision !== job.base_revision) throw error;
    // The legacy worker can see the ready job only after all recorded assets are saved.
    ready = await checkpoint(job, "queued", patch);
  }
  return ready || current(job);
}

async function saveFilledBackground(project, job, fill, result, { readAsset, uploadToR2, prefix }) {
  const { data } = await fal.queue.result(GUIDED_BACKGROUND_MODEL, { requestId: fill.requestId });
  if (!data.image?.url || data.has_nsfw_concepts?.some(Boolean)) {
    throw Object.assign(new Error("The recorded fill has no usable image."), { status: 422, designExtractError: true });
  }
  const source = await readAsset(fill.sourceUrl);
  const output = await readAsset(data.image.url, true);
  const png = await blendGuidedBackground(source, output, await readAsset(fill.blendUrl), fill);
  return publishBackground(project, job, result, png, { uploadToR2, prefix }, "queued", "ai-reconstruction");
}

// Keep a failed job out of the watchdog's processing queue until all its
// existing output is available. Recovery never submits a provider request.
export async function recoverRecordedBackground(project, job, assets) {
  const { backgroundFill: fill, ...result } = job.result;
  const status = await fal.queue.status(GUIDED_BACKGROUND_MODEL, { requestId: fill.requestId, logs: false });
  if (status.status !== "COMPLETED") throw Object.assign(new Error("The recorded background fill is still processing. Check again shortly."), { status: 409, designExtractError: true });
  return saveFilledBackground(project, job, fill, result, assets);
}

export async function advanceGuidedFillJob(project, job, { readAsset, uploadToR2, prefix }) {
  const { backgroundFill: fill, ...result } = job.result;
  if (fill.stage === "preparing") {
    try {
      return await prepareGuidedFillJob(project, job, result, { readAsset, uploadToR2, prefix });
    } catch (error) {
      if ([400, 404, 413, 422].includes(error.status) || error.name === "ValidationError") return failed(job);
      throw error;
    }
  }
  if (fill.stage === "pending") {
    const image_url = await designAssetUrl(fill.imageUrl, 3600);
    const mask_url = await designAssetUrl(fill.maskUrl, 3600);
    const claimed = await checkpoint(job, "pending", { result: { ...result, backgroundFill: { ...fill, stage: "submitting", startedAt: Date.now() } } });
    if (!claimed) return current(job);
    let receipt;
    try {
      receipt = await submitDesignOperation(GUIDED_BACKGROUND_MODEL, { input: { image_url, mask_url } });
    } catch (error) {
      if ([400, 401, 402, 403, 404, 422, 429].includes(error.status)) return failed(claimed);
      // An uncertain submission is observed until the deadline. Never send it twice.
      return claimed;
    }
    return await checkpoint(claimed, "submitting", { result: { ...result, backgroundFill: { ...claimed.result.backgroundFill, stage: "queued", requestId: receipt.request_id } } }) || current(job);
  }
  if (fill.stage === "submitting") {
    return Date.now() - fill.startedAt >= uncertainMs ? failed(job) : job;
  }
  if (fill.stage !== "queued") throw new Error("Unknown background fill stage");
  try {
    const status = await fal.queue.status(GUIDED_BACKGROUND_MODEL, { requestId: fill.requestId, logs: false });
    if (status.status !== "COMPLETED") return Date.now() - fill.startedAt >= 5 * 60_000 ? failed(job) : job;
    return await saveFilledBackground(project, job, fill, result, { readAsset, uploadToR2, prefix });
  } catch (error) {
    if ([400, 404, 422].includes(error.status) || error.name === "ValidationError") return failed(job, error.designExtractError ? error.message : failure);
    throw error;
  }
}
