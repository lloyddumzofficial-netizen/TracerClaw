import sharp from "sharp";
import { fal } from "@fal-ai/client";
import { randomUUID } from "node:crypto";
import { adminSupabase as db } from "@/lib/supabase";
import { uploadToR2, deleteR2Prefix } from "@/lib/cloudflare";
import { fetchWithSSRFProtection, getAllowedProviderHosts, getAllowedStorageHosts, isOwnedStorageUrl } from "@/lib/ssrf";
import { emptyManifest, acceptLayers, validateEdits, MAX_LAYERS, LAYER_MODEL, SEGMENT_MODEL } from "@/lib/designExtract";
import { enforceRateLimit } from "@/lib/rateLimit";
import { DESIGN_EXTRACT_UPLOAD_MAX_BYTES } from "@/lib/uploadLimits";
import { applySourceMask } from "./sourceMask";
import { advanceEnhancement, enhancementResult } from "./enhancement";

// Qwen's positive prompt is an image caption, not per-layer instructions.
// Leave it omitted so the provider can caption each actual source image. A
// generic garment/logo caption would invent content for unrelated designs.
// Negative conditioning targets reconstruction defects without excluding valid
// artwork elements (such as text, gradients, white backgrounds or textures).
const LAYER_NEGATIVE_PROMPT = [
  "misspelled or altered lettering, changed numbers, deformed logos",
  "shifted geometry, stretched shapes, warped outlines, misaligned elements",
  "changed colors, color bleeding, lost fine details, blurred edges",
  "jagged cutout edges, opaque halos, stray pixels, compression artifacts",
  "duplicated motifs, added objects, new text, added watermarks",
].join(", ");

