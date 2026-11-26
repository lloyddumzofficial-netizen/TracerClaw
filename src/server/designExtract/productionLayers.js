import sharp from "sharp";
import { fal } from "@fal-ai/client";
import { arrangeOverview } from "@/lib/designExtractLayout";
import { DESIGN_IMAGE_MAX_PIXELS } from "@/lib/designExtractImagePolicy";
import { prepareAutomaticMask } from "./automaticSeparation";
import { GUIDED_CUTOUT_MODEL, guidedCutout, renderGuidedCutout } from "./guidedCutout";
import { submitDesignOperation } from "./submission";
import { separateElements } from "./separateElements";

export const isProductionSeparation = job => job.input?._desaynclaw?.productionLayers === true;
const rejected = error => [400, 404, 410, 413, 422].includes(error.status) || error.name === "ValidationError";
const overlaps = (box, layer) => {
  const { left, top } = layer.nativeFrame;
  return box.left < left + layer.width && box.left + box.width > left &&
    box.top < top + layer.height && box.top + box.height > top;
};

function tighterTarget(target, width, height) {
  const tight = target.tightBox;
  if (!tight) return null;
  const margin = Math.max(2, Math.round(Math.min(tight.width, tight.height) * .035));
  const left = Math.max(0, tight.left - margin), top = Math.max(0, tight.top - margin);
  const box = {
    left, top,
    width: Math.min(width, tight.left + tight.width + margin) - left,
    height: Math.min(height, tight.top + tight.height + margin) - top,
  };
  return box.width >= target.box.width && box.height >= target.box.height ? null : { ...target, box };
}

export async function advanceProductionLayers(project, job, batch, { readAsset, uploadToR2, prefix, checkpoint }) {
  const prior = job.result?.productionOutput;
  const planned = job.input._desaynclaw.additionalTargets || [];
  const primary = guidedCutout(job);
  const targets = prior?.targets || [{ target: primary, requestId: job.request_id }, ...batch.masks];
  const offset = prior?.nextIndex || 0;
  const entry = targets[offset];
  const retry = prior?.retry;
  const layers = [...(prior ? job.result.layers : [])];
  const missing = [...(prior ? job.result.missing : batch.missing)];
  const { width, height } = project.manifest;
  const key = `${prefix(project)}${job.id}/production-${offset + 1}`;
  const write = (output, extra = {}) => checkpoint({
    result: { layers, missing, replaceExtraction: true, nativeWidth: width, nativeHeight: height, ...output },
    ...extra,
  });
  if (retry?.stage === "submitting" && Date.now() - retry.startedAt < 75_000) return job;
  if (retry?.stage === "queued") {
    try {
      const { status } = await fal.queue.status(GUIDED_CUTOUT_MODEL, { requestId: retry.requestId, logs: false });
      if (!["COMPLETED", "FAILED", "CANCELLED"].includes(status)) return job;
    } catch (error) { if (!rejected(error)) throw error; }
  }

  const source = await readAsset(job.input.image_url);
  const target = retry?.target || entry.target;
  const requestId = retry?.requestId || entry.requestId;
  let rendered, invalidMask = false;
  if (retry?.stage !== "submitting") {
    try {
      const { data } = await fal.queue.result(GUIDED_CUTOUT_MODEL, { requestId });
      if (data?.image?.url && !data.has_nsfw_concepts?.some(Boolean)) {
        async function* existingMasks() {
          for (const layer of layers) if (overlaps(target.box, layer)) yield await readAsset(layer.guidedMaskUrl);
        }
        const mask = await readAsset(data.image.url, true);
        try {
          for await (const output of renderGuidedCutout(source, mask, target,
            existingMasks(), [primary, ...planned].filter(item => item.name !== target.name).map(item => item.box))) {
            rendered = output.bytes;
          }
        } catch (error) {
          if (error.status !== 422 || !error.designExtractError) throw error;
          invalidMask = true;
        }
      }
    } catch (error) { if (!rejected(error)) throw error; }
  }
  const tighter = invalidMask && !retry && tighterTarget(target, width, height);
  if (tighter) {
    const prepared = await prepareAutomaticMask(source, tighter, key + "-retry-input.png", uploadToR2);
    const claimed = await write({ productionOutput: { targets, nextIndex: offset, retry: { stage: "submitting", startedAt: Date.now(), target: prepared.target } } });
    if (!claimed) return job;
    const next = claimed.result.productionOutput;
    let receipt;
    try { receipt = await submitDesignOperation(GUIDED_CUTOUT_MODEL, { input: prepared.input }); }
    catch { return claimed; }
    return await checkpoint({ result: { ...claimed.result, productionOutput: { ...next, retry: { ...next.retry, stage: "queued", requestId: receipt.request_id } } } }, next) || claimed;
  }
  if (rendered) {
    const image = sharp(rendered, { limitInputPixels: DESIGN_IMAGE_MAX_PIXELS });
    const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
    const [{ bounds }] = separateElements(data, width, height, 1);
    const { left, top } = bounds;
    const trimmed = await sharp(data, { raw: info }).extract(bounds).png().toBuffer();
    const url = await uploadToR2(trimmed, key + ".png", "image/png");
    const guidedMaskUrl = await uploadToR2(rendered, key + "-mask.png", "image/png");
    layers.push({
      id: `${job.id}-production-${offset + 1}`, name: target.name, url, guidedMaskUrl, guidedElement: true,
      maskBaseUrl: guidedMaskUrl, maskSourceUrl: job.input.image_url, extractionMethod: "source-pixels",
      width: bounds.width, height: bounds.height, nativeFrame: { width, height, left, top },
      visible: true, locked: false, composition: { x: left, y: top, scale: 1 }, layout: { x: 0, y: 0, scale: 1 },
    });
  } else missing.push(target.name);

  const nextIndex = offset + 1;
  const arranged = arrangeOverview(layers, project.manifest);
  if (nextIndex < targets.length) return await write({ layers: arranged, productionOutput: { targets, nextIndex } }) || job;
  if (!layers.length) return await write({}, { status: "failed", error: "No complete graphics could be separated from this artwork." }) || job;
  return await write({ layers: arranged, backgroundFill: { stage: "preparing" } }) || job;
}
