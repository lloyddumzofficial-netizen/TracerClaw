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
import { renderColorWand } from "./colorWand";
import { separateElements } from "./separateElements";
import { automaticCutouts } from "./automaticCutouts";
import { PILOT_MASK_MODEL, PILOT_PREPARATION_LIMIT_MS, createPilotPreview, isQualityPilotJob, isQualityReviewJob, locatePilotRegions, matchPilotMasks, nativePilotCoverage, pilotMaskRequest, qualityPilotAvailable, qualityReviewAvailable } from "./qualityPilot";
import { editQualityDraft, readQualityDraft } from "./qualityReview";
import { GUIDED_CUTOUT_MODEL, guidedCutout, guidedPreview, hasPreparedCutoutInput, isAutomaticSeparationJob, renderGuidedCutout } from "./guidedCutout";
import { advanceGuidedFillJob, hasRecoverableBackground, interruptedCutoutError, prepareGuidedFillJob, readyCutoutsWithoutFill, recoverRecordedBackground } from "./guidedFillJob";
import { advanceAutomaticMasks, findAutomaticTargets, prepareAutomaticMask, renderWhiteElement, wholeArtworkTarget } from "./automaticSeparation";
import { advanceProductionLayers, isProductionSeparation } from "./productionLayers";
import { canAutoAcceptNanoLayers, nanoColumnGuide, nanoElementInput, splitNanoElements } from "./nanoElements";
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
import { designRefineAvailable, isRefinementProject, prepareRefinement, refinementFrame, refinementOptions, REFINE_MODEL } from "./refinement";
import { designAssetUrl } from "./storage";
import { isGarmentProject } from "@/lib/artworkEdits";
import { layerVisible } from "@/lib/designLayerTypes";

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
const guidedModeAvailable = () => qualityReviewAvailable() && designProcessingDriver() === "legacy" && Boolean(process.env.FAL_KEY);
const productionNanoAvailable = () => process.env.VERCEL_ENV === "production";
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
export async function createProject(userId, sourceUrl, sourceProjectId, refinement = false) {
  return withDesignImageWork(() => createProjectImage(userId, sourceUrl, sourceProjectId, refinement));
}
async function createProjectImage(userId, sourceUrl, sourceProjectId, refinement) {
  if (sourceProjectId) {
    const source = checked(await db.from("projects").select("generated_image_url,trace_type").eq("id", sourceProjectId).eq("user_id", userId).maybeSingle());
    if (!source?.generated_image_url || source.generated_image_url === "REFUNDED") fail("Flat result not found", 404);
    if (refinement && !isGarmentProject(source)) fail("Choose an extracted garment design", 400);
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
  const manifest = emptyManifest(normalized.info.width, normalized.info.height);
  if (refinement) manifest.workspaceMode = "refine";
  checked(await db.from("design_extract_projects").insert({ ...project, source_url: sourceUrl, manifest }));
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

function selectionInput(body, { width, height }) {
  const box = body.selectionBox;
  if (box != null && (!Number.isInteger(box.left) || !Number.isInteger(box.top) || !Number.isInteger(box.right) || !Number.isInteger(box.bottom) || box.left < 0 || box.top < 0 || box.right >= width || box.bottom >= height || box.left >= box.right || box.top >= box.bottom)) {
    fail("Draw a selection box inside the artwork");
  }
  const points = body.points || (body.point ? [{ ...body.point, label: 1 }] : []);
  if (!Array.isArray(points) || points.length > 32 || points.some(point => !point || ![0, 1].includes(point.label) || !Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.y < 0 || point.x >= width || point.y >= height)) fail("Use up to 32 Include or Exclude points inside the artwork.");
  return { box, points: points.map(({ x, y, label }) => ({ x: Math.min(Math.round(x), width - 1), y: Math.min(Math.round(y), height - 1), label })) };
}

export async function colorCutout(project, body) {
  if (isRefinementProject(project)) fail("Use Refine design to clean up the full artwork.", 400);
  if (body.revision !== project.revision) fail("Project changed. Reload before cutting out artwork.", 409);
  if (project.manifest.layers.length >= MAX_LAYERS) fail("Make room for the cutout. Maximum 32 layers.");
  const parent = project.manifest.layers.find(layer => layer.id === body.layerId);
  if (body.layerId && (!parent || parent.kind === "svg")) fail("Select a raster layer or the original artwork.");
  const { width, height } = parent || project.manifest;
  const { box, points } = selectionInput(body, { width, height });
  const { tolerance } = body;
  if (!box || !points.some(point => point.label === 1 && point.x >= box.left && point.x <= box.right && point.y >= box.top && point.y <= box.bottom)) fail("Draw a box and sample at least one color inside it.");
  if (!Number.isInteger(tolerance) || tolerance < 0 || tolerance > 100) fail("Choose a color tolerance from 0 to 100.");
  const active = checked(await db.from("design_extract_jobs").select("id").eq("project_id", project.id).in("status", ["submitting", "queued", "processing", "saving", "ready"]).limit(1));
  if (active.length) fail("Finish the active extraction before adding a cutout.", 409);
  const sourceUrl = parent?.url || project.source_url;
  return withDesignImageWork(async () => {
    const result = await renderColorWand(await readAsset(sourceUrl), { box, points, tolerance, width, height });
    if (!result) fail("No pixels matched. Check your Include points and color tolerance.", 422);
    if (body.action === "color-preview") {
      return sharp(result.trimmed).resize(360, 360, { fit: "inside", withoutEnlargement: true }).png().toBuffer();
    }
    const id = randomUUID();
    const key = `${prefix(project)}cutouts/${id}`;
    const url = await uploadToR2(result.trimmed, `${key}.png`, "image/png");
    const maskBaseUrl = await uploadToR2(await result.image.png().toBuffer(), `${key}-full.png`, "image/png");
    const bounds = result.bounds;
    const layer = {
      id, url, maskBaseUrl, maskSourceUrl: sourceUrl, name: "Color cutout", extractionMethod: "source-pixels",
      width: bounds.width, height: bounds.height, visible: true, locked: false,
      nativeFrame: { width, height, left: bounds.left, top: bounds.top },
      composition: { x: bounds.left, y: bounds.top, scale: 1 },
    };
    const manifest = acceptLayers(project.manifest, { kind: "segment", layer_id: parent?.id, result: { layers: [layer] } });
    const saved = checked(await db.from("design_extract_projects").update({ manifest, revision: project.revision + 1, updated_at: new Date().toISOString() }).eq("id", project.id).eq("user_id", project.user_id).eq("revision", project.revision).gt("expires_at", new Date().toISOString()).select().maybeSingle());
    if (!saved) fail("Project changed. Reload before adding the cutout.", 409);
    return { project: saved, layerId: id };
  });
}
async function hasAcceptedExtraction(project) {
  if (project.manifest.extractionComplete) return true;
  if (project.revision === 0) return false;
  return Boolean(checked(await db.from("design_extract_jobs").select("id").eq("project_id", project.id)
    .eq("user_id", project.user_id).eq("kind", "extract").eq("status", "accepted").limit(1).maybeSingle()));
}

export async function startOperation(project, body) {
  const { kind, layerId, idempotencyKey } = body;
  if (!["extract", "split", "segment", "refine"].includes(kind) || typeof idempotencyKey !== "string" || !/^[\w-]{8,120}$/.test(idempotencyKey)) fail("Invalid operation");
  const refine = kind === "refine";
  if (refine !== isRefinementProject(project)) fail("This operation is unavailable in this project.", 400);
  if (refine && (!await designRefineAvailable() || layerId || body.extractionMode)) fail("Design Refined is unavailable.", 400);
  const paid = refine || designBillingMode() === "paid";
  const pilot = body.extractionMode === "pilot";
  const productionNano = kind === "extract" && !pilot && productionNanoAvailable();
  const automatic = kind === "extract" && !pilot && (productionNano || guidedModeAvailable());
  const whiteElements = body.extractionMode === "automatic-white";
  if ((body.extractionMode === "automatic" || whiteElements) && !automatic) fail("Automatic separation is unavailable in this workspace.", 400);
  if (kind === "extract" && layerId) fail("Extract elements uses the original artwork.");
  const reviewCutouts = body.extractionMode === "review" && !automatic;
  const guided = body.extractionMode === "guided";
  if ((pilot || reviewCutouts) && (kind !== "extract" || !qualityReviewAvailable() || designProcessingDriver() !== "legacy" || pilot && !qualityPilotAvailable())) fail("The selected local extraction method is unavailable.", 400);
  if (guided && (kind !== "segment" || layerId || !qualityReviewAvailable() || designProcessingDriver() !== "legacy")) fail("Guided cutout is available on the original artwork in the local workspace.", 400);
  const existing = checked(await db.from("design_extract_jobs").select("*").eq("project_id", project.id).eq("idempotency_key", idempotencyKey).maybeSingle());
  if (existing) {
    if (!existing.input?._desaynclaw?.nanoElements && Boolean(existing.input?._desaynclaw?.whiteElements) !== whiteElements) fail("This request key belongs to a different output format.", 409);
    if (existing.kind !== kind || (existing.layer_id || null) !== (layerId || null) || isQualityPilotJob(existing) !== pilot || isQualityReviewJob(existing) !== (pilot || reviewCutouts) || isAutomaticSeparationJob(existing) !== automatic || (!automatic && Boolean(guidedCutout(existing)) !== guided)) fail("This request key belongs to a different operation", 409);
    return existing;
  }
  if (kind === "extract" && (project.manifest.layers.length || await hasAcceptedExtraction(project))) {
    fail("Elements have already been extracted for this artwork.", 409);
  }
  if (refine && body.revision !== project.revision) fail("Project changed. Reload before refining.", 409);
  if (!process.env.FAL_KEY) fail("AI processing is not configured", 503);
  const limit = await enforceRateLimit({ namespace: "design-extract:ai", identifier: project.user_id, max: 6, window: "60 s", windowMs: 60000 });
  if (!limit.success) fail("Too many AI operations. Try again shortly.", 429);
  const layer = project.manifest.layers.find(item => item.id === layerId);
  if(layer?.kind==='svg')fail('Select a raster layer for AI extraction.');
  if(layer?.kind==='svg')fail('Choose a raster layer for extraction.');
  if (kind === "split" && !layer || kind === "segment" && layerId && !layer) fail("Select a valid layer");
  const availableLayers = automatic ? MAX_LAYERS : MAX_LAYERS - project.manifest.layers.length + (kind === "split" || guided && project.manifest.layers.some(item => item.guidedBackground) ? 1 : 0);
  if (refine && availableLayers < 3) fail("Make room for three refinement options before starting.");
  if (availableLayers < (kind === "segment" && !guided ? 1 : 2)) fail("Make room for extracted layers. Maximum 32 layers.");
  const input = kind === "segment" ? { image_url: layer?.url || project.source_url, apply_mask: false, output_format: "png" } : { image_url: layer?.url || project.source_url, output_format: "png", points_per_side: 32, pred_iou_thresh: .88, stability_score_thresh: .95, min_mask_region_area: 100 };
  let model = refine ? REFINE_MODEL : LAYER_MODEL;
  if (kind === "segment") {
    const { box: area, points: prompts } = selectionInput(body, layer || project.manifest);
    if (!area && !prompts.some(point => point.label === 1)) fail("Draw a box or add an Include point.");
    if (guided) {
      const name = typeof body.targetName === "string" ? body.targetName.trim().replace(/\s+/g, " ") : "";
      if (!area || !name || name.length > 100) fail("Draw a box and describe the element in 1–100 characters.");
      if (area.right - area.left < 7 || area.bottom - area.top < 7) fail("Draw a larger box around the element.");
      model = SEGMENT_MODEL;
      input._desaynclaw = { guidedCutout: { name, box: { left: area.left, top: area.top, width: area.right - area.left + 1, height: area.bottom - area.top + 1 } } };
    } else if (area) {
      model = LEGACY_SEGMENT_MODEL; // SAM 3 is already supported by the job schema.
      input.box_prompts = [{ x_min: area.left, y_min: area.top, x_max: area.right, y_max: area.bottom, object_id: 1 }];
      if (prompts.length) input.point_prompts = prompts.map(point => ({ ...point, object_id: 1 }));
    } else {
      model = SEGMENT_MODEL;
      input.prompts = prompts;
    }
  }
  // Upscaling is an explicit layer action. Historical jobs retain their saved
  // enhancement setting; new reconstruction requests incur no automatic upscale.
  const record = { project_id: project.id, user_id: project.user_id, base_revision: project.revision, idempotency_key: idempotencyKey, kind, layer_id: layerId || null, input: refine ? { image_url: project.source_url } : kind === "segment" ? input : { ...input, _desaynclaw: { enhanceLayers: 0, maskExtraction: 1, ...(pilot && { qualityPilot: true }), ...(reviewCutouts && { reviewCutouts: true }), ...(automatic && { autoSeparation: true, whiteElements: true, nanoElements: true }) } }, model };
  if (paid && (body.priceVersion !== DESIGN_EXTRACT_PRICE_VERSION || body.acknowledgedClaws !== designExtractPrice(kind))) fail("Pricing changed. Refresh the workspace to review the current Claw price.", 409);
  requirePrivateDesignStorage();
  const processor = productionNano ? "legacy" : refine || automatic || guided || pilot || reviewCutouts ? "local" : designProcessingDriver();
  if (processor !== "legacy") record.processor = processor;
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
  if (paid) {
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
  const dispatched = refine ? await withDesignImageWork(() => dispatchReservedOperation(project, job))
    : pilot || guided || automatic ? await dispatchLocalMaskJob(project, job) : job.billing_state === "held" && job.charge_amount > 0
    ? await dispatchReservedOperation(project, job)
    : await sendRecordedOperation(job, await designProviderInput(input));
  return Number.isInteger(creditsRemaining) && dispatched.status !== "failed" ? { ...dispatched, creditsRemaining } : dispatched;
}

async function dispatchLocalMaskJob(project, job) {
  // Claim once before either provider call. Sync never retries a pilot submission.
  const claimed = checked(await updateJob(job, { dispatch_started_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("user_id", project.user_id).eq("status", "submitting").is("dispatch_started_at", null).select().maybeSingle());
  if (!claimed) return checked(await db.from("design_extract_jobs").select("*").eq("id", job.id).single());
  let next, providerInput;
  try {
    const guided = guidedCutout(job);
    if (job.input?._desaynclaw?.nanoElements) {
      const columns = await withDesignImageWork(async () => nanoColumnGuide(await readAsset(job.input.image_url), { withBackdrop: true }));
      const layout = columns ? "columns" : "grid";
      const sourceUrl = columns ? await uploadToR2(columns.guide, `${prefix(project)}${job.id}/nano-guide.png`, "image/png") : job.input.image_url;
      providerInput = nanoElementInput(await designAssetUrl(sourceUrl, 3600), layout, project.manifest.width / project.manifest.height);
      next = checked(await updateJob(claimed, { model: REFINE_MODEL,
        input: { ...job.input, _desaynclaw: { ...job.input._desaynclaw, nanoLayout: layout, nanoBackdropExpected: true,
          ...(columns && { nanoBackdrop: columns.backdrop }) } }, updated_at: new Date().toISOString() })
        .eq("status", "submitting").select().single());
    } else if (isAutomaticSeparationJob(job)) {
      const whiteElements = job.input._desaynclaw.whiteElements === true;
      const source = await readAsset(job.input.image_url);
      const preview = await withDesignImageWork(() => createPilotPreview(source));
      const production = isProductionSeparation(job);
      const [first, ...additionalTargets] = await findAutomaticTargets(preview, project.manifest, whiteElements, production);
      if (!first && production) fail("No complete graphics were detected. Try Manual cutout to select a design.", 422);
      const { target, input } = await withDesignImageWork(() => prepareAutomaticMask(source, first || wholeArtworkTarget(project.manifest), `${prefix(project)}${job.id}/mask-preview.png`, uploadToR2, whiteElements));
      providerInput = input;
      next = checked(await updateJob(claimed, { model: whiteElements ? REFINE_MODEL : GUIDED_CUTOUT_MODEL, input: {
        image_url: job.input.image_url, _desaynclaw: { autoSeparation: true, guidedCutout: target, additionalTargets, ...(production && { productionLayers: true }), ...(whiteElements && { whiteElements: true }) },
      }, updated_at: new Date().toISOString() }).eq("status", "submitting").select().single());
    } else {
      const preview = await withDesignImageWork(async () => {
        const source = await readAsset(job.input.image_url);
        if (!guided) return createPilotPreview(source);
        const { data: bytes, info: { width, height } } = await guidedPreview(source, guided.box);
        return { bytes, width, height };
      });
      const { regions } = guided ? {} : await locatePilotRegions(preview);
      if (!guided && !regions.length) fail("No complete elements were detected. Use Manual cutout to select artwork.", 422);
      const previewUrl = await uploadToR2(preview.bytes, `${prefix(project)}${job.id}/mask-preview.png`, "image/png");
      const size = { width: preview.width, height: preview.height };
      providerInput = await designProviderInput(guided
        ? { image_url: previewUrl, prompt: `Keep only ${guided.name}. Include all parts belonging to that design in the same cutout.`, autocrop: false }
        : pilotMaskRequest(previewUrl, regions));
      const input = { image_url: job.input.image_url, _desaynclaw: guided
        ? { guidedCutout: { ...guided, preview: size } }
        : { qualityPilot: true, preview: { ...size, regions } } };
      next = checked(await updateJob(claimed, { model: guided ? GUIDED_CUTOUT_MODEL : PILOT_MASK_MODEL, input, updated_at: new Date().toISOString() })
        .eq("status", "submitting").select().single());
    }
  } catch (error) {
    console.warn("[Design Extract] Cutout preparation failed", { jobId: job.id, status: error.status || null });
    return failQualityPilot(claimed, error.designExtractError ? error.message : "Could not prepare the artwork for extraction.");
  }
  return sendRecordedOperation(next, providerInput);
}

async function failQualityPilot(job, error) {
  const failed = checked(await updateJob(job, { status: "failed", error, updated_at: new Date().toISOString() })
    .eq("status", "submitting").eq("model", job.model).select().maybeSingle());
  return settleDesignBilling(failed || checked(await db.from("design_extract_jobs").select("*").eq("id", job.id).single()));
}

export function awaitingDesignDispatch(job) {
  return job?.status === "submitting" && !isQualityPilotJob(job) && !guidedCutout(job) && !isAutomaticSeparationJob(job) && (job.billing_state === "held" && job.charge_amount > 0 || job.processor === "workflow") && !job.dispatch_started_at && !job.request_id;
}
async function dispatchReservedOperation(project, job) {
  if (!awaitingDesignDispatch(job)) return job;
  if (job.user_id !== project.user_id || job.project_id !== project.id || job.base_revision !== project.revision || Date.parse(project.expires_at) <= Date.now()) fail("Project changed before dispatch. Reload before continuing.", 409);
  if (![LAYER_MODEL, LEGACY_LAYER_MODEL, SEGMENT_MODEL, LEGACY_SEGMENT_MODEL, REFINE_MODEL].includes(job.model) || !ownsPrivateDesignAsset(job.input?.image_url, project.user_id)) fail("Private extraction input unavailable", 503);
  // Resolve the temporary link before claiming dispatch: signing failures cannot
  // have reached the provider. Once claimed, an uncertain POST is never repeated.
  const { _desaynclaw: _settings, ...input } = job.input;
  const providerInput = job.kind === "refine" ? await prepareRefinement(
    await readAsset(input.image_url), refinementFrame(project.manifest.width, project.manifest.height),
    bytes => uploadToR2(bytes, prefix(project) + job.id + "/refine-input.png", "image/png"),
    url => designAssetUrl(url, 3600),
  ) : await designProviderInput(input);
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
    if (job.kind === "refine" && [400, 401, 402, 403, 404, 413, 422, 429].includes(error.status)) {
      const failed = checked(await updateJob(job, { status: "failed", error: "The provider could not refine this artwork.", updated_at: new Date().toISOString() }).eq("status", "submitting").select().single());
      return settleDesignBilling(failed);
    }
    if ((isQualityPilotJob(job) || guidedCutout(job) || job.input?._desaynclaw?.nanoElements) && [400, 401, 402, 403, 404, 413, 422, 429].includes(error.status)) {
      return failQualityPilot(job, job.input?._desaynclaw?.nanoElements ? "Nano Banana could not process this artwork." : "The mask provider could not process this artwork.");
    }
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
  if (job.processor === "local" && (process.env.NODE_ENV !== "development" || process.env.VERCEL)) return job;
  const preparingLocal = isQualityPilotJob(job) && job.model !== PILOT_MASK_MODEL || (guidedCutout(job) || isAutomaticSeparationJob(job)) && !hasPreparedCutoutInput(job);
  if (job.processor === "legacy" && job.input?._desaynclaw?.nanoElements && job.status === "submitting" && !job.request_id) {
    if (Date.now() - Date.parse(job.dispatch_started_at || job.created_at) >= PILOT_PREPARATION_LIMIT_MS) return failQualityPilot(job, "Extraction could not be confirmed. You can retry.");
    if (!job.dispatch_started_at) {
      if (job.base_revision !== project.revision) return failQualityPilot(job, "The project changed before extraction started.");
      return dispatchLocalMaskJob(project, job);
    }
    return job;
  }
  if (preparingLocal && job.processor === "local" && job.status === "submitting" &&
      !job.dispatch_started_at && !job.request_id && Date.now() - Date.parse(job.created_at) < PILOT_PREPARATION_LIMIT_MS) {
    if (job.base_revision !== project.revision) fail("Project changed before extraction. Reload before continuing.", 409);
    return dispatchLocalMaskJob(project, job);
  }
  return withDesignImageWork(async () => {
    // The legacy processor needs the same finite deadline as durable workflows.
    // Uncertain submissions remain reserved for explicit reconciliation.
    const created = Date.parse(job.created_at);
    if (preparingLocal && job.status === "submitting" && Date.now() - Date.parse(job.dispatch_started_at || job.created_at) >= PILOT_PREPARATION_LIMIT_MS) {
      return failQualityPilot(job, "Extraction preparation was interrupted.");
    }
    if (job.processor !== "workflow" && Number.isFinite(created) && Date.now() - created >= DESIGN_OPERATION_DEADLINE_MS && (awaitingDesignDispatch(job) || job.kind === "refine" && job.status === "submitting" || ["queued", "processing", "saving"].includes(job.status))) {
      const whiteElements = job.input?._desaynclaw?.whiteElements;
      const usable = (whiteElements || !guidedCutout(job)) && Boolean(job.result?.layers?.length);
      const partial = whiteElements ? null : readyCutoutsWithoutFill(job, job.result?.productionOutput
        ? "Processing reached its time limit. Saved cutouts are available. The background was not generated."
        : "The cutouts are ready. The background fill reached its time limit.");
      const values = { ...(partial || { status: usable ? "ready" : "failed", error: usable ? null : job.kind === "refine" ? "Refinement reached its time limit." : "No usable layers were saved before the processing deadline", ...(usable ? { result: { ...job.result, warnings: [...new Set([...(job.result.warnings || []), "Processing reached its time limit. Available saved layers were kept."])] } } : guidedCutout(job) ? { result: null } : {}) }), updated_at: new Date().toISOString() };
      const expired = checked(await updateJob(job, values).eq("status", job.status).select().maybeSingle());
      const current = expired || checked(await db.from("design_extract_jobs").select("*").eq("id", job.id).eq("user_id", project.user_id).single());
      return settleDesignBilling(current);
    }
    if (awaitingDesignDispatch(job)) return settleDesignBilling(await dispatchReservedOperation(project, job));
    return settleDesignBilling(await advanceOperation(project, job));
  });
}
async function advanceOperation(project, job, { recordedOnly = false } = {}) {
  if ((!recordedOnly && !["queued", "processing", "saving"].includes(job.status)) || !job.request_id) return job;
  if (job.status === "saving" && job.result?.backgroundFill) return advanceGuidedFillJob(project, job, { readAsset, uploadToR2, prefix });
  if (job.status === "saving" && job.result?.enhancement?.version === 1) return advanceEnhancement(project, job, { readAsset, uploadToR2, prefix });
  try {
    const whiteOutput = job.result?.whiteOutput;
    const production = !recordedOnly && isProductionSeparation(job);
    const productionOutput = production && job.result?.productionOutput;
    const status = job.status === "saving" && (whiteOutput || productionOutput || job.result?.cutoutBatch)
      ? { status: "COMPLETED" } : await fal.queue.status(job.model, { requestId: job.request_id, logs: false }).catch(error => {
        if (production && [400, 404, 410, 422].includes(error.status)) return { status: "FAILED" };
        throw error;
      });
    if (status.status !== "COMPLETED" && !(production && ["FAILED", "CANCELLED"].includes(status.status))) {
      if (recordedOnly) fail("The recorded cutout is still processing. Check again shortly.", 409);
      const next = status.status === "IN_PROGRESS" ? "processing" : "queued";
      checked(await updateJob(job, { status: next, updated_at: new Date().toISOString() }).in("status", ["queued", "processing"]));
      return { ...job, status: next, queuePosition: status.queue_position };
    }
    if (!recordedOnly && job.status !== "saving") {
      checked(await updateJob(job, { status: "saving", updated_at: new Date().toISOString() }).in("status", ["queued", "processing"]));
      // Expose the saving stage and settle assets on the next poll (or cron run).
      return { ...job, status: "saving" };
    }
    const automatic = isAutomaticSeparationJob(job);
    if (automatic && job.input._desaynclaw.nanoElements) {
      const { data } = await fal.queue.result(job.model, { requestId: job.request_id });
      if (!data?.images?.[0]?.url || data.has_nsfw_concepts?.some(Boolean)) fail("Nano Banana returned no usable graphics.", 422);
      const { nanoLayout: layout, nanoBackdropExpected, nanoBackdrop } = job.input._desaynclaw;
      const frame = project.manifest;
      const { elements, clipped } = await splitNanoElements(await readAsset(data.images[0].url, true), layout,
        nanoBackdropExpected ? frame.width / frame.height : null);
      if (!elements.length) fail("Nano Banana could not separate the graphics cleanly. Your original is intact.", 422);
      if (nanoBackdrop) {
        const { width, height } = frame;
        const bytes = await sharp({ create: { width, height, channels: 3, background: nanoBackdrop } }).png().toBuffer();
        elements.push({ slot: "background", background: true, bytes, width, height });
      }
      const layers = [];
      let graphicNumber = 0;
      for (const { slot, width, height, bytes, background } of elements) {
        const url = await uploadToR2(bytes, `${prefix(project)}${job.id}/element-${slot}.png`, "image/png");
        const scale = Math.min(frame.width / width, frame.height / height);
        layers.push({
          id: `${job.id}-element-${slot}`, name: background ? "Background" : layout === "columns" ? ["Left graphic", "Center graphic", "Right graphic"][slot - 1] : `Graphic ${++graphicNumber}`, width, height, url,
          maskBaseUrl: url, maskSourceUrl: url, nativeFrame: { width, height, left: 0, top: 0 },
          visible: true, locked: false, extractionMethod: background && nanoBackdrop ? "source-pixels" : "ai-reconstruction",
          visibility: { overview: true, composition: layers.length === 0 },
          composition: { x: (frame.width - width * scale) / 2, y: (frame.height - height * scale) / 2, scale },
          layout: { x: 0, y: 0, scale: 1 },
        });
      }
      const warning = [
        clipped ? "Some graphics overlapped on the sheet and could not be saved separately." : "",
        nanoBackdropExpected && !elements.some(element => element.background) ? "A separate background could not be identified. The original is available for comparison." : "",
      ].filter(Boolean).join(" ");
      const ready = checked(await updateJob(job, {
        status: "ready", result: { layers: arrangeOverview(layers, project.manifest), replaceExtraction: true,
          ...(warning && { warnings: [warning] }),
        }, updated_at: new Date().toISOString(),
      }).eq("status", "saving").select().maybeSingle());
      return ready || checked(await db.from("design_extract_jobs").select("*").eq("id", job.id).single());
    }
    const batch = whiteOutput || productionOutput ? null : recordedOnly ? { masks: job.result?.cutoutBatch?.masks || [], missing: job.result?.cutoutBatch?.missing || [] }
      : automatic ? await advanceAutomaticMasks(job, { readAsset, uploadToR2, key: `${prefix(project)}${job.id}/mask-preview` }) : null;
    if (batch?.waiting) return batch.waiting;
    if (production) {
      const checkpoint = async (values, previous = productionOutput) => {
        let update = updateJob(job, { ...values, updated_at: new Date().toISOString() }).eq("status", "saving");
        if (previous) {
          update = update.eq("result->productionOutput->>nextIndex", String(previous.nextIndex));
          update = previous.retry ? update.eq("result->productionOutput->retry->>stage", previous.retry.stage)
            : update.is("result->productionOutput->retry", null);
        } else update = update.is("result->productionOutput", null).is("result->backgroundFill", null);
        return checked(await update.select().maybeSingle());
      };
      return await advanceProductionLayers(project, job, batch, { readAsset, uploadToR2, prefix, checkpoint });
    }
    const { data } = automatic ? {} : await fal.queue.result(job.model, { requestId: job.request_id });
    if (data?.has_nsfw_concepts?.some(Boolean)) fail("The provider could not process this design", 422);
    if (automatic && job.model === REFINE_MODEL) {
      const layers = [...(whiteOutput ? job.result.layers : [])];
      const missing = [...(whiteOutput ? job.result.missing : batch.missing)];
      const targets = whiteOutput?.targets || [{ target: guidedCutout(job), requestId: job.request_id }, ...batch.masks];
      const offset = whiteOutput?.nextIndex ?? 0;
      const nextIndex = Math.min(targets.length, offset + 3);
      const done = nextIndex === targets.length;
      const { width, height } = project.manifest;
      for (let index = offset; index < nextIndex; index++) {
        const { target, requestId } = targets[index];
        let rendered;
        try {
          const response = await fal.queue.result(job.model, { requestId });
          const image = response.data?.images?.[0];
          if (image?.url && !response.data.has_nsfw_concepts?.some(Boolean)) {
            rendered = await renderWhiteElement(await readAsset(image.url, true), target, width, height, layers.length);
          }
        } catch (error) {
          if (![400, 404, 410, 413, 422].includes(error.status) && error.name !== "ValidationError") throw error;
        }
        if (!rendered) { missing.push(target.name); continue; }
        const id = job.id + "-element-" + (index + 1);
        const url = await uploadToR2(rendered.bytes, `${prefix(project)}${job.id}/element-${index + 1}.png`, "image/png");
        layers.push({ ...rendered.layer, id, url, maskBaseUrl: url, maskSourceUrl: url });
      }
      const update = updateJob(job, {
        status: done ? layers.length ? "ready" : "failed" : "saving",
        error: done && !layers.length ? "No usable elements on white were returned." : null,
        result: {
          layers: arrangeOverview(layers, project.manifest), missing, replaceExtraction: true,
          ...(!done && { whiteOutput: { nextIndex, targets } }),
        },
        updated_at: new Date().toISOString(),
      }).eq("status", "saving");
      const ready = checked(await (whiteOutput ? update.eq("result->whiteOutput->>nextIndex", String(offset))
        : update.is("result->whiteOutput", null)).select().maybeSingle());
      return ready || checked(await db.from("design_extract_jobs").select("*").eq("id", job.id).single());
    }
    if (job.kind === "refine") {
      const layers = await refinementOptions(await readAsset(job.input.image_url), data?.images, project, job, {
        readAsset: url => readAsset(url, true),
        saveOption: (bytes, index) => uploadToR2(bytes, prefix(project) + job.id + "/option-" + (index + 1) + ".png", "image/png"),
      });
      const ready = checked(await updateJob(job, {
        status: layers.length ? "ready" : "failed", error: layers.length ? null : "No usable refinement previews were returned.",
        result: { layers: arrangeOverview(layers, project.manifest) }, updated_at: new Date().toISOString(),
      }).eq("status", "saving").select().maybeSingle());
      return ready || checked(await db.from("design_extract_jobs").select("*").eq("id", job.id).single());
    }
    const pilot = isQualityPilotJob(job);
    const guided = guidedCutout(job);
    const qualityReview = isQualityReviewJob(job);
    const groupFlatColors = job.model === LAYER_MODEL && job.kind === "extract" && qualityReview;
    const automaticMasks = job.model === LAYER_MODEL || pilot;
    let images = pilot ? data.masks : automaticMasks ? data.individual_masks : data?.images;
    if (job.kind === "segment") {
      // SAM 3 reports a preview separately from the actual mask assets.
      images = job.input?.box_prompts ? data.masks?.slice(0, 1) : data.image?.url ? [data.image] : data.masks?.slice(0, 1);
    }
    if (!automatic && !pilot && !groupFlatColors && (!Array.isArray(images) || !images.length || !automaticMasks && images.length > 4)) fail("Provider returned no usable layers", 422);
    if (!Array.isArray(images)) images = [];
    const parent = project.manifest.layers.find(layer => layer.id === job.layer_id);
    const sourcePixels = guided || automaticMasks || job.kind === "segment" && job.input?.apply_mask === false ? await readAsset(job.input.image_url) : null;
    const layers = [];
    const warnings = new Set();
    let nativeWidth, nativeHeight;
    const capacity = MAX_LAYERS - project.manifest.layers.length + (job.kind === "split" ? 1 : 0);
    let namedMasks, missing, groupedByColor;
    if (batch) missing = [...batch.missing];
    const readMask = url => readAsset(url, true);
    if (pilot) {
      const preview = job.input._desaynclaw.preview;
      const { matches, missing: unmatched } = await matchPilotMasks(data, preview, readMask);
      missing = unmatched;
      namedMasks = matches.map(match => ({ name: match.name, needsReview: match.needsReview,
        nativeCoverage: (width, height) => nativePilotCoverage(match.coverage, preview, width, height),
      }));
      if (!namedMasks.length) fail("The proposed masks missed the artwork. Use Manual cutout to select an element.", 422);
    }
    async function* existingMasks() {
      for (const layer of automatic ? layers : project.manifest.layers) if (layer.guidedElement && layer.guidedMaskUrl) yield await readAsset(layer.guidedMaskUrl);
    }
    async function* automaticOutputs() {
      const masks = [{ target: guided, requestId: job.request_id }, ...batch.masks];
      const targetBoxes = [guided, ...(job.input._desaynclaw.additionalTargets || [])].map(target => target.box);
      for (const { target, requestId } of masks) {
        try {
          const { data } = await fal.queue.result(GUIDED_CUTOUT_MODEL, { requestId });
          if (!data.image?.url || data.has_nsfw_concepts?.some(Boolean)) fail("No usable cutout", 422);
          for await (const rendered of renderGuidedCutout(sourcePixels, await readMask(data.image.url), target, existingMasks(), targetBoxes)) {
            yield { ...rendered, index: layers.length };
          }
        } catch (error) {
          if (![400, 404, 422].includes(error.status) && error.name !== "ValidationError") throw error;
          missing.push(target.name);
        }
      }
    }
    const outputs = automatic ? automaticOutputs() : guided ? renderGuidedCutout(sourcePixels, await readMask(images[0].url), guided, existingMasks())
      : automaticMasks ? automaticCutouts(sourcePixels, images, { readMask, limit: capacity, warnings, namedMasks, groupFlatColors }) : images.map((image, index) => ({ image, index }));
    for await (const output of outputs) {
      if (output.candidate?.groupedByColor) groupedByColor = true;
      const { index } = output;
      let bytes = output.bytes || await readAsset(output.image.url, true);
      if (sourcePixels && !automaticMasks && !guided) bytes = await applySourceMask(sourcePixels, bytes);
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
        layers.push({ id: `${job.id}-${assetId}`, url, maskBaseUrl, maskSourceUrl: sourcePixels && (!automaticMasks || qualityReview) ? job.input.image_url : maskBaseUrl, name: automaticMasks || guided ? output.name : sourcePixels ? "Original artwork cutout" : automaticParts ? `Element ${layers.length + 1}` : `Layer ${index + 1}`, extractionMethod: sourcePixels ? "source-pixels" : "ai-reconstruction", width, height, nativeFrame: { width: info.width, height: info.height, left, top }, visible: true, locked: false, composition, layout: { x: 300 + index % 4 * 260, y: Math.floor(index / 4) * 300, scale: Math.min(220 / width, 250 / height, 1) },
          ...(output.guidedElement && { guidedElement: true, guidedMaskUrl: maskBaseUrl }),
          ...(qualityReview && (output.candidate ? { ...(pilot && { needsReview: output.candidate.needsReview }) } : { remainder: true })),
        });
      }
    }
    if (!layers.length && automatic) fail("No complete graphics could be separated from this artwork.", 422);
    if (!layers.length || pilot && layers.every(layer => layer.remainder)) fail("No visible elements returned. Use Manual cutout to select artwork.", 422);
    if (recordedOnly) warnings.add("Restored cutouts from fal. A filled background was never saved for this request.");
    const result = { layers: arrangeOverview(layers, project.manifest), nativeWidth, nativeHeight, warnings: [...warnings],
      ...((pilot || automatic) && { missing }),
      ...(groupedByColor && { groupedByColor }),
      ...(guided && { replaceGuidedBackground: true }),
      ...(automatic && { replaceExtraction: true }),
    };
    if (recordedOnly) {
      const patch = { status: "ready", result, error: null, updated_at: new Date().toISOString() };
      let ready = await updateJob(job, { ...patch, processor: "local" })
        .eq("status", "failed").eq("error", interruptedCutoutError).select().maybeSingle();
      const oldProcessorConstraint = ready.error?.code === "23514" && ready.error.message?.includes("design_extract_jobs_processor_check");
      if (oldProcessorConstraint && job.processor === "legacy" && job.billing_state === "refunded") {
        const current = await ownedProject(project.id, project.user_id);
        if (current.revision !== job.base_revision || current.manifest.layers.length) {
          fail("Apply database migration 042 to review these cutouts alongside the project's saved layers.", 409);
        }
        // Older watchdogs can accept a ready legacy job. Expose only the fully saved result for an empty project.
        ready = await updateJob(job, patch).eq("status", "failed").eq("error", interruptedCutoutError)
          .eq("processor", "legacy").eq("billing_state", "refunded").select().maybeSingle();
      }
      if (ready.error?.code === "23505") fail("Finish the active extraction before restoring this result.", 409);
      if (!checked(ready)) fail("The recorded extraction changed. Reopen the project before restoring.", 409);
      if (ready.data.processor === "legacy") return acceptRecoveredOperation(project, ready.data);
      return settleDesignBilling(ready.data);
    }
    if (guided) return await prepareGuidedFillJob(project, job, result, { readAsset, uploadToR2, prefix });
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
    if (recordedOnly) throw error;
    if (error.status === 422 || error.name === "ValidationError" || (job.kind === "refine" || isAutomaticSeparationJob(job)) && [400, 403, 404, 410].includes(error.status)) {
      const message = error.designExtractError ? error.message : job.kind === "refine" ? "The provider could not finish this refinement." : "The AI provider could not complete this extraction. Your original artwork is unchanged.";
      console.warn("[Design Extract] Output validation failed", { jobId: job.id, requestId: job.request_id, reason: message });
      return checked(await updateJob(job, { status: "failed", error: message, updated_at: new Date().toISOString() }).in("status", ["queued", "processing", "saving"]).select().single());
    }
    throw error;
  }
}
export async function recoverOperation(project, jobId) {
  const job = checked(await db.from("design_extract_jobs").select("*").eq("id", jobId).eq("project_id", project.id).eq("user_id", project.user_id).eq("status", "failed").maybeSingle());
  if (job?.kind === "refine") fail("Start a new refinement to try again.", 409);
  const restoreCutouts = guidedModeAvailable() && canRestoreRecordedCutouts(job);
  if (job?.billing_state === "refunded" && !restoreCutouts) fail("This operation was refunded. Start a new extraction to continue.", 409);
  if (!job?.request_id) fail("No existing provider result is available to recover.", 404);
  if (job.base_revision !== project.revision) fail("This project changed after extraction. Reload and review the current project before continuing.", 409);
  if (restoreCutouts) return withDesignImageWork(() => advanceOperation(project, job, { recordedOnly: true }));
  if (guidedModeAvailable() && hasRecoverableBackground(job)) {
    if (project.manifest.layers.length) fail("This recovery needs an empty layer list to preserve your saved layers.", 409);
    const ready = await withDesignImageWork(() => recoverRecordedBackground(project, job, { readAsset, uploadToR2, prefix }));
    return acceptRecoveredOperation(project, ready);
  }
  const status = await fal.queue.status(job.model, { requestId: job.request_id, logs: false });
  if (status.status !== "COMPLETED") fail("The existing provider result is not ready to recover. No new generation was submitted.", 409);
  const resumed = await db.from("design_extract_jobs").update({ status: "saving", error: null, updated_at: new Date().toISOString() }).eq("id", job.id).eq("status", "failed").select().maybeSingle();
  if (resumed.error?.code === "23505") fail("Another extraction is active or awaiting review. Finish it before recovering this result.", 409);
  const current = checked(resumed);
  if (!current) fail("This extraction changed. Reload before continuing.", 409);
  return settleOperation(project, current);
}
async function acceptRecoveredOperation(project, ready) {
  if (ready.status === "accepted") return settleDesignBilling(ready);
  if (ready.status !== "ready") fail("The saved output changed during recovery. Reopen the project.", 409);
  try {
    const currentProject = await ownedProject(project.id, project.user_id);
    if (currentProject.revision !== ready.base_revision || currentProject.manifest.layers.length) {
      fail("The project changed during recovery. Reopen it to review the current layers.", 409);
    }
    await reviewOperation(currentProject, ready.id, true);
  } catch (error) {
    const current = checked(await db.from("design_extract_jobs").select("*").eq("id", ready.id).eq("user_id", project.user_id).single());
    if (current.status === "accepted") return settleDesignBilling(current);
    throw error;
  }
  return settleDesignBilling({ ...ready, status: "accepted" });
}
function canRestoreRecordedCutouts(job) {
  return job?.status === "failed" && job.error === interruptedCutoutError && isAutomaticSeparationJob(job) &&
    job.model === GUIDED_CUTOUT_MODEL && Boolean(job.request_id && guidedCutout(job)) && !job.result?.backgroundFill;
}
export async function snapshot(project, advance = false) {
  const jobs = checked(await db.from("design_extract_jobs").select("*").eq("project_id", project.id).order("created_at", { ascending: false }).limit(1));
  let job = jobs[0] ? advance && jobs[0].processor !== "workflow" ? await settleOperation(project, jobs[0]) : jobs[0] : null;
  if (advance && job?.processor !== "workflow" && job?.status === "ready" &&
    (canAutoAcceptNanoLayers(job, project) || job.kind === "refine" || job.kind === "extract" && !isQualityReviewJob(job) && !isAutomaticSeparationJob(job))) {
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
  const guidedCutouts = guidedModeAvailable();
  if (guidedCutouts && job?.status === "failed" && job.error === interruptedCutoutError &&
      (isAutomaticSeparationJob(job) || guidedCutout(job))) {
    if (project.manifest.layers.some(layer => layer.filledGuidedBackground) && job.base_revision !== project.revision) {
      job = null;
    } else if (!project.manifest.layers.length && job.base_revision === project.revision) {
      const recoverable = hasRecoverableBackground(job) ? job : checked(await db.from("design_extract_jobs").select("*")
        .eq("project_id", project.id).eq("user_id", project.user_id).eq("base_revision", project.revision)
        .eq("status", "failed").eq("error", interruptedCutoutError).neq("billing_state", "refunded")
        .eq("result->backgroundFill->>stage", "queued").order("created_at", { ascending: false }).limit(1).maybeSingle());
      if (hasRecoverableBackground(recoverable)) job = { ...job, recordedBackgroundJobId: recoverable.id };
    }
    if (job && canRestoreRecordedCutouts(job) && job.base_revision === project.revision && !job.recordedBackgroundJobId) {
      job = { ...job, recordedCutoutJobId: job.id };
    }
  }
  const qualityReview = qualityReviewAvailable() && designProcessingDriver() === "legacy";
  const refinement = isRefinementProject(project);
  const billing = await designBillingQuote(project.user_id, refinement);
  if (refinement && !await designRefineAvailable()) {
    billing.prices = { ...billing.prices };
    delete billing.prices.refine;
  }
  return {
    project, job, billing,
    ...(!refinement && { extractionComplete: Boolean(project.manifest.layers.length ||
      job?.kind === "extract" && job.status === "accepted" || await hasAcceptedExtraction(project)) }),
    qualityReview, qualityPilot: qualityReview && qualityPilotAvailable(), guidedCutouts, nanoExtraction: productionNanoAvailable(),
  };
}
export async function reconcileSubmission(project, jobId, requestId) {
  if (typeof requestId !== "string" || !/^[a-zA-Z0-9-]{10,100}$/.test(requestId)) fail("Enter the request ID from fal history");
  const job = checked(await db.from("design_extract_jobs").select("*").eq("project_id", project.id).eq("id", jobId).eq("status", "submitting").maybeSingle());
  if (!job) fail("Submission no longer needs reconciliation", 409);
  await fal.queue.status(job.model, { requestId, logs: false });
  return checked(await db.from("design_extract_jobs").update({ request_id: requestId, status: "queued", updated_at: new Date().toISOString() }).eq("id", job.id).eq("status", "submitting").select().single());
}
function refinementManifest(project, job) {
  const existing = project.manifest.layers.some(layer => layerVisible(layer, "composition"));
  const activeIds = new Set(project.manifest.layers.map(layer => layer.id));
  const options = job.result.layers.filter(layer => !activeIds.has(layer.id)).map((layer, index) => ({
    ...layer, visibility: { overview: true, composition: !existing && index === 0 },
  }));
  if (project.manifest.layers.length + options.length > MAX_LAYERS) fail("Make room for the refinement options first.", 409);
  const manifest = acceptLayers(project.manifest, { ...job, result: { layers: options } });
  return { ...manifest, latestRefinementBatchId: job.id };
}

export async function restoreRefinementOptions(project, jobId, revision) {
  if (!isRefinementProject(project) || revision !== project.revision) fail("Project changed. Reload before restoring options.", 409);
  const job = checked(await db.from("design_extract_jobs").select("*").eq("project_id", project.id)
    .eq("user_id", project.user_id).order("created_at", { ascending: false }).limit(1).maybeSingle());
  if (job?.id !== jobId || job?.status !== "accepted" || job?.kind !== "refine" || !job?.result?.layers?.length) fail("Saved options are unavailable.", 404);
  if (project.manifest.latestRefinementBatchId === jobId) return project;
  const manifest = refinementManifest(project, job);
  const saved = checked(await db.from("design_extract_projects").update({ manifest, revision: revision + 1, updated_at: new Date().toISOString() })
    .eq("id", project.id).eq("user_id", project.user_id).eq("revision", revision).select().maybeSingle());
  if (!saved) fail("Project changed. Reload before restoring options.", 409);
  return saved;
}

export async function reviewOperation(project, jobId, accept, versions = {}, draftId) {
  const job = checked(await db.from("design_extract_jobs").select("*").eq("project_id", project.id).eq("id", jobId).single());
  if (job.status !== "ready") fail("Operation is not ready for review", 409);
  if (job.kind === "refine") {
    if (job.base_revision !== project.revision) fail("Project changed. Reopen before choosing an option.", 409);
    await settleDesignBilling(job);
    const next = accept ? refinementManifest(project, job) : project.manifest;
    return checked(await db.rpc("review_design_extract", { target_project: project.id, target_user: project.user_id, target_job: jobId, expected_revision: project.revision, next_manifest: next, accepted: accept }));
  }
  if (accept && (isQualityReviewJob(job) || guidedCutout(job)) && job.base_revision !== project.revision) fail("Project changed. Discard the old suggestion before starting another extraction.", 409);
  // Commit project and job together; revision prevents concurrent edits or double acceptance.
  if (draftId && !isQualityReviewJob(job)) fail("No draft for this operation", 409);
  const result = draftId && accept ? await readQualityDraft(project, job, draftId) : job.result;
  if (!versions || typeof versions !== "object" || Array.isArray(versions) || Object.entries(versions).some(([id, version]) => !result?.layers.some(layer => layer.id === id) || !["base", "enhanced"].includes(version))) fail("Invalid layer versions");
  const reviewed = { ...job, result: { ...result, layers: result?.layers.map(({ reviewBase: _base, ...layer }) => selectVariant(layer, versions[layer.id])) } };
  const manifest = accept ? acceptLayers(project.manifest, reviewed) : project.manifest;
  return checked(await db.rpc("review_design_extract", { target_project: project.id, target_user: project.user_id, target_job: jobId, expected_revision: project.revision, next_manifest: manifest, accepted: accept }));
}

export async function reviseQualityReview(project, body) {
  if (process.env.NODE_ENV !== "development" || process.env.VERCEL) fail("Local review tools are unavailable", 404);
  if (body.revision !== project.revision) fail("Project changed. Reload before editing suggestions.", 409);
  const job = checked(await db.from("design_extract_jobs").select("*").eq("project_id", project.id).eq("user_id", project.user_id).eq("id", body.jobId).eq("status", "ready").maybeSingle());
  if (!isQualityReviewJob(job) || job.base_revision !== project.revision) fail("This extraction is no longer available for review.", 409);
  return withDesignImageWork(async () => {
    const wand = async source => {
      const { width, height } = project.manifest;
      const { box, points } = selectionInput(body, { width, height });
      const { tolerance } = body;
      if (!box || !points.some(point => point.label === 1 && point.x >= box.left && point.x <= box.right && point.y >= box.top && point.y <= box.bottom)) fail("Draw a box and sample an Include color inside it.");
      if (!Number.isInteger(tolerance) || tolerance < 0 || tolerance > 100) fail("Choose a color tolerance from 0 to 100.");
      const result = await renderColorWand(source, { box, points, tolerance, width, height });
      if (!result) fail("No pixels matched. Adjust your Include points or tolerance.", 422);
      return result;
    };
    if (body.edit === "wand-preview") {
      const result = await wand(await readAsset(job.input.image_url));
      return sharp(result.trimmed).resize(360, 360, { fit: "inside", withoutEnlargement: true }).png().toBuffer();
    }
    const draft = await editQualityDraft(project, job, body, readAsset, wand);
    return { job: { ...job, result: draft.result }, draftId: draft.draftId };
  });
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
