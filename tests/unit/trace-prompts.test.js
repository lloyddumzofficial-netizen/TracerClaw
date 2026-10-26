import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  buildNanoBananaPrompt,
  buildNanoBananaSystemPrompt,
  getNanoBananaInputTuning,
  NANO_BANANA_EDIT_MODEL,
  resolveTracePromptMode,
} from "@/lib/tracePrompts";

describe("trace prompt source fidelity", () => {
  it("keeps unrelated logo and flat-pattern prompts byte-for-byte unchanged", () => {
    const digest = (value) => createHash("sha256").update(value).digest("hex");
    const expected = {
      LOGO_FLATTEN: ["c3316d5ddcdb7a4c09f24e2d205e410d9ca417a72db916ad3b520f35f67dad95", "b7d359ea11f474f202166eb80cd8f2a961f67eff5f152e1f71b2fa9ac18917bc"],
      PATTERN_CLEAN: ["0adf40488f5efe925f73fd7f6011ce80bf8bc9ae39783e6910a3ecfdf6f78cc4", "22175b3b3b8195a2f55e7094fa64073737b409ea17df637611c65213f70f856b"],
      PATTERN_PRESERVE: ["c68cd376527c28b95f5e4af073f97353fb1fecf9b99ccc7ecc9d646e511f23bb", "22175b3b3b8195a2f55e7094fa64073737b409ea17df637611c65213f70f856b"],
    };
    for (const [mode, [promptHash, systemHash]] of Object.entries(expected)) {
      expect(digest(buildNanoBananaPrompt(mode))).toBe(promptHash);
      expect(digest(buildNanoBananaSystemPrompt(mode))).toBe(systemHash);
    }
  });

  it.each(["ERASE_LOGOS", "PRESERVE_LOGOS"])(
    "excludes crop margins and physical construction without changing print identity in %s",
    (mode) => {
      const prompt = buildNanoBananaPrompt(mode);
      const system = buildNanoBananaSystemPrompt(mode);

      expect(prompt).toContain("CROP-MARGIN TEST");
      expect(prompt).toContain("STRUCTURE VS PRINT");
      expect(prompt).toContain("physical neck/armhole binding");
      expect(prompt).toContain("buttons, or hem stitching even if it occupies only a few pixels");
      expect(prompt).toContain("White that belongs to the torso design remains white artwork");
      expect(prompt).toContain("do not crop away retained artwork or borrow sleeve colors");
      expect(prompt).toContain("nine corresponding positions within the selected TORSO ARTWORK");
      expect(prompt).toContain("never combine front and back artwork");
      expect(prompt).toContain("Genuine printed bands within the torso remain artwork");
      expect(system).toContain("crop");
      expect(system).toContain("placket");
      expect(system).toContain("buttons");

      // These former clauses encouraged copying the mockup's framing or
      // bleeding every interior motif to the edges rather than flattening it.
      expect(prompt).not.toContain("that crop is the whole subject");
      expect(prompt).not.toContain("Every color zone, stripe, and facet bleeds fully to all four edges");
      expect(prompt).not.toContain("visually indistinguishable from the input");
      expect(prompt).not.toContain("reproduce ONLY the front panel");
      expect(prompt).not.toContain("a repeating artwork panel");
    },
  );

  it("preserves the different removal contracts and existing garment settings", () => {
    const clean = buildNanoBananaPrompt("ERASE_LOGOS");
    const preserve = buildNanoBananaPrompt("PRESERVE_LOGOS");
    expect(clean).toContain("This mode removes EXACTLY THREE THINGS");
    expect(clean).toContain("THE MASCOT AND ALL CHARACTER ARTWORK");
    expect(preserve).toContain("KEEP COMPLETE DESIGN preserves the print");
    expect(preserve).toContain("Do not remove player names");
    expect(preserve).toContain("Do not remove player numbers");
    expect(preserve).toContain("Exclude lettering confined to an incidental sleeve");
    expect(buildNanoBananaPrompt(undefined)).toBe(preserve);
    for (const mode of ["ERASE_LOGOS", "PRESERVE_LOGOS"]) {
      expect(getNanoBananaInputTuning(mode)).toEqual({
        resolution: "2K", output_format: "png", num_images: 1, enable_web_search: false,
      });
    }
  });

  it("keeps Pattern Workspace isolated, non-destructive by default, and at 4K", () => {
    expect(resolveTracePromptMode("pattern", "PATTERN_CLEAN")).toBe("PATTERN_CLEAN");
    expect(resolveTracePromptMode("pattern", "PATTERN_PRESERVE")).toBe("PATTERN_PRESERVE");
    expect(resolveTracePromptMode("pattern", "ERASE_LOGOS")).toBe("PATTERN_PRESERVE");
    expect(resolveTracePromptMode("pattern", null)).toBe("PATTERN_PRESERVE");

    const tuning = getNanoBananaInputTuning("PATTERN_PRESERVE");
    expect(tuning).toMatchObject({ resolution: "4K", output_format: "png", enable_web_search: false });
    expect(buildNanoBananaSystemPrompt("PATTERN_PRESERVE")).toContain("already-flat pattern");
    expect(buildNanoBananaSystemPrompt("PATTERN_PRESERVE")).not.toContain("TORSO ONLY");
    expect(buildNanoBananaPrompt("PATTERN_PRESERVE")).toContain("Do not typeset, autocorrect");
    expect(buildNanoBananaPrompt("PATTERN_CLEAN")).toContain("Remove all text, names, numbers, logos, badges");
    expect(buildNanoBananaPrompt("PATTERN_CLEAN")).toContain("Reconstruct only the artwork directly underneath removed branding");
  });

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
