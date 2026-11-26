import sharp from "sharp";
import { fal } from "@fal-ai/client";
import { adminSupabase as db } from "@/lib/supabase";
import { submitEnhancement, ENHANCE_MODEL, LEGACY_ENHANCE_MODEL, TOPAZ_ENHANCE_MODEL } from "./enhancementProvider";
import { layerAsset } from "@/lib/designExtractVariants";
import { designProviderInput } from "./storage";
import { fenceDesignJob } from "./processing/fence";
import { DESIGN_IMAGE_MAX_PIXELS, validateDesignImage } from "@/lib/designExtractImagePolicy";
import { recraftUpscalePlan, recraftResultPlan } from "@/lib/designExtractUpscalePolicy";

export { ENHANCE_MODEL };
const MAX_PIXELS = DESIGN_IMAGE_MAX_PIXELS;
const MAX_EDGE = 8192;
const SUBMISSION_GRACE_MS = 120_000;
const terminal = item => ["done", "failed", "uncertain", "skipped"].includes(item.status);

export function enhancementPlan(width, height, model = ENHANCE_MODEL) {
  if (model === ENHANCE_MODEL) return recraftUpscalePlan(width, height);
  if (![width, height].every(value => Number.isSafeInteger(value) && value > 0)) return null;
  const scale = Math.min(4, Math.floor(MAX_EDGE / Math.max(width, height)), Math.floor(Math.sqrt(MAX_PIXELS / (width * height))));
  // Topaz Transparent always produces 4x, even if a smaller factor is requested.
  // Skip before billing if that actual output would exceed our image budget.
  if (model !== LEGACY_ENHANCE_MODEL && scale !== 4) return null;
  return scale >= 2 ? { scale, width: width * scale, height: height * scale } : null;
}

// RGB enhancement and silhouette are separate. Never trust provider output alpha.
export async function restoreEnhancedAlpha(source, enhanced, plan) {
  const original = sharp(source, { limitInputPixels: MAX_PIXELS });
  const metadata = await original.metadata();
  validateDesignImage(metadata);
  if (metadata.width !== (plan.sourceWidth ?? plan.width / plan.scale) || metadata.height !== (plan.sourceHeight ?? plan.height / plan.scale)) throw new Error("Invalid enhancement source dimensions");
  const output = sharp(enhanced, { limitInputPixels: MAX_PIXELS });
  const size = await output.metadata();
  validateDesignImage(size);
  if (size.width !== plan.width || size.height !== plan.height) throw new Error("Enhancement returned unexpected dimensions");
  if (!metadata.hasAlpha) return output.toColourspace("srgb").removeAlpha().png().toBuffer();
  const alpha = await original.extractChannel(3).resize(plan.width, plan.height, { kernel: "lanczos3" }).greyscale().raw().toBuffer();
  // Materialize RGB first: sharp applies removeAlpha after joinChannel when
  // they share a pipeline, which would strip the newly restored mask again.
  const rgb = await output.removeAlpha().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
  return sharp(rgb.data, { raw: rgb.info }).joinChannel(alpha, { raw: { width: plan.width, height: plan.height, channels: 1 } }).png().toBuffer();
}

export function enhancedLayer(layer, url, plan, model = ENHANCE_MODEL) {
  const frame = layer.nativeFrame;
  const scaleX = plan.width / layer.width, scaleY = plan.height / layer.height;
  const enhanced = { ...layer, url, width: plan.width, height: plan.height,
    composition: { ...layer.composition, scale: layer.composition.scale / plan.scale },
    layout: { ...layer.layout, scale: layer.layout.scale / plan.scale },
    ...(frame && { nativeFrame: { width: Math.round(frame.width * scaleX), height: Math.round(frame.height * scaleY), left: Math.round(frame.left * scaleX), top: Math.round(frame.top * scaleY) } }),
    enhancement: { model, scale: plan.scale, sourceWidth: layer.width, sourceHeight: layer.height },
  };
  return { ...enhanced, baseVariant: layerAsset(layer), enhancedVariant: layerAsset(enhanced), acceptedVersion: "enhanced" };
}

