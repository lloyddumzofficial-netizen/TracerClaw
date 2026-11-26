import { createHash } from "node:crypto";
import sharp from "sharp";
import { designRateLimit as enforceRateLimit } from "./rateLimit";
import { DEFAULT_MAX_SVG_BYTES, fetchWithSSRFProtection, getAllowedProviderHosts } from "@/lib/ssrf";
import { DESIGN_IMAGE_MAX_PIXELS, validateDesignImage } from "@/lib/designExtractImagePolicy";
import { readAsset, prefix, fail } from "./service";
import { ownsPrivateDesignAsset, uploadDesignAsset, readPrivateDesignAsset, designAssetUrl } from "./storage";
import { withDesignImageWork } from "./imageWork";
import { claimFinishAction, confirmedFinishRejection, finishReceiptExpired, settleFinishAction, trackFinishAction } from "./finishBilling";

const VERSION = "recraft-vectorize-v1";
const missing = error => error?.name === "NoSuchKey" || error?.$metadata?.httpStatusCode === 404;
const exists = error => error?.name === "PreconditionFailed" || error?.$metadata?.httpStatusCode === 412;

// Reject active SVG and external references before storing provider artwork.
export function checkedVectorSvg(bytes) {
  if (!bytes?.length || bytes.length > DEFAULT_MAX_SVG_BYTES) fail("The SVG output exceeds the download limit.", 502);
  const svg = bytes.toString("utf8").replace(/^\uFEFF/, "").replace(/<\?xml[^>]*\?>/gi, "").replace(/<!--[\s\S]*?-->/g, "").trim();
  const tags = [...svg.matchAll(/<\/?([\w:-]+)/g)].map(match => match[1]);
  const styles = [...svg.matchAll(/\bstyle\s*=\s*(["'])(.*?)\1/gi)].map(match => match[2]);
  const allowed = new Set(["svg", "g", "path", "defs", "clipPath", "mask", "rect", "circle", "ellipse", "polygon", "polyline", "line", "title", "desc", "linearGradient", "radialGradient", "stop"]);
  if (!/^<svg\b/.test(svg) || !/<\/svg>\s*$/.test(svg) || /<!|<\?|\\|&#|\bon[\w:-]+\s*=|\b(?:href|src|xml:base)\s*=|url\(\s*(?!["']?#)[^)]*\)/i.test(svg) || tags.some(tag => !allowed.has(tag)) || styles.some(style => !/^\s*display\s*:\s*block\s*;?\s*$/i.test(style))) fail("Recraft returned an unsupported SVG. Your PNG is unchanged.", 502);
  return Buffer.from(svg);
}

export async function convertDesignLayer(project, layerId, acknowledgedClaws) {
  const layer = project.manifest.layers.find(item => item.id === layerId);
  if (!layer || !ownsPrivateDesignAsset(layer.url, project.user_id)) fail("Layer not found", 404);
  const digest = createHash("sha256").update(`${VERSION}:${layer.id}:${layer.url}`).digest("hex");
  const base = `${prefix(project)}svg/${digest}`;
  const recordUrl = `r2-private://design-extract/${base}.json`;
  let record;
  try { record = JSON.parse((await readPrivateDesignAsset(recordUrl, 16 * 1024)).toString("utf8")); }
  catch (error) { if (!missing(error)) throw error; }
  const saveRecord = state => uploadDesignAsset(Buffer.from(JSON.stringify(state)), `${base}.json`, "application/json");
  const retry = record?.state === "failed";
  if (retry) await settleFinishAction(project, record.finishActionId, false);
  if (!record || retry) {
    if (!process.env.RECRAFT_API_KEY) fail("SVG conversion is not configured.", 503);
    const limit = await enforceRateLimit({ namespace: "design-extract:svg", identifier: project.user_id, max: 3, window: "60 s", windowMs: 60000 });
    if (!limit.success) fail("Too many SVG conversions. Try again in a minute.", 429);
    const source = await readAsset(layer.url);
    const input = await withDesignImageWork(async () => {
      const image = sharp(source, { limitInputPixels: DESIGN_IMAGE_MAX_PIXELS });
      validateDesignImage(await image.metadata());
      // Recraft requires sides in 256–4096 px and at most 16 MP. Padding tiny
      // cutouts retains transparency; large inputs are resized proportionally.
      const resized = await image.resize({ width: 4000, height: 4000, fit: "inside", withoutEnlargement: true }).ensureAlpha().png().toBuffer({ resolveWithObject: true });
      return sharp(resized.data).extend({ right: Math.max(0, 256 - resized.info.width), bottom: Math.max(0, 256 - resized.info.height), background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    });
    if (input.length >= 20 * 1024 * 1024) fail("This layer is too large for SVG conversion. Choose its base artwork version.", 413);
    // A durable, conditional R2 claim prevents concurrent or refreshed requests
    // from repeating a paid POST. Ambiguous submissions are never auto-retried.
    const finishActionId = await claimFinishAction(project, layerId, "svg", acknowledgedClaws);
    if (retry && !finishActionId) fail("The previous SVG conversion could not be completed.", 422);
    const binding = { createdAt: new Date().toISOString(), ...(finishActionId && { finishActionId }) };
    let signedInputUrl;
    try {
      await trackFinishAction(project, finishActionId, `${base}.json`);
      const inputUrl = await uploadDesignAsset(input, `${base}-input.png`, "image/png");
      signedInputUrl = await designAssetUrl(inputUrl);
      await uploadDesignAsset(Buffer.from(JSON.stringify({ ...binding, state: "submitting" })), `${base}.json`, "application/json", { ifAbsent: !retry });
    }
    catch (error) {
      await settleFinishAction(project, finishActionId, false);
      if (exists(error)) fail("SVG conversion is already running. Please wait before downloading again.", 409);
      throw error;
    }
    try {
      const response = await fetch("https://external.api.recraft.ai/v1/images/vectorize", {
        method: "POST", redirect: "error", cache: "no-store",
        headers: { Authorization: `Bearer ${process.env.RECRAFT_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ image_url: signedInputUrl, version: "v1", response_format: "url" }),
        signal: AbortSignal.timeout(40_000),
      });
      if (!response.ok) {
        if (finishActionId && confirmedFinishRejection(response.status)) {
          await saveRecord({ ...binding, state: "failed" });
          await settleFinishAction(project, finishActionId, false);
        }
        fail("Recraft could not convert this layer. The request was not repeated.", 502);
      }
      const result = await response.json();
      if (typeof result.image?.url !== "string") {
        if (finishActionId) {
          await saveRecord({ ...binding, state: "failed" });
          await settleFinishAction(project, finishActionId, false);
        }
        fail("Recraft returned no SVG file.", 502);
      }
      record = { ...binding, state: "generated", providerUrl: result.image.url };
      await saveRecord(record);
    } catch (error) {
      if (error.designExtractError) throw error;
      fail("SVG conversion could not be confirmed. No duplicate request was sent; your PNG is unchanged.", 502);
    }
  }
  if (record.state === "done") {
    const svg = checkedVectorSvg(await readPrivateDesignAsset(`r2-private://design-extract/${base}.svg`, DEFAULT_MAX_SVG_BYTES));
    await settleFinishAction(project, record.finishActionId, true);
    return svg;
  }
  if (record.state !== "generated" || !record.providerUrl) fail("SVG conversion is running or needs recovery. No duplicate request was sent.", 409);
  if (await finishReceiptExpired(record)) fail("The SVG result expired before it could be saved.", 410);
  const { buffer } = await fetchWithSSRFProtection(record.providerUrl, { allowedHosts: getAllowedProviderHosts(), maxBytes: DEFAULT_MAX_SVG_BYTES, timeoutMs: 10_000, allowedContentTypes: ["image/svg+xml", "application/xml", "text/xml", "text/plain", "application/octet-stream"] });
  let svg;
  try { svg = checkedVectorSvg(buffer); }
  catch (error) {
    if (record.finishActionId && error.designExtractError) {
      await saveRecord({ state: "failed", finishActionId: record.finishActionId });
      await settleFinishAction(project, record.finishActionId, false);
    }
    throw error;
  }
  await uploadDesignAsset(svg, `${base}.svg`, "image/svg+xml");
  await saveRecord({ state: "done", ...(record.finishActionId && { finishActionId: record.finishActionId }) });
  await settleFinishAction(project, record.finishActionId, true);
  return svg;
}
