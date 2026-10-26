// Standalone tool only. Garment/logo processing uses its own pipeline.
export const UPSCALE_ENDPOINT = "topaz/upscale/image/precision";
export const UPSCALE_FACTOR = 4;
export const MAX_UPSCALE_OUTPUT_PIXELS = 24_000_000;
export const UPSCALE_LIMIT_MESSAGE = "Choose an image up to 1.5 MP (for example, 1500 × 1000). The 4× output is limited to 24 MP. Your source will not be reduced automatically.";
export const UPSCALE_PROFILES = {
  photo: { label: "Photo / face", model: "High Fidelity V3" },
  logo: { label: "Logo / lettering", model: "Text Refine" },
  artwork: { label: "Artwork / pattern", model: "CGI" },
};

export function getUpscalePlan(width, height) {
  const valid = Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0;
  const outputWidth = width * UPSCALE_FACTOR;
  const outputHeight = height * UPSCALE_FACTOR;
  return { outputWidth, outputHeight, allowed: valid && outputWidth * outputHeight <= MAX_UPSCALE_OUTPUT_PIXELS };
}

export function getUpscaleSettings(profile = "photo") {
  if (!Object.hasOwn(UPSCALE_PROFILES, profile)) return null;
  return {
    model: UPSCALE_PROFILES[profile].model,
    upscale_factor: UPSCALE_FACTOR,
    output_format: "png",
    crop_to_fill: false,
    face_enhancement: false,
    sharpen: 0.1,
    denoise: 0,
    ...(profile === "photo" ? { fix_compression: 0 } : {}),
    ...(profile === "logo" ? { strength: 0.1 } : {}),
  };
}

export function buildUpscaleJobMarker(requestId) {
  return `fal:${UPSCALE_ENDPOINT}:${requestId}`;
}

export function parseUpscaleJobMarker(marker) {
  const match = String(marker || "").match(/^fal:([a-z0-9./-]+):([^:]+)$/i);
  if (!match) return null;
  // Keep old jobs on the exact endpoint that accepted them.
  const endpoint = match[1].includes("/") ? match[1] : `fal-ai/${match[1]}`;
  if (![UPSCALE_ENDPOINT, "fal-ai/esrgan", "fal-ai/aura-sr"].includes(endpoint)) return null;
  return { endpoint, requestId: match[2] };
}
