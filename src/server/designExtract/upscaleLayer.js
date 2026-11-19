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
import { layerUpscaleAvailability } from "@/lib/designExtractUpscalePolicy";

export { alreadyUpscaled };
const missing = error => error?.name === "NoSuchKey" || error?.$metadata?.httpStatusCode === 404;
const conflict = error => error?.name === "PreconditionFailed" || error?.$metadata?.httpStatusCode === 412;
async function idle(project) {
  const result = await db.from("design_extract_jobs").select("id").eq("project_id", project.id).in("status", ["submitting", "queued", "processing", "saving", "ready"]).limit(1);
  if (result.error) throw result.error;
  if (result.data.length) fail("Finish the active extraction before upscaling this image.", 409);
}
export async function upscaleDesignLayer(project, layerId, revision) {
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
  if (!record) {
    if (!process.env.RECRAFT_API_KEY) fail("Image upscaling is not configured.", 503);
    const limit = await enforceRateLimit({ namespace: "design-extract:upscale", identifier: project.user_id, max: 3, window: "60 s", windowMs: 60000 });
    if (!limit.success) fail("Too many upscale requests. Try again in a minute.", 429);
    record = { state: "submitting", sourceUrl: layer.url, plan, model: ENHANCE_MODEL };
    try { await uploadDesignAsset(Buffer.from(JSON.stringify(record)), `${key}.json`, "application/json", { ifAbsent: true }); }
    catch (error) { if (conflict(error)) fail("An upscale was already requested for this image. No duplicate request was sent.", 409); throw error; }
    try {
      const source = await readAsset(layer.url);
      const rgb = await withDesignImageWork(() => sharp(source,{limitInputPixels:DESIGN_IMAGE_MAX_PIXELS}).removeAlpha().png().toBuffer());
      const inputUrl = await uploadDesignAsset(rgb, `${key}-input.png`, "image/png");
      const result = await submitEnhancement({ image_url: await designAssetUrl(inputUrl) });
      record = { ...record, state: "generated", outputUrl: result.image_url, units: result.units };
      await uploadDesignAsset(Buffer.from(JSON.stringify(record)), `${key}.json`, "application/json");
    } catch { fail("The upscale could not be confirmed. Your image is unchanged and no duplicate request will be sent.", 502); }
  }
  if (record.sourceUrl !== layer.url) fail("This layer changed after its upscale request. The saved request cannot be repeated.", 409);
  if (record.state === "submitting") fail("An upscale was already requested for this image. It is running or needs recovery; no duplicate request was sent.", 409);
  if (record.state === "generated") {
    const [source, output] = await Promise.all([readAsset(layer.url), readAsset(record.outputUrl, true)]);
    const png = await withDesignImageWork(() => restoreEnhancedAlpha(source, output, record.plan));
    const url = await uploadDesignAsset(png, `${key}.png`, "image/png");
    record = { ...record, state: "ready", url };
    await uploadDesignAsset(Buffer.from(JSON.stringify(record)), `${key}.json`, "application/json");
  }
  if (record.state !== "ready") fail("The saved upscale is unavailable.", 409);
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
