import { DESIGN_IMAGE_MAX_PIXELS } from "./designExtractImagePolicy";
import { alreadyUpscaled } from "./designLayerTypes";

// Recraft's endpoint exposes no selectable scale parameter. Keep the existing
// 4× output contract until a different factor is qualified end to end.
export function recraftUpscalePlan(width, height) {
  if (![width, height].every(value => Number.isSafeInteger(value) && value >= 32)) return null;
  const outputWidth = width * 4;
  const outputHeight = height * 4;
  if (Math.max(width, height) > 4096 || width * height > 16_000_000 ||
      Math.max(outputWidth, outputHeight) > 8192 || outputWidth * outputHeight > DESIGN_IMAGE_MAX_PIXELS) return null;
  return { scale: 4, width: outputWidth, height: outputHeight };
}

export function layerUpscaleAvailability(layer) {
  if (layer.kind === "svg") return { label: "Vector artwork", reason: "SVG artwork already scales without losing sharpness." };
  if (alreadyUpscaled(layer)) return { label: "Already upscaled", reason: "This image is already upscaled. Each image can be upscaled once." };
  const { width, height } = layer;
  const plan = recraftUpscalePlan(width, height);
  if (plan) return { label: "Upscale image", plan, reason: `4× output · ${plan.width} × ${plan.height} px` };
  if (![width, height].every(value => Number.isSafeInteger(value) && value > 0)) {
    return { label: "Upscale unavailable", reason: "Reload this project to check the image dimensions." };
  }
  if (Math.min(width, height) < 32) return { label: "Image too small", reason: "Upscaling requires both sides to be at least 32 px." };
  return { label: "Already high resolution", reason: `${width} × ${height} px · Further upscaling exceeds supported size limits.` };
}
