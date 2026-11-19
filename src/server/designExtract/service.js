import sharp from "sharp";
import { fal } from "@fal-ai/client";
import { randomUUID, createHash } from "node:crypto";
import { adminSupabase as db } from "@/lib/supabase";
import { uploadDesignAsset as uploadToR2, deleteDesignPrefix as deleteR2Prefix, privateDesignKey, privateDesignBucket, requirePrivateDesignStorage, ownsPrivateDesignAsset, readPrivateDesignAsset, designProviderInput } from "./storage";
import { fetchWithSSRFProtection, getAllowedProviderHosts, getAllowedStorageHosts, isOwnedStorageUrl } from "@/lib/ssrf";
import { emptyManifest, acceptLayers, validateEdits, MAX_LAYERS, LAYER_MODEL, LEGACY_LAYER_MODEL, SEGMENT_MODEL, LEGACY_SEGMENT_MODEL, DESIGN_OPERATION_DEADLINE_MS } from "@/lib/designExtract";
import { designRateLimit as enforceRateLimit } from "./rateLimit";
import { DESIGN_IMAGE_MAX_PIXELS, DESIGN_ASSET_MAX_BYTES, DESIGN_UPLOAD_MAX_BYTES, validateDesignImage } from "@/lib/designExtractImagePolicy";
import { applySourceMask } from "./sourceMask";
import { separateElements } from "./separateElements";
import { automaticCutouts } from "./automaticCutouts";
import { advanceEnhancement, enhancementResult } from "./enhancement";
import { maskAsset, selectVariant } from "@/lib/designExtractVariants";
import { renderMask, maskedLayer } from "./mask";
import { arrangeOverview } from "@/lib/designExtractLayout";
import { submitDesignOperation } from "./submission";
import { designBillingMode, designBillingQuote, claimPaidDesignOperation, settleDesignBilling, heldDesignJobs } from "./billing";
import { designProcessingDriver } from "./processing/config";
import { fenceDesignJob } from "./processing/fence";
import { withDesignImageWork } from "./imageWork";
import { DESIGN_EXTRACT_PRICE_VERSION, designExtractPrice } from "@/lib/designExtractPricing";

// Qwen's positive prompt is an image caption, not per-layer instructions.
// Leave it omitted so the provider can caption each actual source image. A
// generic garment/logo caption would invent content for unrelated designs.
// Negative conditioning targets reconstruction defects without excluding valid
// artwork elements (such as text, gradients, white backgrounds or textures).
const _LAYER_NEGATIVE_PROMPT = [
  "misspelled or altered lettering, changed numbers, deformed logos",
  "shifted geometry, stretched shapes, warped outlines, misaligned elements",
  "changed colors, color bleeding, lost fine details, blurred edges",
  "jagged cutout edges, opaque halos, stray pixels, compression artifacts",
  "duplicated motifs, added objects, new text, added watermarks",
].join(", ");