export function enhancementResult(result) {
  const skipped = result.layers.filter(layer => !enhancementPlan(layer.width, layer.height)).map(layer => `${layer.name}: Enlargement exceeds safe output limits. The original extracted layer was kept.`);
  return { ...result, warnings: [...new Set([...(result.warnings || []), ...skipped])], enhancement: { version: 1, model: ENHANCE_MODEL, revision: 0, items: result.layers.map(layer => {
    const plan = enhancementPlan(layer.width, layer.height);
    return { layerId: layer.id, status: plan ? "pending" : "skipped", plan };
  }) } };
}

// JSON revision compare-and-swap gives browser/cron pollers a single submission
// owner without schema changes. A lost submission receipt is NEVER resubmitted.
async function checkpoint(job, result, status = "saving") {
  const saved = await fenceDesignJob(db.from("design_extract_jobs").update({ result, status, updated_at: new Date().toISOString() }), job)
    .eq("id", job.id).eq("project_id", job.project_id).eq("status", "saving")
    .eq("result->enhancement->>revision", String(job.result.enhancement.revision)).select().maybeSingle();
  if (saved.error) throw saved.error;
  return saved.data;
}
const revise = (job, items, other = {}) => ({ ...job.result, ...other, enhancement: { ...job.result.enhancement, revision: job.result.enhancement.revision + 1, items } });
async function current(job) {
  const read = await db.from("design_extract_jobs").select("*").eq("id", job.id).eq("project_id", job.project_id).single();
  if (read.error) throw read.error;
  return read.data;
}
async function fallback(job, index, status, message) {
  const items = job.result.enhancement.items.map((item, i) => i === index ? { ...item, status } : item);
  const layer = job.result.layers[index];
  const result = revise(job, items, { warnings: [...new Set([...(job.result.warnings || []), `${layer.name}: ${message} The original extracted layer was kept.`])] });
  return await checkpoint(job, result) || current(job);
}

