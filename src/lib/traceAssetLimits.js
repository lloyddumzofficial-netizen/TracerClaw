import { DEFAULT_MAX_IMAGE_BYTES, DEFAULT_MAX_UPSCALED_IMAGE_BYTES } from "@/lib/ssrf";

// The output of Step 1 is the input of Step 2. Both reads must agree on the
// maximum size, or a successful extraction can become impossible to finish.
export function getFlatExtractMaxBytes(traceType) {
  return traceType === "logo" ? DEFAULT_MAX_UPSCALED_IMAGE_BYTES : DEFAULT_MAX_IMAGE_BYTES;
}
