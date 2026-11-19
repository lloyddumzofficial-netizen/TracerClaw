import { DESIGN_EXTRACT_UPLOAD_MAX_BYTES } from "./uploadLimits";

export const DESIGN_IMAGE_MAX_PIXELS = 24_000_000;
export const DESIGN_ASSET_MAX_BYTES = 100 * 1024 * 1024;
export const DESIGN_UPLOAD_MAX_BYTES = DESIGN_EXTRACT_UPLOAD_MAX_BYTES;

export function validateDesignImage(metadata) {
  const { width, height, depth } = metadata;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width * height > DESIGN_IMAGE_MAX_PIXELS) {
    throw Object.assign(new Error("Design Extract supports images up to 24 megapixels."), { status: 413, designExtractError: true });
  }
  if (depth && depth !== "uchar") throw Object.assign(new Error("Use an 8-bit PNG, JPG or WebP image."), { status: 422, designExtractError: true });
}
