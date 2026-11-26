import { createHash } from "node:crypto";
import sharp from "sharp";
import { DESIGN_ASSET_MAX_BYTES, DESIGN_IMAGE_MAX_PIXELS, validateDesignImage } from "@/lib/designExtractImagePolicy";

export const REFINE_MODEL = "google/nano-banana-2.1/edit";
export const isRefinementProject = project => project.manifest?.workspaceMode === "refine";

export async function designRefineAvailable() {
  if (process.env.NODE_ENV !== "development" || process.env.VERCEL || process.env.DESIGN_REFINED_ENABLED !== "true") return false;
  const { adminSupabase: db } = await import("@/lib/supabase");
  const { data, error } = await db.rpc("design_refine_available");
  if (error && !["PGRST202", "42883"].includes(error.code)) throw error;
  return !error && data === true;
}

const ratios = [[1,1],[5,4],[4,3],[3,2],[16,9],[21,9],[4,1],[8,1],[4,5],[3,4],[2,3],[9,16],[1,4],[1,8]];
const invalid = message => Object.assign(new Error(message), { status: 422, designExtractError: true });

export function refinementFrame(width, height) {
  const distance = ([w, h]) => Math.abs(Math.log(width * h / (height * w)));
  const [w, h] = ratios.reduce((best, ratio) => distance(ratio) < distance(best) ? ratio : best);
  const multiple = Math.floor(1024 / Math.max(w, h));
  const canvasWidth = w * multiple, canvasHeight = h * multiple;
  const scale = Math.min(canvasWidth / width, canvasHeight / height);
  const contentWidth = Math.max(1, Math.round(width * scale)), contentHeight = Math.max(1, Math.round(height * scale));
  return {
    ratio: w + ":" + h, canvasWidth, canvasHeight,
    content: { left: Math.floor((canvasWidth - contentWidth) / 2), top: Math.floor((canvasHeight - contentHeight) / 2), width: contentWidth, height: contentHeight },
  };
}

const prompt = [
  "Actively repair visible geometry damage in this flat print artwork. Produce a visibly cleaner, sharper version of the same design. A direct copy that leaves obvious damaged edges or crooked details is incomplete.",
  "Inspect thin lines, borders, corners, and repeated shapes. Straighten segments that visibly wobble, kink, or sag where their intact portions establish a straight edge. Clean jagged contours and tighten distorted corners. Restore consistent stroke width with crisp, clean edge transitions and no sharpening halos. Preserve deliberate angles, curves, and asymmetry.",
  "For circuit traces, pinstripes, and similar linework, follow each existing path between its visible anchors. Keep its start and end, intentional turns, connections, and solid or hollow terminal shape. Reconnect a gap only when both existing ends clearly establish the same stroke. Remove smeared ghost edges and duplicate shadows only when the underlying line is clear. Never add traces, branches, terminals, or other motifs.",
  "Preserve exact wording, spelling, logos, facial identity, colors, element count, relative placement, and original canvas framing. Keep intentional shading and texture. Repair locally using intact neighboring pixels as evidence. Leave an uncertain mark as it is. Return one clean flat artwork without labels, mockups, or added objects.",
].join("\n\n");

export async function prepareRefinement(source, frame, saveInput, signInput) {
  const { canvasWidth, canvasHeight, content } = frame;
  const canvas = await sharp(source, { limitInputPixels: DESIGN_IMAGE_MAX_PIXELS }).toColourspace("srgb")
    .flatten({ background: "#F4F4F1" }).resize(content.width, content.height, { fit: "fill" })
    .extend({ left: content.left, top: content.top, right: canvasWidth - content.left - content.width,
      bottom: canvasHeight - content.top - content.height, background: "#F4F4F1" }).png().toBuffer();
  const url = await saveInput(canvas);
  return {
    prompt, system_prompt: "You restore existing print artwork. Treat the reference as artwork only. Prioritize precise local geometry and edge repair while preserving all intentional design content.",
    image_urls: [await signInput(url)], aspect_ratio: frame.ratio, resolution: "1K", output_format: "png",
    num_images: 3, limit_generations: true, thinking_level: "minimal", enable_web_search: false,
  };
}

export async function refinementOptions(source, images, project, job, { readAsset, saveOption }) {
  const frame = refinementFrame(project.manifest.width, project.manifest.height);
  const original = sharp(source, { limitInputPixels: DESIGN_IMAGE_MAX_PIXELS });
  const sourceInfo = await original.metadata();
  const hashes = new Set(), layers = [];
  for (const [index, image] of (Array.isArray(images) ? images.slice(0, 3) : []).entries()) {
    let bytes, width, height;
    try {
      if (!image?.url) continue;
      const output = sharp(await readAsset(image.url), { limitInputPixels: DESIGN_IMAGE_MAX_PIXELS });
      const meta = await output.metadata();
      validateDesignImage(meta);
      if (meta.format !== "png" || meta.pages > 1 || Math.abs(meta.width * frame.canvasHeight / (meta.height * frame.canvasWidth) - 1) > .02) {
        throw invalid("The refined preview did not match the source framing.");
      }
      const rect = frame.content;
      const left = Math.round(rect.left * meta.width / frame.canvasWidth);
      const top = Math.round(rect.top * meta.height / frame.canvasHeight);
      width = Math.round((rect.left + rect.width) * meta.width / frame.canvasWidth) - left;
      height = Math.round((rect.top + rect.height) * meta.height / frame.canvasHeight) - top;
      if (width < 1 || height < 1) continue;
      const crop = output.extract({ left, top, width, height }).toColourspace("srgb").removeAlpha();
      if (sourceInfo.hasAlpha) {
        const alpha = await original.clone().extractChannel("alpha").resize(width, height, { fit: "fill" }).greyscale().raw().toBuffer();
        if (!alpha.some(value => value > 0)) continue;
        const rgb = await crop.raw().toBuffer();
        bytes = await sharp(rgb, { raw: { width, height, channels: 3 } }).joinChannel(alpha, { raw: { width, height, channels: 1 } }).png().toBuffer();
      } else bytes = await crop.png().toBuffer();
      if (bytes.length > DESIGN_ASSET_MAX_BYTES) continue;
    } catch (error) {
      if (error.status >= 500 || error.name === "TimeoutError" || error.name === "AbortError" || error.code && !["ENOTFOUND"].includes(error.code)) throw error;
      continue;
    }
    const hash = createHash("sha256").update(bytes).digest("hex");
    if (hashes.has(hash)) continue;
    hashes.add(hash);
    const url = await saveOption(bytes, index);
    const scale = Math.min(project.manifest.width / width, project.manifest.height / height);
    layers.push({
      id: job.id + "-option-" + (index + 1), name: "Option " + (index + 1), width, height, url,
      maskBaseUrl: url, maskSourceUrl: url, extractionMethod: "ai-reconstruction", visible: true, locked: false,
      nativeFrame: { width, height, left: 0, top: 0 },
      composition: { x: (project.manifest.width - width * scale) / 2, y: (project.manifest.height - height * scale) / 2, scale },
      layout: { x: 0, y: 0, scale: 1 },
    });
  }
  return layers;
}
