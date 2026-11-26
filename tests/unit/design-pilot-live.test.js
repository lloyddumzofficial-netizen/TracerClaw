import { test, expect } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { setTimeout as wait } from "node:timers/promises";
import sharp from "sharp";
import { LAYER_MODEL } from "@/lib/designExtract";
import { automaticCutouts } from "@/server/designExtract/automaticCutouts";
import { createPilotPreview, locatePilotRegions, matchPilotMasks, nativePilotCoverage, pilotMaskRequest, PILOT_MASK_MODEL } from "@/server/designExtract/qualityPilot";
import { pilotCase, measurePilotMask } from "../fixtures/design-pilot-cases";

const bria = "bria/guided-remove-background", nano = "google/nano-banana-2.1/edit";
const budget = 2;
const reserve = { baseline: .045, pilot: .016, bria: .03, nano: .08 };
const directory = "output/design-extract-quality";
const headers = () => ({ Authorization: `Key ${process.env.FAL_KEY}`, "Content-Type": "application/json" });
async function json(url, options = {}) {
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(25_000), ...options });
  if (!response.ok) throw Object.assign(new Error(`Provider HTTP ${response.status}`), { status: response.status });
  return response.json();
}
async function queue(model, input, report) {
  const receipt = await json(`https://queue.fal.run/${model}`, { method: "POST",
    headers: { ...headers(), "X-Fal-Request-Start-Timeout": "45", "X-Fal-Store-IO": "0", "x-app-fal-disable-fallback": "true" }, body: JSON.stringify(input) });
  if (!/^[a-zA-Z0-9-]{8,120}$/.test(receipt.request_id)) throw new Error("Invalid provider receipt");
  report.requestId = receipt.request_id;
  const request = `https://queue.fal.run/${model.split("/").slice(0, 2).join("/")}/requests/${receipt.request_id}`;
  for (let attempt = 0; attempt < 36; attempt++) {
    const status = await json(request + "/status", { headers: headers() });
    if (status.status === "COMPLETED") {
      report.seconds = status.metrics?.inference_time;
      return json(request, { headers: headers() });
    }
    await wait(2200);
  }
  throw new Error("Timed out checking the recorded provider request");
}
async function maskBytes(url) {
  if (!/^https:\/\/[^/]+\.fal\.media\//.test(url)) throw new Error("Unexpected test asset host");
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(15_000) });
  if (!response.ok || Number(response.headers.get("content-length")) > 12 * 1024 * 1024) throw new Error("Could not read test asset");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 12 * 1024 * 1024) throw new Error("Test asset exceeds size limit");
  return bytes;
}
const alpha = bytes => sharp(bytes).ensureAlpha().extractChannel(3).raw().toBuffer();
const median = values => {
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
function summarize(records) {
  const cost = records.reduce((sum, row) => sum + row.cost, 0);
  const usable = records.filter(row => row.metrics?.iou >= .90 && row.metrics?.boundary >= .85 && row.metrics.grouped !== false).length;
  const scored = records.filter(row => row.method !== "nano");
  const words = scored.filter(row => row.metrics?.grouped !== null && /wordmark|fine-text/.test(row.name));
  return { cases: records.length, usable, cost, costPerUsableLayer: usable ? cost / usable : null,
    medianIoU: scored.length ? median(scored.map(row => row.metrics?.iou || 0)) : null,
    medianBoundary: scored.length ? median(scored.map(row => row.metrics?.boundary || 0)) : null,
    groupedWordmarks: words.length ? words.filter(row => row.metrics?.grouped).length / words.length : null };
}

test.skipIf(process.env.DESIGN_PILOT_LIVE !== "1")("benchmarks local synthetic artwork within the configured provider budget", async () => {
  expect(Boolean(process.env.FAL_KEY && process.env.GEMINI_API_KEY)).toBe(true);
  const models = [LAYER_MODEL, PILOT_MASK_MODEL, bria, nano];
  const prices = await json("https://api.fal.ai/v1/models/pricing?" + models.map(model => `endpoint_id=${model}`).join("&"), { headers: headers() });
  const livePrice = Object.fromEntries(prices.prices.map(item => [item.endpoint_id, item.unit_price]));
  expect(models.map(model => livePrice[model])).toEqual([.001111111, .01, .03, 1]);
  await mkdir(directory, { recursive: true });
  const records = [];
  let reserved = 0, exceeded = false;
  async function run(method, sample, trial) {
    if (exceeded || reserved + reserve[method] > budget) throw new Error("Benchmark reservation ceiling reached");
    reserved += reserve[method];
    const report = { name: sample.name, partition: sample.partition, method, cost: reserve[method], estimated: true };
    const started = Date.now();
    try { await trial(report); }
    catch (error) { report.error = error.status ? `HTTP ${error.status}` : error.message; }
    if (report.cost > reserve[method]) exceeded = true;
    report.durationMs = Date.now() - started;
    records.push(report);
    await writeFile(`${directory}/${sample.name}-${method}.json`, JSON.stringify(report, null, 2));
  }
  async function evaluate(sample, taskIndex) {
    const caseDirectory = `${directory}/${sample.name}`;
    await mkdir(caseDirectory, { recursive: true });
    await writeFile(`${caseDirectory}/source.png`, sample.source);
    await sharp(sample.label, { raw: { width: sample.width, height: sample.height, channels: 1 } }).png().toFile(`${caseDirectory}/annotation.png`);
    const uri = `data:image/png;base64,${sample.source.toString("base64")}`;
    async function score(report, masks) {
      let best, bestBytes;
      for await (const bytes of masks) {
        const coverage = await alpha(bytes);
        const metrics = measurePilotMask(coverage, sample);
        if (!best || metrics.iou > best.iou) { best = metrics; bestBytes = bytes; }
      }
      report.metrics = best;
      if (bestBytes) await writeFile(`${caseDirectory}/${report.method}.png`, bestBytes);
    }
    await run("pilot", sample, async report => {
      const preview = await createPilotPreview(sample.source);
      const { regions, usage } = await locatePilotRegions(preview);
      report.regions = regions;
      report.cost = (usage?.promptTokenCount || 0) * .25 / 1e6 + ((usage?.candidatesTokenCount || 0) + (usage?.thoughtsTokenCount || 0)) * 1.5 / 1e6;
      if (!regions.length) return;
      report.cost += livePrice[PILOT_MASK_MODEL];
      const previewUri = `data:image/png;base64,${preview.bytes.toString("base64")}`;
      const data = await queue(PILOT_MASK_MODEL, pilotMaskRequest(previewUri, regions), report);
      const { matches, missing } = await matchPilotMasks(data, { ...preview, regions }, maskBytes);
      report.missing = missing;
      await score(report, (async function* () {
        const namedMasks = matches.map(match => ({ name: match.name, nativeCoverage: (width, height) => nativePilotCoverage(match.coverage, preview, width, height) }));
        for await (const output of automaticCutouts(sample.source, [], { limit: 32, namedMasks })) if (output.candidate) yield output.bytes;
      })());
    });
    await run("baseline", sample, async report => {
      const data = await queue(LAYER_MODEL, { image_url: uri, output_format: "png", points_per_side: 32, pred_iou_thresh: .88, stability_score_thresh: .95, min_mask_region_area: 100 }, report);
      if (Number.isFinite(report.seconds)) report.cost = report.seconds * livePrice[LAYER_MODEL];
      await score(report, (async function* () {
        for await (const output of automaticCutouts(sample.source, data.individual_masks, { readMask: maskBytes, limit: 32 })) if (output.name !== "Remaining artwork") yield output.bytes;
      })());
    });
    if ([15, 16, 17, 23].includes(taskIndex)) await run("bria", sample, async report => {
      const data = await queue(bria, { image_url: uri, autocrop: false, prompt: sample.description }, report);
      const output = await maskBytes(data.image.url);
      const { width, height, hasAlpha } = await sharp(output).metadata();
      if (!hasAlpha || width !== sample.width || height !== sample.height) throw new Error("Bria did not return aligned alpha");
      await score(report, [output]);
    });
    if ([13, 16, 23].includes(taskIndex)) await run("nano", sample, async report => {
      const data = await queue(nano, { image_urls: [uri], resolution: "1K", num_images: 1, output_format: "png", thinking_level: "minimal", prompt: `Isolate ${sample.description}. Preserve placement, spelling, shapes and colors. Put it on a transparent background.` }, report);
      report.cost = .0415;
      await writeFile(`${caseDirectory}/nano.png`, await maskBytes(data.images[0].url));
    });
  }
  for (let index = 0; index < 24 && !exceeded; index += 4) {
    const results = await Promise.allSettled(Array.from({ length: 4 }, async (_, offset) => evaluate(await pilotCase(index + offset), index + offset)));
    for (const failed of results.filter(result => result.status === "rejected")) console.warn(failed.reason.message);
  }
  const holdout = method => summarize(records.filter(row => row.partition === "holdout" && row.method === method));
  const candidate = holdout("pilot"), baseline = holdout("baseline");
  const passed = records.length === 55 && candidate.groupedWordmarks >= .90 && candidate.medianIoU >= .90 && candidate.medianBoundary >= .85 &&
    candidate.groupedWordmarks > baseline.groupedWordmarks && candidate.medianBoundary > baseline.medianBoundary;
  const report = { reserved, estimatedSpend: records.reduce((sum, row) => sum + row.cost, 0), passed, pilot: candidate, baseline,
    byMethod: Object.fromEntries(["pilot", "baseline", "bria", "nano"].map(method => [method, summarize(records.filter(row => row.method === method))])) };
  await writeFile(`${directory}/report.json`, JSON.stringify(report, null, 2));
  console.log(report);
  expect(records.length).toBe(55);
  expect(reserved).toBeLessThanOrEqual(budget);
  expect(exceeded).toBe(false);
}, 900_000);

test.skipIf(process.env.DESIGN_PILOT_ORACLE !== "1")("checks SAM 3.1 box prompts independently with four annotated synthetic designs", async () => {
  // This diagnostic reserves an additional $0.04. It never qualifies the pilot.
  expect(Boolean(process.env.FAL_KEY)).toBe(true);
  const prices = await json(`https://api.fal.ai/v1/models/pricing?endpoint_id=${PILOT_MASK_MODEL}`, { headers: headers() });
  expect(prices.prices[0].unit_price).toBe(.01);
  await mkdir(directory, { recursive: true });
  const results = await Promise.all([0, 3, 4, 5].map(async index => {
    const sample = await pilotCase(index);
    let left = sample.width, right = 0, top = sample.height, bottom = 0;
    for (let y = 0; y < sample.height; y++) for (let x = 0; x < sample.width; x++) {
      if (sample.label[y * sample.width + x] < 128) continue;
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
    const regions = [{ name: sample.description, box: { left, right, top, bottom } },
      { name: "Blue circle", box: { left: sample.width - 156, right: sample.width - 105, top: 152, bottom: 202 } }];
    const report = { name: sample.name };
    try {
      const data = await queue(PILOT_MASK_MODEL, pilotMaskRequest(`data:image/png;base64,${sample.source.toString("base64")}`, regions), report);
      const { matches, missing } = await matchPilotMasks(data, { width: sample.width, height: sample.height, regions }, maskBytes);
      const match = matches.find(candidate => candidate.name === sample.description);
      const caseDirectory = `${directory}/${sample.name}`;
      if (match) {
        report.metrics = measurePilotMask(match.coverage, sample);
        await mkdir(caseDirectory, { recursive: true });
        await sharp(match.coverage, { raw: { width: sample.width, height: sample.height, channels: 1 } }).png().toFile(`${caseDirectory}/sam3-oracle.png`);
      }
      report.masks = data.masks?.length || 0;
      report.missing = missing;
    } catch (error) { report.error = error.status ? `HTTP ${error.status}` : error.message; }
    return report;
  }));
  await writeFile(`${directory}/sam3-oracle.json`, JSON.stringify(results, null, 2));
  console.log(results);
}, 120_000);