export const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status, designExtractError: true }); };
function checked(result) { if (result.error) throw result.error; return result.data; }
export const prefix = project => `users/${project.user_id}/design-extract/${project.id}/`;
export async function readAsset(url, provider = false) {
  const { buffer } = await fetchWithSSRFProtection(url, { allowedHosts: provider ? getAllowedProviderHosts() : getAllowedStorageHosts(), maxBytes: DESIGN_EXTRACT_UPLOAD_MAX_BYTES, allowedContentTypes: ["image/"] });
  return buffer;
}
export async function ownedProject(id, userId) {
  const project = checked(await db.from("design_extract_projects").select("*").eq("id", id).eq("user_id", userId).maybeSingle());
  if (!project || Date.parse(project.expires_at) <= Date.now()) fail("Project not found or expired", 404);
  return project;
}
export async function createProject(userId, sourceUrl, sourceProjectId) {
  if (sourceProjectId) {
    const source = checked(await db.from("projects").select("generated_image_url").eq("id", sourceProjectId).eq("user_id", userId).maybeSingle());
    if (!source?.generated_image_url || source.generated_image_url === "REFUNDED") fail("Flat result not found", 404);
    sourceUrl = source.generated_image_url;
  }
  if (!isOwnedStorageUrl(sourceUrl, { userId, projectId: sourceProjectId })) fail("Unauthorized source image");
  const bytes = await readAsset(sourceUrl);
  const meta = await sharp(bytes, { limitInputPixels: 24000000 }).metadata();
  if (!["png", "jpeg", "webp"].includes(meta.format) || !meta.width || !meta.height) fail("Use PNG, JPG or WebP");
  const id = randomUUID();
  const project = { id, user_id: userId };
  const normalized = await sharp(bytes).rotate().png().toBuffer({ resolveWithObject: true });
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
  if (existing) return existing;
  if (!process.env.FAL_KEY) fail("AI processing is not configured", 503);
  const limit = await enforceRateLimit({ namespace: "design-extract:ai", identifier: project.user_id, max: 6, window: "60 s", windowMs: 60000 });
  if (!limit.success) fail("Too many AI operations. Try again shortly.", 429);
  const layer = project.manifest.layers.find(item => item.id === layerId);
  if (kind === "split" && !layer || kind === "segment" && layerId && !layer) fail("Select a valid layer");
  if (kind === "extract" && project.manifest.layers.length) fail("Use Split further on an existing layer");
  if (project.manifest.layers.length + (kind === "split" ? 3 : kind === "segment" ? 1 : 4) > MAX_LAYERS) fail("Maximum 32 layers");
  const input = kind === "segment" ? { image_url: layer?.url || project.source_url, prompt: "", apply_mask: false, output_format: "png", return_multiple_masks: false } : { image_url: layer?.url || project.source_url, negative_prompt: LAYER_NEGATIVE_PROMPT, num_layers: 4, output_format: "png", enable_safety_checker: true };
  if (kind === "segment") {
    const point = body.point;
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.y < 0 || point.x >= (layer?.width || project.manifest.width) || point.y >= (layer?.height || project.manifest.height)) fail("Click inside the source artwork or selected layer");
    // The live endpoint requires numeric labels despite the generated SDK type.
    input.point_prompts = [{ x: Math.round(point.x), y: Math.round(point.y), label: 1 }];
  }
  const model = kind === "segment" ? SEGMENT_MODEL : LAYER_MODEL;
  const claim = await db.from("design_extract_jobs").insert({ project_id: project.id, user_id: project.user_id, base_revision: project.revision, idempotency_key: idempotencyKey, kind, layer_id: layerId || null, input: kind === "segment" ? input : { ...input, _desaynclaw: { enhanceLayers: 1 } }, model }).select().single();
  if (claim.error?.code === "23505") fail("Another operation is active or awaiting review", 409);
  const job = checked(claim);
  try {
    const { request_id } = await fal.queue.submit(model, { input });
    // A failed persistence after submission must never trigger another submission.
    return checked(await db.from("design_extract_jobs").update({ request_id, status: "queued", updated_at: new Date().toISOString() }).eq("id", job.id).select().single());
  } catch (error) {
    if (error.status === 422 || error.name === "ValidationError") {
      checked(await db.from("design_extract_jobs").update({ status: "failed", error: "Provider rejected this request", updated_at: new Date().toISOString() }).eq("id", job.id).eq("status", "submitting"));
      fail("Provider rejected this request. Your existing layers are unchanged.", 422);
    }
    console.error("[Design Extract] Submission uncertain", { jobId: job.id, message: error.message });
    // Leave the claim in submitting. Admin must reconcile it against provider history.
    fail("Submission outcome uncertain. Check fal history before retrying this operation.", 503);
  }
}
export async function settleOperation(project, job) {
  if (!["queued", "processing", "saving"].includes(job.status) || !job.request_id) return job;
  if (job.status === "saving" && job.result?.enhancement?.version === 1) return advanceEnhancement(project, job, { readAsset, uploadToR2, prefix });
  try {
    const status = await fal.queue.status(job.model, { requestId: job.request_id, logs: false });
    if (status.status !== "COMPLETED") {
      const next = status.status === "IN_PROGRESS" ? "processing" : "queued";
      checked(await db.from("design_extract_jobs").update({ status: next }).eq("id", job.id).in("status", ["queued", "processing"]));
      return { ...job, status: next, queuePosition: status.queue_position };
    }
    if (job.status !== "saving") {
      checked(await db.from("design_extract_jobs").update({ status: "saving", updated_at: new Date().toISOString() }).eq("id", job.id).in("status", ["queued", "processing"]));
      // Expose the saving stage and settle assets on the next poll (or cron run).
      return { ...job, status: "saving" };
    }
    const { data } = await fal.queue.result(job.model, { requestId: job.request_id });
    if (data.has_nsfw_concepts?.some(Boolean)) fail("The provider could not process this design", 422);
    const images = job.kind === "segment" ? (data.image?.url ? [data.image] : data.masks?.slice(0, 1)) : data.images;
    if (!images?.length || images.length > 4) fail("Provider returned no usable layers", 422);
    const parent = project.manifest.layers.find(layer => layer.id === job.layer_id);
    const sourcePixels = job.kind === "segment" && job.input?.apply_mask === false ? await readAsset(job.input.image_url) : null;
    const layers = [];
    const warnings = new Set();
    let nativeWidth, nativeHeight;
    for (const [index, image] of images.entries()) {
      let bytes = await readAsset(image.url, true);
      if (sourcePixels) bytes = await applySourceMask(sourcePixels, bytes);
      const metadata = await sharp(bytes, { limitInputPixels: 24000000 }).metadata();
      if (!metadata.hasAlpha) fail("The AI returned a layer without transparency. Your original artwork is unchanged.", 422);
      const { data: pixels, info } = await sharp(bytes, { limitInputPixels: 24000000 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      if (index === 0) { nativeWidth = info.width; nativeHeight = info.height; }
      let left = info.width, top = info.height, right = -1, bottom = -1;
      for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) if (pixels[(y * info.width + x) * 4 + 3] > 0) { left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y); }
      if (right < left) continue;
      const width = right - left + 1, height = bottom - top + 1;
      const trimmed = await sharp(pixels, { raw: info }).extract({ left, top, width, height }).png().toBuffer();
      const url = await uploadToR2(trimmed, `${prefix(project)}${job.id}/${index}.png`, "image/png");
      const sx = (parent?.width || project.manifest.width) / info.width;
      const sy = (parent?.height || project.manifest.height) / info.height;
      // Keep native output pixels; preserve original canvas alignment through scale.
      // Model output sizes can differ from the source. Preserve native pixels and
      // use a uniform contain scale; ask for review instead of discarding valid layers.
      if (Math.abs(sx - sy) / Math.max(sx, sy) > .03) warnings.add("The AI output has a different aspect ratio from your source. Layers are centered without stretching. Check their alignment before accepting.");
      const scale = Math.min(sx, sy);
      const offsetX = ((parent?.width || project.manifest.width) - info.width * scale) / 2;
      const offsetY = ((parent?.height || project.manifest.height) - info.height * scale) / 2;
      layers.push({ id: `${job.id}-${index}`, url, name: sourcePixels ? "Original artwork cutout" : `Layer ${index + 1}`, extractionMethod: sourcePixels ? "source-pixels" : "ai-reconstruction", width, height, nativeFrame: { width: info.width, height: info.height, left, top }, visible: true, locked: false, composition: { x: offsetX + left * scale, y: offsetY + top * scale, scale }, layout: { x: 300 + index % 4 * 260, y: Math.floor(index / 4) * 300, scale: Math.min(220 / width, 250 / height, 1) } });
    }
    if (!layers.length) fail("No visible elements returned", 422);
    const result = { layers, nativeWidth, nativeHeight, warnings: [...warnings] };
    if (job.kind !== "segment" && job.input?._desaynclaw?.enhanceLayers === 1) {
      // Persist all unenhanced candidates before any paid enhancement call.
      const initialized = await db.from("design_extract_jobs").update({ result: enhancementResult(result), updated_at: new Date().toISOString() })
        .eq("id", job.id).eq("status", "saving").is("result", null).select().maybeSingle();
      if (initialized.error) throw initialized.error;
      if (initialized.data) return initialized.data;
      return checked(await db.from("design_extract_jobs").select("*").eq("id", job.id).single());
    }
    const ready = checked(await db.from("design_extract_jobs").update({ status: "ready", result, updated_at: new Date().toISOString() }).eq("id", job.id).in("status", ["queued", "processing", "saving"]).select().maybeSingle());
    console.info("[Design Extract] Provider operation", { jobId: job.id, model: job.model, requestId: job.request_id, outputCount: layers.length, durationMs: Date.now() - Date.parse(job.created_at) });
    return ready || checked(await db.from("design_extract_jobs").select("*").eq("id", job.id).single());
  } catch (error) {
    if (error.status === 422 || error.name === "ValidationError") {
      const message = error.designExtractError ? error.message : "The AI provider could not complete this extraction. Your original artwork is unchanged.";
      console.warn("[Design Extract] Output validation failed", { jobId: job.id, requestId: job.request_id, reason: message });
      return checked(await db.from("design_extract_jobs").update({ status: "failed", error: message, updated_at: new Date().toISOString() }).eq("id", job.id).in("status", ["queued", "processing", "saving"]).select().single());
    }
    throw error;
  }
}
export async function recoverOperation(project, jobId) {
  const job = checked(await db.from("design_extract_jobs").select("*").eq("id", jobId).eq("project_id", project.id).eq("user_id", project.user_id).eq("status", "failed").maybeSingle());
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
export async function snapshot(project) {
  const jobs = checked(await db.from("design_extract_jobs").select("*").eq("project_id", project.id).order("created_at", { ascending: false }).limit(1));
  const job = jobs[0] ? await settleOperation(project, jobs[0]) : null;
  return { project, job };
}
export async function reconcileSubmission(project, jobId, requestId) {
  if (typeof requestId !== "string" || !/^[a-zA-Z0-9-]{10,100}$/.test(requestId)) fail("Enter the request ID from fal history");
  const job = checked(await db.from("design_extract_jobs").select("*").eq("project_id", project.id).eq("id", jobId).eq("status", "submitting").maybeSingle());
  if (!job) fail("Submission no longer needs reconciliation", 409);
  await fal.queue.status(job.model, { requestId, logs: false });
  return checked(await db.from("design_extract_jobs").update({ request_id: requestId, status: "queued", updated_at: new Date().toISOString() }).eq("id", job.id).eq("status", "submitting").select().single());
}
export async function reviewOperation(project, jobId, accept) {
  const job = checked(await db.from("design_extract_jobs").select("*").eq("project_id", project.id).eq("id", jobId).single());
  if (job.status !== "ready") fail("Operation is not ready for review", 409);
  // Commit project and job together; revision prevents concurrent edits or double acceptance.
  const manifest = accept ? acceptLayers(project.manifest, job) : project.manifest;
  return checked(await db.rpc("review_design_extract", { target_project: project.id, target_user: project.user_id, target_job: jobId, expected_revision: project.revision, next_manifest: manifest, accepted: accept }));
}
