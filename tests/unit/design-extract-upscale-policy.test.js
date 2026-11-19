import { describe, expect, it } from "vitest";
import { layerUpscaleAvailability, recraftUpscalePlan } from "@/lib/designExtractUpscalePolicy";

describe("Recraft upscale eligibility", () => {
  it("shows native output dimensions within the edge and pixel budgets", () => {
    expect(recraftUpscalePlan(600, 1000)).toEqual({ scale: 4, width: 2400, height: 4000 });
    expect(recraftUpscalePlan(2048, 32)).toEqual({ scale: 4, width: 8192, height: 128 });
    expect(recraftUpscalePlan(1500, 1000)).toEqual({ scale: 4, width: 6000, height: 4000 });
  });
  it.each([[2049,32], [1501,1000], [3372,5086], [31,100], [NaN,100], [100.5,100]])(
    "rejects unsafe or unsupported %i × %i before submission", (width,height) => {
      expect(recraftUpscalePlan(width,height)).toBeNull();
      expect(layerUpscaleAvailability({width,height}).plan).toBeUndefined();
    });
  it("distinguishes high resolution, small images, invalid sizes and repeat requests", () => {
    expect(layerUpscaleAvailability({width:3372,height:5086}).label).toBe("Already high resolution");
    expect(layerUpscaleAvailability({width:31,height:200}).label).toBe("Image too small");
    expect(layerUpscaleAvailability({width:NaN,height:200}).label).toBe("Upscale unavailable");
    for (const metadata of [{enhancement:{}},{enhancedVariant:{}},{upscale:{state:"done"}}]) {
      expect(layerUpscaleAvailability({width:100,height:100,...metadata}).label).toBe("Already upscaled");
      expect(layerUpscaleAvailability({width:100,height:100,...metadata}).plan).toBeUndefined();
    }
    expect(layerUpscaleAvailability({kind:"svg",width:100,height:100}).plan).toBeUndefined();
  });
});
