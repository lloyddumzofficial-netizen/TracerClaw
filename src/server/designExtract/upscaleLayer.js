import { createHash } from "node:crypto";
import sharp from "sharp";
import { adminSupabase as db } from "@/lib/supabase";
import { designRateLimit as enforceRateLimit } from "./rateLimit";
import { ownedProject, readAsset, prefix, fail } from "./service";
import { enhancementPlan, restoreEnhancedAlpha, enhancedLayer } from "./enhancement";
import { ENHANCE_MODEL, submitEnhancement } from "./enhancementProvider";
import { uploadDesignAsset, readPrivateDesignAsset, designAssetUrl, ownsPrivateDesignAsset } from "./storage";
import { DESIGN_IMAGE_MAX_PIXELS } from "@/lib/designExtractImagePolicy";
import { withDesignImageWork } from "./imageWork";
import { alreadyUpscaled } from "@/lib/designLayerTypes";
import { layerUpscaleAvailability, recraftResultPlan } from "@/lib/designExtractUpscalePolicy";
import { claimFinishAction, confirmedFinishRejection, finishReceiptExpired, settleFinishAction, trackFinishAction } from "./finishBilling";

export { alreadyUpscaled };
const missing = error => error?.name === "NoSuchKey" || error?.$metadata?.httpStatusCode === 404;
const conflict = error => error?.name === "PreconditionFailed" || error?.$metadata?.httpStatusCode === 412;
async function idle(project) {
  const result = await db.from("design_extract_jobs").select("id").eq("project_id", project.id).in("status", ["submitting", "queued", "processing", "saving", "ready"]).limit(1);
  if (result.error) throw result.error;
  if (result.data.length) fail("Finish the active extraction before upscaling this image.", 409);
}
export async function upscaleDesignLayer(project, layerId, revision, acknowledgedClaws) {
  const layer = project.manifest.layers.find(item => item.id === layerId);
  if (!layer || layer.kind === "svg" || !ownsPrivateDesignAsset(layer.url,project.user_id)) fail("Select a raster image layer.");
  if (alreadyUpscaled(layer)) fail("This image is already upscaled.", 409);
  if(layer.locked)fail("Unlock this image before upscaling.",409);
  if (revision !== project.revision) fail("Project changed. Reload before upscaling.", 409);
  const plan = enhancementPlan(layer.width, layer.height);
  if (!plan) fail(layerUpscaleAvailability(layer).reason, 422);
  await idle(project);
  // Keyed by layer identity, not its current version: masks and refreshes must
  // never permit a second billable upscale of the same layer.
  const key = `${prefix(project)}upscale/${createHash("sha256").update(layer.id).digest("hex")}`;
  let record;
  try { record = JSON.parse((await readPrivateDesignAsset(`r2-private://design-extract/${key}.json`, 16384)).toString("utf8")); }
  catch (error) { if (!missing(error)) throw error; }
  const retry = record?.state === "failed";
  if (retry) await settleFinishAction(project, record.finishActionId, false);
  if (!record || retry) {
    if (!process.env.RECRAFT_API_KEY) fail("Image upscaling is not configured.", 503);
    const limit = await enforceRateLimit({ namespace: "design-extract:upscale", identifier: project.user_id, max: 3, window: "60 s", windowMs: 60000 });
    if (!limit.success) fail("Too many upscale requests. Try again in a minute.", 429);
    const source = await readAsset(layer.url);
    const rgb = await withDesignImageWork(() => sharp(source, { limitInputPixels: DESIGN_IMAGE_MAX_PIXELS }).removeAlpha().png().toBuffer());
    const inputVersion = createHash("sha256").update(layer.url).digest("hex");
    const finishActionId = await claimFinishAction(project, layerId, "upscale", acknowledgedClaws);
    if (retry && !finishActionId) fail("The previous upscale could not be completed.", 422);
    record = { state: "submitting", createdAt: new Date().toISOString(), sourceUrl: layer.url, plan, model: ENHANCE_MODEL, ...(finishActionId && { finishActionId }) };
    let signedInputUrl;
    try {
      await trackFinishAction(project, finishActionId, `${key}.json`);
      const inputUrl = await uploadDesignAsset(rgb, `${key}-${inputVersion}-input.png`, "image/png");
      signedInputUrl = await designAssetUrl(inputUrl);
      await uploadDesignAsset(Buffer.from(JSON.stringify(record)), `${key}.json`, "application/json", { ifAbsent: !retry });
    }
    catch (error) {
      await settleFinishAction(project, finishActionId, false);
      if (conflict(error)) fail("An upscale was already requested for this image. No duplicate request was sent.", 409);
      throw error;
    }
    try {
      const result = await submitEnhancement({ image_url: signedInputUrl });
      record = { ...record, state: "generated", outputUrl: result.image_url, units: result.units };
      await uploadDesignAsset(Buffer.from(JSON.stringify(record)), `${key}.json`, "application/json");
    } catch (error) {
      if (finishActionId && confirmedFinishRejection(error.status)) {
        await uploadDesignAsset(Buffer.from(JSON.stringify({ ...record, state: "failed" })), `${key}.json`, "application/json");
        await settleFinishAction(project, finishActionId, false);
        fail("Recraft could not upscale this image.", 422);
      }
      fail("The upscale could not be confirmed. Your image is unchanged and no duplicate request will be sent.", 502);
    }
  }
  if (record.sourceUrl !== layer.url) fail("This layer changed after its upscale request. The saved request cannot be repeated.", 409);
  if (record.state === "submitting") fail("An upscale was already requested for this image. It is running or needs recovery; no duplicate request was sent.", 409);
  if (record.state === "generated") {
    if (await finishReceiptExpired(record)) fail("The upscale result expired before it could be saved.", 410);
    const [source, output] = await Promise.all([readAsset(layer.url), readAsset(record.outputUrl, true)]);
    const { width, height } = await sharp(output, { limitInputPixels: DESIGN_IMAGE_MAX_PIXELS }).metadata();
    const actualPlan = recraftResultPlan(layer.width, layer.height, width, height);
    if (!actualPlan) {
      if (record.finishActionId) {
        await uploadDesignAsset(Buffer.from(JSON.stringify({ ...record, state: "failed" })), `${key}.json`, "application/json");
        await settleFinishAction(project, record.finishActionId, false);
      }
      fail("Recraft returned invalid size or framing. Your original image is available.", 422);
    }
    const png = await withDesignImageWork(() => restoreEnhancedAlpha(source, output, actualPlan));
    const url = await uploadDesignAsset(png, `${key}.png`, "image/png");
    record = { ...record, state: "ready", url, plan: actualPlan };
    await uploadDesignAsset(Buffer.from(JSON.stringify(record)), `${key}.json`, "application/json");
  }
  if (record.state !== "ready") fail("The saved upscale is unavailable.", 409);
  await settleFinishAction(project, record.finishActionId, true);
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await ownedProject(project.id, project.user_id);
    const original = current.manifest.layers.find(item => item.id === layerId);
    if (alreadyUpscaled(original)) fail("This image is already upscaled.", 409);
    if (!original || original.url !== record.sourceUrl || original.locked) fail("The layer changed. Your upscale is saved; reload before continuing.", 409);
    await idle(current);
    const next = { ...enhancedLayer(original, record.url, record.plan, record.model), upscale: { state: "done", model: record.model, sourceUrl: record.sourceUrl } };
    const manifest = { ...current.manifest, layers: current.manifest.layers.map(item => item.id === layerId ? next : item) };
    const saved = await db.from("design_extract_projects").update({ manifest, revision: current.revision + 1, updated_at: new Date().toISOString() }).eq("id", current.id).eq("user_id", current.user_id).eq("revision", current.revision).select().maybeSingle();
    if (saved.error) throw saved.error;
    if (saved.data) return { project: saved.data };
  }
  fail("Project changed. Retry to apply the saved upscale without generating again.", 409);
}
