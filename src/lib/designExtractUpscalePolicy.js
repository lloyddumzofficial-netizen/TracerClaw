import { DESIGN_IMAGE_MAX_PIXELS } from "./designExtractImagePolicy";
import { alreadyUpscaled } from "./designLayerTypes";

export function recraftUpscalePlan(width, height) {
  if (![width, height].every(value => Number.isSafeInteger(value) && value >= 32)) return null;
  const scale = Math.min(4, 4096 / Math.max(width, height));
  if (scale <= 1 || width * height > 4_000_000) return null;
  return { scale, width: Math.round(width * scale), height: Math.round(height * scale) };
}

export function recraftResultPlan(sourceWidth, sourceHeight, width, height) {
  if (![sourceWidth, sourceHeight, width, height].every(value => Number.isSafeInteger(value) && value > 0)) return null;
  const scale = Math.min(width / sourceWidth, height / sourceHeight);
  if (scale <= 1 || width > sourceWidth * 4 || height > sourceHeight * 4 ||
      Math.max(width, height) > 8192 || width * height > DESIGN_IMAGE_MAX_PIXELS ||
      Math.abs(width - sourceWidth * scale) > 2 || Math.abs(height - sourceHeight * scale) > 2) return null;
  return { width, height, scale, sourceWidth, sourceHeight };
}

export function layerUpscaleAvailability(layer) {
  if (layer.kind === "svg") return { label: "Vector artwork", reason: "SVG artwork already scales without losing sharpness." };
  if (alreadyUpscaled(layer)) return { label: "Already upscaled", reason: "This image is already upscaled. Each image can be upscaled once." };
  const { width, height } = layer;
  const plan = recraftUpscalePlan(width, height);
  if (plan) return { label: "Upscale image", plan, reason: `Up to ${plan.width} × ${plan.height} px` };
  if (![width, height].every(value => Number.isSafeInteger(value) && value > 0)) {
    return { label: "Upscale unavailable", reason: "Reload this project to check the image dimensions." };
  }
  if (Math.min(width, height) < 32) return { label: "Image too small", reason: "Upscaling requires both sides to be at least 32 px." };
  return { label: "Already high resolution", reason: `${width} × ${height} px · Further upscaling exceeds supported size limits.` };
}
