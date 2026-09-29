import { describe, expect, it } from "vitest";
import { getFlatExtractMaxBytes } from "@/lib/traceAssetLimits";
import { DEFAULT_MAX_IMAGE_BYTES, DEFAULT_MAX_UPSCALED_IMAGE_BYTES } from "@/lib/ssrf";
import { buildProjectExportAssets } from "@/lib/integrations/files";

describe("saved Flat Extract limits", () => {
  it("allows the same large logo image at generation and upscale", () => {
    expect(getFlatExtractMaxBytes("logo")).toBe(DEFAULT_MAX_UPSCALED_IMAGE_BYTES);
  });

  it("keeps garment inputs at the normal upload limit", () => {
    expect(getFlatExtractMaxBytes("garment")).toBe(DEFAULT_MAX_IMAGE_BYTES);
  });

  it("allows saved logo extracts in connected Drive exports too", () => {
    const assets = buildProjectExportAssets({
      name: "Logo",
      trace_type: "logo",
      generated_image_url: "https://storage.example/projects/1/generated_flat_1.png",
    });
    expect(assets[0].maxBytes).toBe(DEFAULT_MAX_UPSCALED_IMAGE_BYTES);
  });
});