export async function advanceEnhancement(project, job, { readAsset, uploadToR2, prefix }) {
  const { items } = job.result.enhancement;
  const checkpointModel = job.result.enhancement.model;
  if (![ENHANCE_MODEL, TOPAZ_ENHANCE_MODEL, LEGACY_ENHANCE_MODEL].includes(checkpointModel)) throw new Error("Unknown enhancement model checkpoint");
  const index = items.findIndex(item => !terminal(item));
  if (index < 0) return await checkpoint(job, revise(job, items), "ready") || current(job);
  const item = items[index], layer = job.result.layers[index];
  const model = item.model || checkpointModel;
  if (![ENHANCE_MODEL, TOPAZ_ENHANCE_MODEL, LEGACY_ENHANCE_MODEL].includes(model)) throw new Error("Unknown layer enhancement model checkpoint");
  if (!layer || item.layerId !== layer.id || !item.plan) throw new Error("Invalid enhancement checkpoint");
  // Never start another Topaz charge. Already-submitted receipts keep their
  // original provider; only untouched pending layers move to direct Recraft.
  if (item.status === "pending" && model === TOPAZ_ENHANCE_MODEL) {
    if (item.requestId || item.outputUrl || item.startedAt) return fallback(job, index, "uncertain", "A previous enhancement may already have been submitted; it was not repeated.");
    const plan = enhancementPlan(layer.width, layer.height, ENHANCE_MODEL);
    if (!plan) return fallback(job, index, "skipped", "This layer exceeds Recraft's supported upscale limits.");
    const next = items.map((entry, i) => i === index ? { ...entry, model: ENHANCE_MODEL, plan } : entry);
    return await checkpoint(job, revise(job, next)) || current(job);
  }
  if (item.status === "submitting") {
    if (Date.now() - Date.parse(item.startedAt) < SUBMISSION_GRACE_MS) return job;
    return fallback(job, index, "uncertain", "Enhancement submission could not be confirmed; it was not submitted again.");
  }
  if (item.status === "pending") {
    const next = items.map((entry, i) => i === index ? { ...entry, status: "submitting", startedAt: new Date().toISOString() } : entry);
    const claimed = await checkpoint(job, revise(job, next));
    if (!claimed) return current(job);
    let receipt;
    try {
      const source = await readAsset(layer.url);
      // Topaz receives RGBA so it can handle transparent edges. Existing ESRGAN
      // checkpoints retain their original RGB input and request schema.
      const inputImage = sharp(source, { limitInputPixels: MAX_PIXELS });
      const bytes = await (model === TOPAZ_ENHANCE_MODEL ? inputImage.ensureAlpha() : inputImage.removeAlpha()).png().toBuffer();
      const inputUrl = await uploadToR2(bytes, `${prefix(project)}${job.id}/enhance-input-${index}.png`, "image/png");
      const input = model === LEGACY_ENHANCE_MODEL
        ? { image_url: inputUrl, scale: item.plan.scale, model: "RealESRGAN_x4plus", face: false, output_format: "png" }
        : { image_url: inputUrl, output_format: "png" };
      receipt = await submitEnhancement(await designProviderInput(input), model);
    } catch (error) {
      console.warn("[Design Extract] Enhancement submission not completed", { jobId: job.id, layerId: layer.id, status: error.status });
      return fallback(claimed, index, "uncertain", "Enhancement could not be confirmed; it was not submitted again.");
    }
    if (!receipt?.request_id && !receipt?.image_url) return fallback(claimed, index, "uncertain", "Enhancement did not return a request receipt; it was not submitted again.");
    const queued = claimed.result.enhancement.items.map((entry, i) => i === index ? { ...entry, status: "queued", ...(receipt.image_url?{outputUrl:receipt.image_url,units:receipt.units}:{requestId: receipt.request_id}) } : entry);
    // Leave the durable submitting claim intact if persistence fails here.
    return await checkpoint(claimed, revise(claimed, queued)) || current(job);
  }
  if (item.status !== "queued" || !(model===ENHANCE_MODEL?item.outputUrl:item.requestId)) throw new Error("Invalid enhancement request receipt");
  if (Date.now() - Date.parse(item.startedAt) > 20 * 60_000) return fallback(job, index, "failed", "Enhancement took too long to finish; no replacement request was submitted.");
  try {
    const status = model===ENHANCE_MODEL?{status:'COMPLETED'}:await fal.queue.status(model, { requestId: item.requestId, logs: false });
    if (status.status !== "COMPLETED") return job;
    const { data } = model===ENHANCE_MODEL?{data:{image:{url:item.outputUrl}}}:await fal.queue.result(model, { requestId: item.requestId });
    if (!data.image?.url) return fallback(job, index, "failed", "Enhancement returned no usable image.");
    const [source, output] = await Promise.all([readAsset(layer.url), readAsset(data.image.url, true)]);
    let png, plan = item.plan;
    try {
      if (model === ENHANCE_MODEL) {
        const { width, height } = await sharp(output, { limitInputPixels: MAX_PIXELS }).metadata();
        plan = recraftResultPlan(layer.width, layer.height, width, height);
        if (!plan) throw new Error("Invalid Recraft output dimensions");
      }
      png = await restoreEnhancedAlpha(source, output, plan);
    }
    catch { return fallback(job, index, "failed", "Enhancement could not preserve the element dimensions and transparency."); }
    const url = await uploadToR2(png, `${prefix(project)}${job.id}/enhanced-${index}.png`, "image/png");
    const layers = job.result.layers.map((entry, i) => i === index ? enhancedLayer(entry, url, plan, model) : entry);
    const done = items.map((entry, i) => i === index ? { ...entry, status: "done" } : entry);
    return await checkpoint(job, revise(job, done, { layers })) || current(job);
  } catch (error) {
    if ([400, 404, 422].includes(error.status) || error.name === "ValidationError") return fallback(job, index, "failed", "The enhancement provider could not process this element.");
    // Retry polling/download/storage for this known receipt, never generation.
    throw error;
  }
}
