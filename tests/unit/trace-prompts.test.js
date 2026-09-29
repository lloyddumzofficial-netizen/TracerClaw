import { describe, expect, it } from "vitest";
import {
  buildNanoBananaPrompt,
  buildNanoBananaSystemPrompt,
  getNanoBananaInputTuning,
  NANO_BANANA_EDIT_MODEL,
  resolveTracePromptMode,
} from "@/lib/tracePrompts";

describe("trace prompt source fidelity", () => {
  it("locks logo restoration to Nano Banana Pro Edit", () => {
    expect(NANO_BANANA_EDIT_MODEL).toBe("fal-ai/nano-banana-pro/edit");
    expect(getNanoBananaInputTuning("LOGO_FLATTEN").resolution).toBe("4K");
    expect(getNanoBananaInputTuning("PRESERVE_LOGOS").resolution).toBe("2K");
    expect(resolveTracePromptMode("logo", null)).toBe("LOGO_FLATTEN");
    expect(resolveTracePromptMode("logo", "PRESERVE_LOGOS")).toBe("LOGO_FLATTEN");
    expect(resolveTracePromptMode("mockup", "ERASE_LOGOS")).toBe("ERASE_LOGOS");
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

  it("keeps logo editing source-bound instead of requesting a redraw", () => {
    const prompt = buildNanoBananaPrompt("LOGO_FLATTEN");
    const systemPrompt = buildNanoBananaSystemPrompt("LOGO_FLATTEN");

    expect(prompt).toContain("The visible logo is the source of truth");
    expect(prompt).toContain("do not typeset, autocorrect, complete an unreadable word");
    expect(prompt).toContain("retain its visible form instead of guessing");
    expect(prompt).toContain("Keep enclosed colored fields, badges, plates");
    expect(prompt).toContain("white #FFFFFF through all four canvas edges");
    expect(systemPrompt).toContain("Do not redraw, redesign, typeset");
    expect(systemPrompt).toContain("preserve its visible pixels instead of guessing");
    expect(prompt).not.toContain("vector-style copy");
    expect(prompt).not.toContain("Mentally overlay a 10 x 10 grid");
    expect(prompt.length).toBeLessThan(2500);
  });

  it("keeps Clean Pattern Only torso reconstruction conservative", () => {
    const prompt = buildNanoBananaPrompt("ERASE_LOGOS");
    const systemPrompt = buildNanoBananaSystemPrompt("ERASE_LOGOS");

    expect(prompt).toContain("Detect the torso/body-panel boundary");
    expect(prompt).toContain("Do not pull artwork from the collar or sleeves");
    expect(prompt).toContain("One visible endpoint is not enough evidence");
    expect(prompt).toContain("all visible sides of the removed element are the same plain color");
    expect(prompt).toContain("pattern-edge inventory must equal the visible source inventory");
    expect(prompt).toContain("Upper-chest audit");
    expect(prompt).toContain("a source area that is otherwise plain must remain plain");
    expect(prompt).not.toContain("carry the edge across at the same angle until it meets the next shape");
    expect(systemPrompt).toContain("CLEAN PATTERN ONLY");
    expect(systemPrompt).toContain("TORSO ONLY");
    expect(systemPrompt).toContain("ZERO NEW GEOMETRY");
    expect(systemPrompt).toContain("One endpoint is never permission");
  });

  it("makes literal source fidelity the system-level priority", () => {
    const prompt = buildNanoBananaSystemPrompt("PRESERVE_LOGOS");

    expect(prompt).toContain("SOURCE IDENTITY LOCK");
    expect(prompt).toContain("OBSERVED BEFORE INFERRED");
    expect(prompt).toContain("Photographic shadows, reflections, highlights");
    expect(prompt).toContain("If \"cleaner\" conflicts with \"closer to the source,\"");
  });
});
