import { describe, expect, it } from "vitest";
import {
  buildNanoBananaPrompt,
  buildNanoBananaSystemPrompt,
  getNanoBananaInputTuning,
  NANO_BANANA_EDIT_MODEL,
} from "@/lib/tracePrompts";

describe("trace prompt source fidelity", () => {
  it("locks logo restoration to Nano Banana Pro Edit", () => {
    expect(NANO_BANANA_EDIT_MODEL).toBe("fal-ai/nano-banana-pro/edit");
    expect(getNanoBananaInputTuning("LOGO_FLATTEN").resolution).toBe("4K");
    expect(getNanoBananaInputTuning("PRESERVE_LOGOS").resolution).toBe("2K");
  });

  it.each(["ERASE_LOGOS", "PRESERVE_LOGOS"])(
    "locks visible garment artwork before inferring missing areas in %s mode",
    (mode) => {
      const prompt = buildNanoBananaPrompt(mode);

      expect(prompt).toContain("SOURCE AUTHORITY — COPY FIRST, INFER LAST");
      expect(prompt).toContain("OBSERVED ZONE");
      expect(prompt).toContain("MISSING ZONE");
      expect(prompt).toContain("VISIBLE-EVIDENCE OVERRIDE");
      expect(prompt).toContain("EDGE INTEGRITY — CLEAN WITHOUT REDESIGN");
      expect(prompt).toContain("PHOTOGRAPHIC LIGHT REMOVAL — ZERO SHADOWS OR REFLECTIONS");
      expect(prompt).toContain("dark pools near the waist or hem");
      expect(prompt).toContain("LIGHTING-DETECTION TEST");
      expect(prompt).toContain("Recover each region's base print color");
      expect(prompt).toContain("zero evidence of a camera or light source");
      expect(prompt).toContain("Do not create stair-step jaggies");
      expect(prompt).toContain("Do not remove anti-aliasing so aggressively");
    },
  );

  it("uses the same edge-quality contract for logo flattening", () => {
    const prompt = buildNanoBananaPrompt("LOGO_FLATTEN");
    const systemPrompt = buildNanoBananaSystemPrompt("LOGO_FLATTEN");

    expect(prompt).toContain("EDGE INTEGRITY — CLEAN WITHOUT REDESIGN");
    expect(prompt).toContain("PHOTOGRAPHIC LIGHT REMOVAL — ZERO SHADOWS OR REFLECTIONS");
    expect(prompt).toContain("Thin strokes, small counters inside letters");
    expect(prompt).toContain("IMMUTABLE REFERENCE RESTORATION — DO NOT GENERATE A NEW LOGO");
    expect(prompt).toContain("The reference image is the immutable ground truth");
    expect(prompt).toContain("HD EDGE OUTPUT");
    expect(prompt).toContain("No white fringe, dark fringe, doubled outline");
    expect(prompt).toContain("LOGO ISOLATION — REMOVE EVERY REFERENCE BACKGROUND");
    expect(prompt).toContain("PURE WHITE: #FFFFFF / RGB(255,255,255)");
    expect(prompt).toContain("FOREGROUND COLOR LOCK — EXACT LOGO COLORS");
    expect(prompt).toContain("FINAL LOGO VALIDATION — MANDATORY BEFORE OUTPUT");
    expect(prompt).not.toContain("Preserve the original background exactly");
    expect(systemPrompt).toContain("WHITE BACKGROUND");
    expect(systemPrompt).toContain("FOREGROUND COLOR LOCK");
  });

  it("makes literal source fidelity the system-level priority", () => {
    const prompt = buildNanoBananaSystemPrompt("PRESERVE_LOGOS");

    expect(prompt).toContain("SOURCE IDENTITY LOCK");
    expect(prompt).toContain("OBSERVED BEFORE INFERRED");
    expect(prompt).toContain("Photographic shadows, reflections, highlights");
    expect(prompt).toContain("If \"cleaner\" conflicts with \"closer to the source,\"");
  });
});
