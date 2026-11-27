import sharp from "sharp";
import { DESIGN_IMAGE_MAX_PIXELS, DESIGN_ASSET_MAX_BYTES } from "@/lib/designExtractImagePolicy";
import { nativePilotCoverage } from "./qualityPilot";
import { refineFlatCutout } from "./refineFlatCutout";
import { refineProductionMatte } from "./refineProductionMatte";
import { REFINE_MODEL } from "./refinement";

export const GUIDED_CUTOUT_MODEL = "bria/guided-remove-background";
export const guidedCutout = job => job?.input?._desaynclaw?.guidedCutout;
export const isAutomaticSeparationJob = job => job?.input?._desaynclaw?.autoSeparation === true;

export function hasPreparedCutoutInput(job) {
  const settings = job.input?._desaynclaw;
  if (settings?.nanoElements) return Boolean(settings.nanoLayout);
  return job.model === (settings?.whiteElements ? REFINE_MODEL : GUIDED_CUTOUT_MODEL);
}

function invalid(message) {
  return Object.assign(new Error(message), { status: 422, designExtractError: true });
}

export async function guidedPreview(source, box) {
  const { width, height } = await sharp(source, { limitInputPixels: DESIGN_IMAGE_MAX_PIXELS }).metadata();
  if (box.left + box.width > width || box.top + box.height > height) throw invalid("Draw a box inside the original artwork.");
  const cropped = await sharp(source).extract(box).png().toBuffer();
  return sharp(cropped).resize(1536, 1536, { fit: "inside", withoutEnlargement: true }).png().toBuffer({ resolveWithObject: true });
}

// Apply only the returned alpha. The cutout retains its original RGB values
// and stays registered in original-image coordinates.
export async function* renderGuidedCutout(source, mask, settings, existingMasks, otherBoxes) {
  const { box, preview, name } = settings;
  const original = await sharp(source, { limitInputPixels: DESIGN_IMAGE_MAX_PIXELS }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = original.info;
  const maskImage = sharp(mask, { limitInputPixels: DESIGN_IMAGE_MAX_PIXELS });
  const info = await maskImage.metadata();
  const { left: padLeft, top: padTop, right: padRight, bottom: padBottom } = preview.padding || { left: 0, top: 0, right: 0, bottom: 0 };
  if (!info.hasAlpha || info.width !== preview.width + padLeft + padRight || info.height !== preview.height + padTop + padBottom) throw invalid("The provider returned a cutout with incompatible dimensions or no transparency.");
  const coverage = await maskImage.extract({ left: padLeft, top: padTop, width: preview.width, height: preview.height }).extractChannel(3).raw().toBuffer();
  let foreground = 0, transparent = 0;
  for (let i = 0; i < coverage.length; i++) {
    // Some valid masks encode opaque interiors at 254. Snap these near-solid
    // values before resampling so they leave a clean hole in the background.
    const alpha = coverage[i] >= 251 ? 255 : coverage[i] <= 3 ? 0 : coverage[i];
    coverage[i] = alpha;
    if (alpha >= 128) foreground++;
    if (alpha <= 32) transparent++;
  }
  if (foreground < 4 || transparent / coverage.length < .015) throw invalid("The cutout did not separate from its background. Draw a box with a little room around the element and describe it more precisely.");
  const native = nativePilotCoverage(coverage, preview, box.width, box.height);
  let refined = otherBoxes ? refineFlatCutout(original, box, native, otherBoxes) || native : native;
  const tight = settings.tightBox;
  if (tight) {
    refined = refineProductionMatte(original, box, refined);
    const margin = Math.max(3, Math.round(Math.min(tight.width, tight.height) * .06));
    let inside = 0, outside = 0, clipped = 0;
    for (let y = 0, i = 0; y < box.height; y++) for (let x = 0; x < box.width; x++, i++) {
      const sx = box.left + x, sy = box.top + y;
      if (sx >= tight.left - margin && sx < tight.left + tight.width + margin &&
          sy >= tight.top - margin && sy < tight.top + tight.height + margin) inside += refined[i];
      else outside += refined[i];
      if ((x === 0 && box.left > 0 || x === box.width - 1 && box.left + box.width < width ||
           y === 0 && box.top > 0 || y === box.height - 1 && box.top + box.height < height) && refined[i] >= 128) clipped++;
    }
    if (outside > inside * .4) throw invalid("The cutout still contains neighboring artwork or background.");
    if (clipped > Math.max(4, (box.width + box.height) * .035)) throw invalid("Artwork touches a crop edge inside the original image.");
  }
  const covered = new Uint8Array(width * height);
  for await (const bytes of existingMasks) {
    if (bytes.length > DESIGN_ASSET_MAX_BYTES) throw invalid("An existing cutout exceeds the image limit.");
    const image = sharp(bytes, { limitInputPixels: DESIGN_IMAGE_MAX_PIXELS });
    const meta = await image.metadata();
    if (!meta.hasAlpha || meta.width !== width || meta.height !== height) throw invalid("An existing cutout no longer matches the original artwork.");
    const alpha = await image.extractChannel(3).raw().toBuffer();
    for (let i = 0; i < covered.length; i++) covered[i] = Math.round(alpha[i] + covered[i] * (255 - alpha[i]) / 255);
  }
  const selected = Buffer.from(original.data);
  let visible = false;
  for (let y = 0, i = 0; y < height; y++) for (let x = 0; x < width; x++, i++) {
    const offset = i * 4, before = covered[i];
    const inside = x >= box.left && x < box.left + box.width && y >= box.top && y < box.top + box.height;
    const target = inside ? Math.round(original.data[offset + 3] * refined[(y - box.top) * box.width + x - box.left] / 255) : 0;
    const added = before < target ? Math.round((target - before) * 255 / (255 - before)) : 0;
    selected[offset + 3] = added;
    if (!added) selected[offset] = selected[offset + 1] = selected[offset + 2] = 0;
    covered[i] = Math.round(added + before * (255 - added) / 255);
    visible ||= added > 0;
  }
  if (!visible) throw invalid("The selected artwork is already isolated or has no visible pixels.");
  yield { index: 0, name, bytes: await sharp(selected, { raw: original.info }).png().toBuffer(), guidedElement: true };
}
