import { describe, expect, it } from "vitest";
import { getTraceResumePlan } from "@/lib/traceResume";

describe("trace recovery plan", () => {
  it("starts a new project with the normal base charge", () => {
    expect(getTraceResumePlan({}, "standard").creditCost).toBe(1);
    expect(getTraceResumePlan({}, "precision").creditCost).toBe(2);
  });

  it("resumes a saved Flat Extract at Step 2 without another base charge", () => {
    const project = { generated_image_url: "https://example.com/generated_flat.png" };
    expect(getTraceResumePlan(project, "standard")).toEqual({
      resumeVectorization: false,
      resumeUpscale: true,
      creditCost: 0,
    });
    expect(getTraceResumePlan(project, "precision").creditCost).toBe(1);
  });

  it("resumes a saved HD output at Step 3 without another base charge", () => {
    const project = { generated_image_url: "https://example.com/generated.png", upscaled_image_url: "https://example.com/upscaled.png" };
    expect(getTraceResumePlan(project, "standard")).toEqual({
      resumeVectorization: true,
      resumeUpscale: false,
      creditCost: 0,
    });
  });

  it("does not treat a refunded marker as recoverable output", () => {
    expect(getTraceResumePlan({ generated_image_url: "REFUNDED" }).creditCost).toBe(1);
  });
});