export const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status, designExtractError: true }); };
function checked(result) { if (result.error) throw result.error; return result.data; }
const updateJob = (job, values) => fenceDesignJob(db.from("design_extract_jobs").update(values).eq("id", job.id), job);
export const prefix = project => `users/${project.user_id}/design-extract/${project.id}/`;
export async function readAsset(url, provider = false, { upload = false } = {}) {
  const maxBytes = upload ? DESIGN_UPLOAD_MAX_BYTES : DESIGN_ASSET_MAX_BYTES;
  if (!provider && privateDesignKey(url)) return readPrivateDesignAsset(url, maxBytes);
  const { buffer } = await fetchWithSSRFProtection(url, { allowedHosts: provider ? getAllowedProviderHosts() : getAllowedStorageHosts(), maxBytes, allowedContentTypes: ["image/"] });
  return buffer;
}
export async function ownedProject(id, userId) {
  const project = checked(await db.from("design_extract_projects").select("*").eq("id", id).eq("user_id", userId).maybeSingle());
  if (!project || !Number.isFinite(Date.parse(project.expires_at)) || Date.parse(project.expires_at) <= Date.now()) fail("Project not found or expired", 404);
  return project;
}
export async function createProject(userId, sourceUrl, sourceProjectId) {
  return withDesignImageWork(() => createProjectImage(userId, sourceUrl, sourceProjectId));
}
async function createProjectImage(userId, sourceUrl, sourceProjectId) {
  if (sourceProjectId) {
    const source = checked(await db.from("projects").select("generated_image_url").eq("id", sourceProjectId).eq("user_id", userId).maybeSingle());
    if (!source?.generated_image_url || source.generated_image_url === "REFUNDED") fail("Flat result not found", 404);
    sourceUrl = source.generated_image_url;
  }
  if (!ownsPrivateDesignAsset(sourceUrl, userId) && !isOwnedStorageUrl(sourceUrl, { userId, projectId: sourceProjectId })) fail("Unauthorized source image");
  requirePrivateDesignStorage();
  const staged = privateDesignKey(sourceUrl)?.startsWith("staging/");
  const bytes = await readAsset(sourceUrl, false, { upload: Boolean(staged || !sourceProjectId && !privateDesignKey(sourceUrl)) });
  const meta = await sharp(bytes, { limitInputPixels: DESIGN_IMAGE_MAX_PIXELS }).metadata();
  if (!["png", "jpeg", "webp"].includes(meta.format)) fail("Use PNG, JPG or WebP");
  validateDesignImage(meta);
  const id = randomUUID();
  const project = { id, user_id: userId };
  const normalized = await sharp(bytes, { limitInputPixels: DESIGN_IMAGE_MAX_PIXELS }).rotate().png().toBuffer({ resolveWithObject: true });
  if (normalized.data.length > DESIGN_ASSET_MAX_BYTES) fail("The normalized artwork exceeds safe processing limits.", 413);
  // Record the prefix first so interrupted uploads are still covered by TTL cleanup.
  checked(await db.from("design_extract_projects").insert({ ...project, source_url: sourceUrl, manifest: emptyManifest(normalized.info.width, normalized.info.height) }));
  const url = await uploadToR2(normalized.data, `${prefix(project)}source.png`, "image/png");
  return checked(await db.from("design_extract_projects").update({ source_url: url }).eq("id", id).select().single());
}
export async function saveManifest(project, layers, revision) {
  if (revision !== project.revision) fail("Project changed. Reload before saving.", 409);
  let manifest;
  try { manifest = validateEdits({ layers }, project.manifest); } catch (error) { fail(error.message); }
  const saved = checked(await db.from("design_extract_projects").update({ manifest, revision: revision + 1, updated_at: new Date().toISOString() }).eq("id", project.id).eq("revision", revision).select().maybeSingle());
  if (!saved) fail("Project changed. Reload before saving.", 409);
  return saved;
}
export async function renameDesignProject(project, name) {
  if (typeof name !== "string" || !name.trim() || name.length > 100) fail("Use a project name of 1–100 characters");
  const manifest = { ...project.manifest, name: name.trim() };
  const saved = checked(await db.from("design_extract_projects").update({ manifest, revision: project.revision + 1, updated_at: new Date().toISOString() }).eq("id", project.id).eq("revision", project.revision).select().maybeSingle());
  if (!saved) fail("Project changed. Reload before renaming.", 409);
  return saved;
}
export async function deleteDesignProject(project) {
  // Expire under the project row lock first. The operation-claim trigger then
  // prevents new submissions while storage is being deleted.
  const claimed = checked(await db.from("design_extract_projects").update({ expires_at: new Date().toISOString() }).eq("id", project.id).eq("revision", project.revision).select().maybeSingle());
  if (!claimed) fail("Project changed. Reload before deleting.", 409);
  try {
    const active = checked(await db.from("design_extract_jobs").select("id").eq("project_id", project.id).in("status", ["submitting", "queued", "processing", "saving"]).limit(1));
    if (active.length) fail("Wait for the active extraction to finish before deleting this project.", 409);
    for (const job of await heldDesignJobs(project.id)) {
      const settled = await settleDesignBilling(job);
      if (settled.billing_state === "held") fail("Billing is still being confirmed. Resume checking before deleting this project.", 409);
    }
    await deleteR2Prefix(prefix(project), { allowedPrefixes: [prefix(project)] });
    checked(await db.from("design_extract_projects").delete().eq("id", project.id).eq("user_id", project.user_id));
  } catch (error) {
    checked(await db.from("design_extract_projects").update({ expires_at: project.expires_at }).eq("id", project.id));
    throw error;
  }
}
export async function startOperation(project, body) {
  const { kind, layerId, idempotencyKey } = body;
  if (!["extract", "split", "segment"].includes(kind) || typeof idempotencyKey !== "string" || !/^[\w-]{8,120}$/.test(idempotencyKey)) fail("Invalid operation");
  const existing = checked(await db.from("design_extract_jobs").select("*").eq("project_id", project.id).eq("idempotency_key", idempotencyKey).maybeSingle());
  if (existing) {
    if (existing.kind !== kind || (existing.layer_id || null) !== (layerId || null)) fail("This request key belongs to a different operation", 409);
    return existing;
  }
  if (!process.env.FAL_KEY) fail("AI processing is not configured", 503);
  const limit = await enforceRateLimit({ namespace: "design-extract:ai", identifier: project.user_id, max: 6, window: "60 s", windowMs: 60000 });
  if (!limit.success) fail("Too many AI operations. Try again shortly.", 429);
  const layer = project.manifest.layers.find(item => item.id === layerId);
  if(layer?.kind==='svg')fail('Select a raster layer for AI extraction.');
  if(layer?.kind==='svg')fail('Choose a raster layer for extraction.');
  if (kind === "split" && !layer || kind === "segment" && layerId && !layer) fail("Select a valid layer");
  if (kind === "extract" && project.manifest.layers.length) fail("Use Split further on an existing layer");
  const availableLayers = MAX_LAYERS - project.manifest.layers.length + (kind === "split" ? 1 : 0);
  if (availableLayers < (kind === "segment" ? 1 : 2)) fail("Make room for extracted layers. Maximum 32 layers.");
  const input = kind === "segment" ? { image_url: layer?.url || project.source_url, apply_mask: false, output_format: "png" } : { image_url: layer?.url || project.source_url, output_format: "png", points_per_side: 32, pred_iou_thresh: .88, stability_score_thresh: .95, min_mask_region_area: 100 };
  if (kind === "segment") {
    const points = body.points || (body.point ? [{ ...body.point, label: 1 }] : []);
    if (!Array.isArray(points) || !points.length || points.length > 32 || !points.some(point => point?.label === 1) || points.some(point => !point || ![0, 1].includes(point.label) || !Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.y < 0 || point.x >= (layer?.width || project.manifest.width) || point.y >= (layer?.height || project.manifest.height))) fail("Select up to 32 points inside the artwork, including at least one Include point");
    input.prompts = points.map(point => ({ x: Math.min(Math.round(point.x), (layer?.width || project.manifest.width) - 1), y: Math.min(Math.round(point.y), (layer?.height || project.manifest.height) - 1), label: point.label }));
  }
  const model = kind === "segment" ? SEGMENT_MODEL : LAYER_MODEL;
  // Upscaling is an explicit layer action. Historical jobs retain their saved
  // enhancement setting; new reconstruction requests incur no automatic upscale.
  const record = { project_id: project.id, user_id: project.user_id, base_revision: project.revision, idempotency_key: idempotencyKey, kind, layer_id: layerId || null, input: kind === "segment" ? input : { ...input, _desaynclaw: { enhanceLayers: 0, maskExtraction: 1 } }, model };
  if (designBillingMode() === "paid" && (body.priceVersion !== DESIGN_EXTRACT_PRICE_VERSION || body.acknowledgedClaws !== designExtractPrice(kind))) fail("Pricing changed. Refresh the workspace to review the current Claw price.", 409);
  requirePrivateDesignStorage();
  const processor = designProcessingDriver();
  if (processor === "workflow") record.processor = processor;
  if (!ownsPrivateDesignAsset(input.image_url, project.user_id)) {
    if (!isOwnedStorageUrl(input.image_url, { userId: project.user_id, projectId: project.id })) fail("Unauthorized operation source", 403);
    input.image_url = await withDesignImageWork(async () => {
      const source = await readAsset(input.image_url);
      const image = sharp(source, { limitInputPixels: DESIGN_IMAGE_MAX_PIXELS });
      validateDesignImage(await image.metadata());
      const bytes = await image.png().toBuffer();
      if (bytes.length > DESIGN_ASSET_MAX_BYTES) fail("The operation source exceeds safe processing limits.", 413);
      const digest = createHash("sha256").update(input.image_url).digest("hex");
      return uploadToR2(bytes, `${prefix(project)}inputs/${digest}.png`, "image/png");
    });
    record.input.image_url = input.image_url;
  }
  let job;
  let creditsRemaining;
  if (designBillingMode() === "paid") {
    if (!privateDesignBucket() || !ownsPrivateDesignAsset(input.image_url, project.user_id)) fail("Re-upload this artwork into private Design Extract storage before generating.", 503);
    const reservation = await claimPaidDesignOperation(project, record);
    job = reservation.job;
    creditsRemaining = reservation.creditsRemaining;
    if (!reservation.dispatch) return job;
  } else {
    const claim = await db.from("design_extract_jobs").insert(record).select().single();
    if (claim.error?.code === "23505") fail("Another operation is active or awaiting review", 409);
    job = { ...record, ...checked(claim) };
  }
  if (job.processor === "workflow") {
    const { wakeDesignWorkflow } = await import("./processing/launcher");
    await wakeDesignWorkflow(job);
    return Number.isInteger(creditsRemaining) ? { ...job, creditsRemaining } : job;
  }
  const dispatched = job.billing_state === "held" && job.charge_amount > 0
    ? await dispatchReservedOperation(project, job)
    : await sendRecordedOperation(job, await designProviderInput(input));
  return Number.isInteger(creditsRemaining) ? { ...dispatched, creditsRemaining } : dispatched;
}
export function awaitingDesignDispatch(job) {
  return job?.status === "submitting" && (job.billing_state === "held" && job.charge_amount > 0 || job.processor === "workflow") && !job.dispatch_started_at && !job.request_id;
}
async function dispatchReservedOperation(project, job) {
  if (!awaitingDesignDispatch(job)) return job;
  if (job.user_id !== project.user_id || job.project_id !== project.id || job.base_revision !== project.revision || Date.parse(project.expires_at) <= Date.now()) fail("Project changed before dispatch. Reload before continuing.", 409);
  if (![LAYER_MODEL, LEGACY_LAYER_MODEL, SEGMENT_MODEL, LEGACY_SEGMENT_MODEL].includes(job.model) || !ownsPrivateDesignAsset(job.input?.image_url, project.user_id)) fail("Private extraction input unavailable", 503);
  // Resolve the temporary link before claiming dispatch: signing failures cannot
  // have reached the provider. Once claimed, an uncertain POST is never repeated.
  const { _desaynclaw: _settings, ...input } = job.input;
  const providerInput = await designProviderInput(input);
  const claimed = checked(await updateJob(job, { dispatch_started_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("user_id", project.user_id).eq("status", "submitting").eq("billing_state", job.billing_state).is("dispatch_started_at", null).select().maybeSingle());
  if (!claimed) return checked(await db.from("design_extract_jobs").select("*").eq("id", job.id).eq("user_id", project.user_id).single());
  return sendRecordedOperation(claimed, providerInput);
}
async function sendRecordedOperation(job, providerInput) {
  try {
    const { request_id } = await submitDesignOperation(job.model, { input: providerInput });
    // A failed persistence after submission must never trigger another submission.
    const queued = checked(await updateJob(job, { request_id, status: "queued", updated_at: new Date().toISOString() }).select().single());
    return queued;
  } catch (error) {
    if (error.status === 422 || error.name === "ValidationError") {
      checked(await updateJob(job, { status: "failed", error: "Provider rejected this request", updated_at: new Date().toISOString() }).eq("status", "submitting"));
      await settleDesignBilling({ ...job, status: "failed" });
      fail("Provider rejected this request. Your existing layers are unchanged.", 422);
    }
    console.error("[Design Extract] Submission uncertain", { jobId: job.id, status: error.status || null });
    // Leave the claim in submitting. Admin must reconcile it against provider history.
    fail("Submission outcome uncertain. Check fal history before retrying this operation.", 503);
  }
}
export async function settleOperation(project, job) {
  return withDesignImageWork(async () => {
    // The legacy processor needs the same finite deadline as durable workflows.
    // Uncertain submissions remain reserved for explicit reconciliation.
    const created = Date.parse(job.created_at);
    if (job.processor !== "workflow" && Number.isFinite(created) && Date.now() - created >= DESIGN_OPERATION_DEADLINE_MS && (awaitingDesignDispatch(job) || ["queued", "processing", "saving"].includes(job.status))) {
      const usable = Boolean(job.result?.layers?.length);
      const values = { status: usable ? "ready" : "failed", error: usable ? null : "No usable layers were saved before the processing deadline", updated_at: new Date().toISOString(), ...(usable && { result: { ...job.result, warnings: [...new Set([...(job.result.warnings || []), "Processing reached its time limit. Available saved layers were kept."])] } }) };
      const expired = checked(await updateJob(job, values).eq("status", job.status).select().maybeSingle());
      const current = expired || checked(await db.from("design_extract_jobs").select("*").eq("id", job.id).eq("user_id", project.user_id).single());
      return settleDesignBilling(current);
    }
    if (awaitingDesignDispatch(job)) return settleDesignBilling(await dispatchReservedOperation(project, job));
    return settleDesignBilling(await advanceOperation(project, job));
  });
}
async function advanceOperation(project, job) {
  if (!["queued", "processing", "saving"].includes(job.status) || !job.request_id) return job;
  if (job.status === "saving" && job.result?.enhancement?.version === 1) return advanceEnhancement(project, job, { readAsset, uploadToR2, prefix });
  try {
    const status = await fal.queue.status(job.model, { requestId: job.request_id, logs: false });
    if (status.status !== "COMPLETED") {
      const next = status.status === "IN_PROGRESS" ? "processing" : "queued";
      checked(await updateJob(job, { status: next, updated_at: new Date().toISOString() }).in("status", ["queued", "processing"]));
      return { ...job, status: next, queuePosition: status.queue_position };
    }
    if (job.status !== "saving") {
      checked(await updateJob(job, { status: "saving", updated_at: new Date().toISOString() }).in("status", ["queued", "processing"]));
      // Expose the saving stage and settle assets on the next poll (or cron run).
      return { ...job, status: "saving" };
    }
    const { data } = await fal.queue.result(job.model, { requestId: job.request_id });
    if (data.has_nsfw_concepts?.some(Boolean)) fail("The provider could not process this design", 422);
    const automaticMasks = job.model === LAYER_MODEL;
    const images = job.kind === "segment" ? (data.image?.url ? [data.image] : data.masks?.slice(0, 1)) : automaticMasks ? data.individual_masks : data.images;
    if (!Array.isArray(images) || !images.length || !automaticMasks && images.length > 4) fail("Provider returned no usable layers", 422);
    const parent = project.manifest.layers.find(layer => layer.id === job.layer_id);
    const sourcePixels = automaticMasks || job.kind === "segment" && job.input?.apply_mask === false ? await readAsset(job.input.image_url) : null;
    const layers = [];
    const warnings = new Set();
    let nativeWidth, nativeHeight;
    const capacity = MAX_LAYERS - project.manifest.layers.length + (job.kind === "split" ? 1 : 0);
    const outputs = automaticMasks ? automaticCutouts(sourcePixels, images, { readMask: url => readAsset(url, true), limit: capacity, warnings }) : images.map((image, index) => ({ image, index }));
    for await (const output of outputs) {
      const { index } = output;
      let bytes = output.bytes || await readAsset(output.image.url, true);
      if (sourcePixels && !automaticMasks) bytes = await applySourceMask(sourcePixels, bytes);
      const metadata = await sharp(bytes, { limitInputPixels: DESIGN_IMAGE_MAX_PIXELS }).metadata();
      validateDesignImage(metadata);
      if (!metadata.hasAlpha) fail("The AI returned a layer without transparency. Your original artwork is unchanged.", 422);
      const { data: pixels, info } = await sharp(bytes, { limitInputPixels: DESIGN_IMAGE_MAX_PIXELS }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      if (index === 0) { nativeWidth = info.width; nativeHeight = info.height; }
      const automaticParts = !automaticMasks && job.kind !== "segment" && job.input?._desaynclaw?.separateElements === 1;
      const partLimit = automaticParts ? Math.max(1, Math.min(8, capacity - layers.length - (images.length - index - 1))) : 1;
      let partIndex = 0;
      for (const part of separateElements(pixels, info.width, info.height, partLimit)) {
        const { left, top, width, height } = part.bounds;
        if (width < 1 || height < 1) continue;
        const partImage = part.separated ? sharp(part.data, { raw: { width, height, channels: 4 } }) : sharp(pixels, { raw: info }).extract(part.bounds);
        const trimmed = await partImage.png().toBuffer();
        const assetId = automaticParts ? `${index}-${partIndex++}` : String(index);
        const url = await uploadToR2(trimmed, `${prefix(project)}${job.id}/${assetId}.png`, "image/png");
        const full = part.separated ? await sharp(trimmed).extend({ left, top, right: info.width - left - width, bottom: info.height - top - height, background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer() : bytes;
        const maskBaseUrl = await uploadToR2(full, `${prefix(project)}${job.id}/base-${assetId}.png`, "image/png");
        const sx = (parent?.width || project.manifest.width) / info.width;
        const sy = (parent?.height || project.manifest.height) / info.height;
        // Keep native output pixels; preserve original canvas alignment through scale.
        // Model output sizes can differ from the source. Preserve native pixels and
        // use a uniform contain scale; ask for review instead of discarding valid layers.
        if (Math.abs(sx - sy) / Math.max(sx, sy) > .03) warnings.add("The AI output has a different aspect ratio from your source. Layers are centered without stretching. Check their alignment before accepting.");
        const scale = Math.min(sx, sy);
        const offsetX = ((parent?.width || project.manifest.width) - info.width * scale) / 2;
        const offsetY = ((parent?.height || project.manifest.height) - info.height * scale) / 2;
        const placement = parent?.composition || { x: 0, y: 0, scale: 1 };
        const composition = { x: placement.x + (offsetX + left * scale) * placement.scale, y: placement.y + (offsetY + top * scale) * placement.scale, scale: scale * placement.scale };
        layers.push({ id: `${job.id}-${assetId}`, url, maskBaseUrl, maskSourceUrl: sourcePixels && !automaticMasks ? job.input.image_url : maskBaseUrl, name: automaticMasks ? output.name : sourcePixels ? "Original artwork cutout" : automaticParts ? `Element ${layers.length + 1}` : `Layer ${index + 1}`, extractionMethod: sourcePixels ? "source-pixels" : "ai-reconstruction", width, height, nativeFrame: { width: info.width, height: info.height, left, top }, visible: true, locked: false, composition, layout: { x: 300 + index % 4 * 260, y: Math.floor(index / 4) * 300, scale: Math.min(220 / width, 250 / height, 1) } });
      }
    }
    if (!layers.length) fail("No visible elements returned", 422);
    const result = { layers: arrangeOverview(layers, project.manifest), nativeWidth, nativeHeight, warnings: [...warnings] };
    if (job.kind !== "segment" && job.input?._desaynclaw?.enhanceLayers === 1) {
      // Persist all unenhanced candidates before any paid enhancement call.
      const initialized = await updateJob(job, { result: enhancementResult(result), updated_at: new Date().toISOString() })
        .eq("status", "saving").is("result", null).select().maybeSingle();
      if (initialized.error) throw initialized.error;
      if (initialized.data) return initialized.data;
      return checked(await db.from("design_extract_jobs").select("*").eq("id", job.id).single());
    }
    const ready = checked(await updateJob(job, { status: "ready", result, updated_at: new Date().toISOString() }).in("status", ["queued", "processing", "saving"]).select().maybeSingle());
    console.info("[Design Extract] Provider operation", { jobId: job.id, model: job.model, requestId: job.request_id, outputCount: layers.length, durationMs: Date.now() - Date.parse(job.created_at) });
    return ready || checked(await db.from("design_extract_jobs").select("*").eq("id", job.id).single());
  } catch (error) {
    if (error.status === 422 || error.name === "ValidationError") {
      const message = error.designExtractError ? error.message : "The AI provider could not complete this extraction. Your original artwork is unchanged.";
      console.warn("[Design Extract] Output validation failed", { jobId: job.id, requestId: job.request_id, reason: message });
      return checked(await updateJob(job, { status: "failed", error: message, updated_at: new Date().toISOString() }).in("status", ["queued", "processing", "saving"]).select().single());
    }
    throw error;
  }
}
export async function recoverOperation(project, jobId) {
  const job = checked(await db.from("design_extract_jobs").select("*").eq("id", jobId).eq("project_id", project.id).eq("user_id", project.user_id).eq("status", "failed").maybeSingle());
  if (job?.billing_state === "refunded") fail("This operation was refunded. Start a new extraction to continue.", 409);
  if (!job?.request_id) fail("No existing provider result is available to recover.", 404);
  if (job.base_revision !== project.revision) fail("This project changed after extraction. Reload and review the current project before continuing.", 409);
  const status = await fal.queue.status(job.model, { requestId: job.request_id, logs: false });
  if (status.status !== "COMPLETED") fail("The existing provider result is not ready to recover. No new generation was submitted.", 409);
  const resumed = await db.from("design_extract_jobs").update({ status: "saving", error: null, updated_at: new Date().toISOString() }).eq("id", job.id).eq("status", "failed").select().maybeSingle();
  if (resumed.error?.code === "23505") fail("Another extraction is active or awaiting review. Finish it before recovering this result.", 409);
  const current = checked(resumed);
  if (!current) fail("This extraction changed. Reload before continuing.", 409);
  return settleOperation(project, current);
}
export async function snapshot(project, advance = false) {
  const jobs = checked(await db.from("design_extract_jobs").select("*").eq("project_id", project.id).order("created_at", { ascending: false }).limit(1));
  const job = jobs[0] ? advance && jobs[0].processor !== "workflow" ? await settleOperation(project, jobs[0]) : jobs[0] : null;
  if (advance && job?.processor !== "workflow" && job?.status === "ready" && job.kind === "extract") {
    if (project.revision !== job.base_revision) fail("Project changed. Reload before saving extracted layers.", 409);
    try { await reviewOperation(project, job.id, true); }
    catch (error) {
      // Concurrent pollers may finish the same atomic settlement first.
      const current = await snapshot(await ownedProject(project.id, project.user_id));
      if (current.job?.id === job.id && current.job.status === "accepted") return current;
      throw error;
    }
    return snapshot(await ownedProject(project.id, project.user_id));
  }
  return { project, job, billing: await designBillingQuote(project.user_id) };
}
export async function reconcileSubmission(project, jobId, requestId) {
  if (typeof requestId !== "string" || !/^[a-zA-Z0-9-]{10,100}$/.test(requestId)) fail("Enter the request ID from fal history");
  const job = checked(await db.from("design_extract_jobs").select("*").eq("project_id", project.id).eq("id", jobId).eq("status", "submitting").maybeSingle());
  if (!job) fail("Submission no longer needs reconciliation", 409);
  await fal.queue.status(job.model, { requestId, logs: false });
  return checked(await db.from("design_extract_jobs").update({ request_id: requestId, status: "queued", updated_at: new Date().toISOString() }).eq("id", job.id).eq("status", "submitting").select().single());
}
export async function reviewOperation(project, jobId, accept, versions = {}) {
  const job = checked(await db.from("design_extract_jobs").select("*").eq("project_id", project.id).eq("id", jobId).single());
  if (job.status !== "ready") fail("Operation is not ready for review", 409);
  // Commit project and job together; revision prevents concurrent edits or double acceptance.
  if (!versions || typeof versions !== "object" || Array.isArray(versions) || Object.entries(versions).some(([id, version]) => !job.result?.layers.some(layer => layer.id === id) || !["base", "enhanced"].includes(version))) fail("Invalid layer versions");
  const reviewed = { ...job, result: { ...job.result, layers: job.result?.layers.map(layer => selectVariant(layer, versions[layer.id])) } };
  const manifest = accept ? acceptLayers(project.manifest, reviewed) : project.manifest;
  return checked(await db.rpc("review_design_extract", { target_project: project.id, target_user: project.user_id, target_job: jobId, expected_revision: project.revision, next_manifest: manifest, accepted: accept }));
}

export async function editLayerAsset(project, body) {
  return withDesignImageWork(() => editLayerImage(project, body));
}
async function editLayerImage(project, body) {
  if (body.revision !== project.revision) fail("Project changed. Reload before editing artwork.", 409);
  const layer = project.manifest.layers.find(item => item.id === body.layerId);
  if(layer?.kind==='svg')fail('Mask and artwork-version editing require a raster layer.');
  if (!layer || layer.locked || layer.kind==='svg') fail("Select an unlocked raster layer");
  const active = checked(await db.from("design_extract_jobs").select("id").eq("project_id", project.id).in("status", ["submitting", "queued", "processing", "saving", "ready"]).limit(1));
  if (active.length) fail("Finish reviewing the extraction before editing artwork", 409);
  let next;
  if (body.action === "version") {
    const key = { base: "baseVariant", enhanced: "enhancedVariant", mask: "maskedVariant" }[body.version];
    if (!key || !layer[key]) fail("Artwork version unavailable");
    next = selectVariant(layer, body.version);
  } else {
    if (!ownsPrivateDesignAsset(body.maskUrl, project.user_id) && !isOwnedStorageUrl(body.maskUrl, { userId: project.user_id })) fail("Unauthorized mask asset", 403);
    const softness = body.softness ?? 0;
    if (!Number.isFinite(softness) || softness < 0 || softness > 20) fail("Invalid edge softness");
    const asset = maskAsset(layer);
    const [source, coverage] = await Promise.all([readAsset(asset.source), readAsset(body.maskUrl)]);
    const rendered = await renderMask(source, coverage, softness, body.edgeCleanup);
    if (rendered.width !== asset.frame.width || rendered.height !== asset.frame.height) fail("Native artwork dimensions changed", 422);
    const key = `${prefix(project)}masks/${randomUUID()}`;
    const url = await uploadToR2(rendered.trimmed, `${key}.png`, "image/png");
    const full = await uploadToR2(rendered.maskBase, `${key}-full.png`, "image/png");
    const coverageUrl = await uploadToR2(coverage, `${key}-coverage.png`, "image/png");
    next = { ...maskedLayer(layer, rendered, { url, full }), coverageUrl, edgeSoftness: softness, edgeCleanup: rendered.edgeCleanup };
    next.maskedVariant = { ...next.maskedVariant, coverageUrl, edgeSoftness: softness, edgeCleanup: rendered.edgeCleanup };
  }
  const manifest = { ...project.manifest, layers: project.manifest.layers.map(item => item.id === layer.id ? next : item) };
  const saved = checked(await db.from("design_extract_projects").update({ manifest, revision: project.revision + 1, updated_at: new Date().toISOString() }).eq("id", project.id).eq("revision", project.revision).select().maybeSingle());
  if (!saved) fail("Project changed. Reload before applying artwork changes.", 409);
  return saved;
}
