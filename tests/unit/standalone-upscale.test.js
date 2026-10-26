import { describe, expect, it } from "vitest";
import { getUpscalePlan, getUpscaleSettings, parseUpscaleJobMarker } from "../../src/lib/standaloneUpscale";

describe("standalone precision upscale policy", () => {
  it("accepts the 24 MP boundary and rejects the next pixel row", () => {
    expect(getUpscalePlan(1500, 1000)).toEqual({ outputWidth: 6000, outputHeight: 4000, allowed: true });
    expect(getUpscalePlan(1500, 1001).allowed).toBe(false);
    expect(getUpscalePlan(0, 100).allowed).toBe(false);
    expect(getUpscalePlan(NaN, 100).allowed).toBe(false);
  });
  it("never enables face recovery and excludes unsupported CGI controls", () => {
    for (const profile of ["photo", "logo", "artwork"]) expect(getUpscaleSettings(profile).face_enhancement).toBe(false);
    expect(getUpscaleSettings("artwork")).not.toHaveProperty("fix_compression");
    expect(getUpscaleSettings("logo").strength).toBe(0.1);
    expect(getUpscaleSettings("__proto__")).toBeNull();
  });
  it("rejects tampered endpoint markers", () => {
    expect(parseUpscaleJobMarker("fal:other/expensive/model:job")).toBeNull();
    expect(parseUpscaleJobMarker("fal:esrgan:")).toBeNull();
  });
});
