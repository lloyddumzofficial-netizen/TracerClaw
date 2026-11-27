import { createHash } from "node:crypto";
import { fal } from "@fal-ai/client";
import sharp from "sharp";
import { adminSupabase as db } from "@/lib/supabase";
import { acceptLayers, MAX_LAYERS } from "@/lib/designExtract";
import { layerVisible } from "@/lib/designLayerTypes";
import { DESIGN_IMAGE_MAX_PIXELS, validateDesignImage } from "@/lib/designExtractImagePolicy";
import { applySourceMask } from "./sourceMask";
import { designRateLimit } from "./rateLimit";
import { designAssetUrl, ownsPrivateDesignAsset, readPrivateDesignAsset, uploadDesignAsset } from "./storage";
import { fail, prefix, readAsset } from "./service";
import { withDesignImageWork } from "./imageWork";
import { BACKGROUND_REMOVAL_MODEL, submitDesignOperation } from "./submission";

const missing = error => error.name === "NoSuchKey" || error.$metadata?.httpStatusCode === 404;

async function requireIdle(project) {
  const { data, error } = await db.from("design_extract_jobs").select("id").eq("project_id", project.id)
    .in("status", ["submitting", "queued", "processing", "saving", "ready"]).limit(1);
  if (error) throw error;
  if (data.length) fail("Finish the active extraction before removing a background.", 409);
}

export async function removeDesignBackground(project, layerId, revision) {
  const source = project.manifest.layers.find(layer => layer.id === layerId);
  if (!source || source.kind === "svg" || !ownsPrivateDesignAsset(source.url, project.user_id)) fail("Select an image layer.");
  if (source.backgroundRemoval || source.locked) fail("Select an unlocked source image.", 409);
  if (revision !== project.revision) fail("Project changed. Reload before removing the background.", 409);
  const key = createHash("sha256").update(JSON.stringify([source.id, source.url])).digest("hex");
  const id = `cutout-${key.slice(0, 32)}`;
  if (project.manifest.layers.some(layer => layer.id === id)) return { project, layerId: id };
  if (project.manifest.layers.length >= MAX_LAYERS) fail("Make room for a cutout. Maximum 32 layers.", 409);
  await requireIdle(project);

  const assetKey = `${prefix(project)}background-removal/${key}`;
  const receiptKey = `${assetKey}.json`;
  const saveReceipt = (record, options) => uploadDesignAsset(Buffer.from(JSON.stringify(record)), receiptKey, "application/json", options);
  let receipt;
  try {
    const bytes = await readPrivateDesignAsset(`r2-private://design-extract/${receiptKey}`, 16384);
    receipt = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    if (!missing(error)) throw error;
  }
  if (!receipt) {
    if (!process.env.FAL_KEY) fail("Background removal is not configured.", 503);
    const minute = await designRateLimit({ namespace: "design-extract:remove-bg", identifier: project.user_id, max: 3, window: "60 s", windowMs: 60000 });
    if (!minute.success) fail("Background removal limit reached. Try again in a minute.", 429);
    const daily = await designRateLimit({ namespace: "design-extract:remove-bg-daily", identifier: project.user_id, max: 12, window: "1 d", windowMs: 86400000 });
    if (!daily.success) fail("Daily background removal limit reached. Try again later.", 429);
    const imageUrl = await designAssetUrl(source.url, 3600);
    try {
      await saveReceipt({ createdAt: Date.now() }, { ifAbsent: true });
    } catch (error) {
      if (error.name === "PreconditionFailed" || error.$metadata?.httpStatusCode === 412) return { pending: true };
      throw error;
    }
    try {
      const { request_id } = await submitDesignOperation(BACKGROUND_REMOVAL_MODEL, { input: {
        image_url: imageUrl, model: "General Use (Light)", operating_resolution: "1024x1024",
        output_format: "png", refine_foreground: false,
      } });
      receipt = { requestId: request_id };
      await saveReceipt(receipt);
    } catch (error) {
      if ([400, 413, 422].includes(error.status)) {
        await saveReceipt({ failed: true });
        fail("BiRefNet could not process this image.", 422);
      }
      fail("Could not confirm background removal. Check this layer again shortly.", 502);
    }
  }
  if (receipt.failed) fail("Background removal was unsuccessful for this image.", 422);
  if (!receipt.requestId) {
    if (Date.now() - receipt.createdAt < 60_000) return { pending: true };
    fail("Could not confirm background removal for this image.", 502);
  }
  if (!receipt.url) {
    const options = { requestId: receipt.requestId };
    let data;
    try {
      const status = await fal.queue.status(BACKGROUND_REMOVAL_MODEL, options);
      if (["IN_QUEUE", "IN_PROGRESS"].includes(status.status)) return { pending: true };
      ({ data } = await fal.queue.result(BACKGROUND_REMOVAL_MODEL, options));
    } catch (error) {
      if ([400, 404, 410, 422].includes(error.status)) {
        await saveReceipt({ failed: true });
        fail("The background removal result was unavailable.", 422);
      }
      throw error;
    }
    if (!data?.image?.url) fail("BiRefNet returned no cutout.", 422);
    const [original, output] = await Promise.all([readAsset(source.url), readAsset(data.image.url, true)]);
    const cutout = await withDesignImageWork(async () => {
      const image = sharp(output, { limitInputPixels: DESIGN_IMAGE_MAX_PIXELS });
      const meta = await image.metadata();
      validateDesignImage(meta);
      if (!meta.hasAlpha || Math.abs(meta.width / meta.height / (source.width / source.height) - 1) > .02) {
        fail("The cutout did not match the source image.", 422);
      }
      const mask = await image.extractChannel("alpha").resize(source.width, source.height, { fit: "fill" }).png().toBuffer();
      const { min, max } = (await sharp(mask).stats()).channels[0];
      if (min >= 250 || max <= 5) fail("BiRefNet could not separate a usable foreground.", 422);
      return applySourceMask(original, mask);
    });
    receipt.url = await uploadDesignAsset(cutout, `${assetKey}.png`, "image/png");
    await saveReceipt(receipt);
  }

  const { width, height } = source;
  const visible = layerVisible(source);
  const layer = {
    id, name: `${source.name.slice(0, 88)} · Cutout`, width, height, url: receipt.url,
    backgroundRemoval: true, extractionMethod: "source-pixels",
    maskSourceUrl: source.url, maskBaseUrl: receipt.url,
    nativeFrame: { width, height, left: 0, top: 0 },
    layout: { x: 0, y: 0, scale: 1 }, composition: { x: 0, y: 0, scale: 1 },
    visible, locked: false,
    visibility: { overview: true, composition: visible },
  };
  await requireIdle(project);
  const manifest = acceptLayers(project.manifest, { kind: "segment", layer_id: source.id, result: { layers: [layer] } });
  manifest.layers = manifest.layers.map(item => item.id === source.id ? {
    ...item, visible: false, visibility: { overview: layerVisible(item, "layout"), composition: false },
  } : item);
  const saved = await db.from("design_extract_projects").update({ manifest, revision: revision + 1, updated_at: new Date().toISOString() })
    .eq("id", project.id).eq("user_id", project.user_id).eq("revision", revision).gt("expires_at", new Date().toISOString()).select().maybeSingle();
  if (saved.error) throw saved.error;
  if (!saved.data) fail("Project changed. Reload and click Remove background to apply the saved cutout.", 409);
  return { project: saved.data, layerId: id };
}
