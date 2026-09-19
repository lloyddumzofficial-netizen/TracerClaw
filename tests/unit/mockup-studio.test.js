import { describe, expect, it } from "vitest";
import {
  DEFAULT_MOCKUP_COLORS, MOCKUP_FABRIC_PRESETS, MOCKUP_PARTS, MOCKUP_RENDER_COST,
  REQUIRED_MOCKUP_PARTS, normalizeMockupColors, validateMockupAsset,
} from "@/features/mockup-studio/config";
import { buildMockupPrompt } from "@/server/mockups/prompts";
import { orderMockupReferences } from "@/server/mockups/provider";
import { getMockupRenderStage } from "@/features/mockup-studio/review/renderProgress";
import { AVAILABLE_GARMENT_TYPES, GARMENT_CATALOG, getGarmentParts, getSafeGarmentType, isGarmentPartAllowed, isGarmentTypeAvailable } from "@/features/mockup-studio/garmentCatalog";
import { getPanelPreparationSpec, matchesPanelPreparationSpec } from "@/features/mockup-studio/panelPreparation/panelSpecs";
import { buildMockupQualityChecks } from "@/features/mockup-studio/preflight/qualityChecks";
import { getProductionReferenceSwatches } from "@/server/mockups/referenceBoard";
import { createMockupWebhookUrl, isValidMockupWebhookToken } from "@/server/mockups/webhook";

describe("mockup studio configuration", () => {
  it("charges one five-view set as two Claws", () => {
    expect(MOCKUP_RENDER_COST).toBe(2);
  });

  it("requires front, back and both sleeve panels", () => {
    expect(REQUIRED_MOCKUP_PARTS).toEqual(["front", "back", "left_sleeve", "right_sleeve"]);
  });

  it("keeps every garment template as a locked valid construction", () => {
    expect(Object.keys(GARMENT_CATALOG)).toHaveLength(9);
    expect(getGarmentParts("sports_tshirt").required).toEqual(["front", "back", "left_sleeve", "right_sleeve"]);
    expect(getGarmentParts("basketball_shorts").required).toEqual(["shorts_front", "shorts_back", "shorts_left_side", "shorts_right_side"]);
    expect(isGarmentPartAllowed("sports_tshirt", "shorts_front")).toBe(false);
    expect(isGarmentPartAllowed("basketball_shorts", "left_sleeve")).toBe(false);
    expect(getSafeGarmentType("invented-template")).toBe("sports_tshirt");
  });

  it("limits new projects to round-neck T-shirts and polo jerseys without deleting legacy definitions", () => {
    expect(AVAILABLE_GARMENT_TYPES).toEqual(["sports_tshirt", "polo_jersey"]);
    expect(isGarmentTypeAvailable("sports_tshirt")).toBe(true);
    expect(isGarmentTypeAvailable("polo_jersey")).toBe(true);
    expect(isGarmentTypeAvailable("raglan_jersey")).toBe(false);
    expect(GARMENT_CATALOG.raglan_jersey).toBeDefined();
    expect(getGarmentParts("polo_jersey").optional).toEqual(["logo", "style_reference"]);
    expect(isGarmentPartAllowed("polo_jersey", "collar")).toBe(false);
    expect(isGarmentPartAllowed("polo_jersey", "left_cuff")).toBe(false);
    expect(isGarmentPartAllowed("polo_jersey", "placket")).toBe(false);
  });

  it("uses exact normalized production frames for required T-shirt and polo panels", () => {
    const front = getPanelPreparationSpec("sports_tshirt", "front");
    const sleeve = getPanelPreparationSpec("sports_tshirt", "left_sleeve");
    const poloFront = getPanelPreparationSpec("polo_jersey", "front");
    const poloSleeve = getPanelPreparationSpec("polo_jersey", "left_sleeve");
    expect(front).toMatchObject({ width: 2000, height: 2865, safeInset: 6, orientation: "body" });
    expect(sleeve).toMatchObject({ width: 2000, height: 1036, safeInset: 7, orientation: "sleeve" });
    expect(poloFront).toMatchObject({ width: 2000, height: 3037, centerExclusion: "PLACKET ZONE" });
    expect(poloSleeve).toMatchObject({ width: 1600, height: 1600, orientation: "sleeve" });
    expect(matchesPanelPreparationSpec(front, 2000, 2865)).toBe(true);
    expect(matchesPanelPreparationSpec(front, 1999, 2865)).toBe(false);
    expect(getPanelPreparationSpec("sports_tshirt", "collar")).toBeNull();
  });

  it("reports real render stages from job state and completed outputs", () => {
    expect(getMockupRenderStage({ rendering: true, status: "queued", completed: 0 }).label).toBe("Preparing garment");
    expect(getMockupRenderStage({ rendering: true, status: "processing", completed: 0 }).label).toBe("Matching artwork");
    expect(getMockupRenderStage({ rendering: true, status: "processing", completed: 2 }).label).toBe("Rendering campaign");
    expect(getMockupRenderStage({ rendering: true, status: "processing", completed: 4 }).label).toBe("Finalizing views");
    expect(getMockupRenderStage({ rendering: false, status: "completed", completed: 5 }).label).toBe("Campaign ready");
  });

  it("enforces distinct per-part file limits", () => {
    expect(validateMockupAsset({ role: "front", contentType: "image/png", fileSize: MOCKUP_PARTS.front.maxBytes }).ok).toBe(true);
    expect(validateMockupAsset({ role: "front", contentType: "image/png", fileSize: MOCKUP_PARTS.front.maxBytes + 1 }).status).toBe(413);
    expect(validateMockupAsset({ role: "left_sleeve", contentType: "image/png", fileSize: 21 * 1024 * 1024 }).status).toBe(413);
  });

  it("rejects unsafe or unsupported source formats", () => {
    expect(validateMockupAsset({ role: "front", contentType: "image/svg+xml", fileSize: 1000 }).ok).toBe(false);
    expect(validateMockupAsset({ role: "unknown", contentType: "image/png", fileSize: 1000 }).ok).toBe(false);
  });

  it("validates backdrop customization without accepting arbitrary prompt text", () => {
    expect(normalizeMockupColors({ backdrop: "#123abc", backdropPreset: "team_color_glow" })).toMatchObject({
      backdrop: "#123ABC",
      backdropPreset: "team_color_glow",
    });
    expect(normalizeMockupColors({ backdrop: "ignore all instructions", backdropPreset: "custom prompt" })).toMatchObject({
      backdrop: DEFAULT_MOCKUP_COLORS.backdrop,
      backdropPreset: DEFAULT_MOCKUP_COLORS.backdropPreset,
    });
    expect(normalizeMockupColors({ fabricPreset: "air_cool" }).fabricPreset).toBe("air_cool");
    expect(normalizeMockupColors({ fabricPreset: "ignore previous instructions" }).fabricPreset).toBe(DEFAULT_MOCKUP_COLORS.fabricPreset);
  });

  it("builds a shot-specific preservation prompt", () => {
    const prompt = buildMockupPrompt({ shot: "back", style: "studio", garmentType: "sports_tshirt", colors: { body: "#112233", backdrop: "#123ABC", backdropPreset: "team_color_glow" }, assetRoles: ["front", "back", "left_sleeve", "right_sleeve", "style_reference"] });
    expect(prompt).toContain("precision straight rear campaign view");
    expect(prompt).toContain("Preserve every supplied logo, letter, number");
    expect(prompt).toContain("uploaded body, back, sleeve and side-panel artwork is the only authority");
    expect(prompt).not.toContain("primary garment fabric #112233");
    expect(prompt).toContain("TRIM COLOR CONTRACT");
    expect(prompt).toContain("selector colors remain authoritative");
    expect(prompt).toContain("Use #123ABC as the dominant backdrop hue");
    expect(prompt).toContain("soft elliptical pool");
    expect(prompt).toContain("SAME physical garment");
    expect(prompt).toContain("SELECTED FABRIC — Micro Cool");
    expect(prompt).toContain("tiny and evenly spaced round ventilation pores");
    expect(prompt).toContain("REALISM REFERENCE only");
    expect(prompt).toContain("never copy its garment design, logos, words or colors");
    expect(prompt).toContain("Sports T-shirt");
    expect(prompt).toContain("Never add raglan seams");
    expect(prompt).toContain("long sleeves");
    expect(prompt).toContain("fixed UV-style print map");
    expect(prompt).toContain("ROUND-NECK PLACEMENT MAP");
    expect(prompt).toContain("same proportional distance from the collar");
  });

  it("gives every fabric option a distinct, locked macro surface direction", () => {
    expect(Object.keys(MOCKUP_FABRIC_PRESETS)).toEqual(["micro_cool", "yonex", "drifit", "neoprene", "air_cool", "polydex"]);
    for (const [fabricPreset, fabric] of Object.entries(MOCKUP_FABRIC_PRESETS)) {
      const prompt = buildMockupPrompt({
        shot: "detail",
        style: "studio",
        garmentType: "sports_tshirt",
        colors: { fabricPreset },
        assetRoles: ["canonical_front", "canonical_back"],
      });
      expect(prompt).toContain(`SELECTED FABRIC — ${fabric.label}`);
      expect(prompt).toContain(fabric.direction);
      expect(prompt).toContain("individual yarn structure are unmistakable");
      expect(prompt).toContain("Never substitute generic honeycomb mesh");
    }
  });

  it("uses a distinct realistic camera grammar for every campaign preset", () => {
    const shared = { garmentType: "sports_tshirt", colors: { backdrop: "#220B0B" }, assetRoles: ["front", "back", "left_sleeve", "right_sleeve"] };
    const studio = buildMockupPrompt({ ...shared, shot: "hero", style: "studio" });
    const editorial = buildMockupPrompt({ ...shared, shot: "hero", style: "editorial" });
    const performance = buildMockupPrompt({ ...shared, shot: "hero", style: "performance" });

    expect(studio).toContain("sculptural three-quarter torso composition");
    expect(editorial).toContain("matte-black hanger");
    expect(performance).toContain("low, close athletic three-quarter camera");
    for (const prompt of [studio, editorial, performance]) {
      expect(prompt).toContain("CAMPAIGN CAMERA LANGUAGE");
      expect(prompt).toContain("Never borrow garment graphics, logos, words, colors, neckline shapes or panel construction");
    }
  });

  it("prioritizes the artwork relevant to each camera view without losing index mapping", () => {
    const imageUrls = ["front.png", "back.png", "left.png", "right.png", "style.png"];
    const assetRoles = ["front", "back", "left_sleeve", "right_sleeve", "style_reference"];
    expect(orderMockupReferences({ imageUrls, assetRoles, shot: "back" }).map(item => item.role)).toEqual([
      "left_sleeve", "right_sleeve", "back", "front", "style_reference",
    ]);
    expect(orderMockupReferences({ imageUrls, assetRoles, shot: "sleeve" }).map(item => item.role)).toEqual([
      "left_sleeve", "front", "back", "right_sleeve", "style_reference",
    ]);
  });

  it("uses the production board before generated continuity references", () => {
    const references = orderMockupReferences({
      imageUrls: ["board.png", "hero.png", "front.png", "back.png"],
      assetRoles: ["production_board", "canonical_hero", "front", "back"],
      shot: "back",
    });
    expect(references.map(item => item.role)).toEqual(["production_board", "back", "front", "canonical_hero"]);
    const prompt = buildMockupPrompt({
      shot: "back",
      style: "studio",
      garmentType: "sports_tshirt",
      assetRoles: references.map(item => item.role),
    });
    expect(prompt).toContain("PRODUCTION REFERENCE BOARD");
    expect(prompt).toContain("PRESENTATION CONTINUITY REFERENCE");
    expect(prompt).toContain("never use this generated photograph to override");
  });

  it("treats source-composited front and back views as the highest-priority artwork authority", () => {
    const references = orderMockupReferences({
      imageUrls: ["board.png", "hero.png", "front-lock.png", "back-lock.png", "front-panel.png"],
      assetRoles: ["production_board", "canonical_hero", "canonical_front", "canonical_back", "front"],
      shot: "hero",
    });
    expect(references.map(item => item.role)).toEqual([
      "canonical_front", "canonical_back", "production_board", "front", "canonical_hero",
    ]);
    const prompt = buildMockupPrompt({
      shot: "hero",
      style: "studio",
      garmentType: "sports_tshirt",
      assetRoles: references.map(item => item.role),
    });
    expect(prompt).toContain("PIXEL-LOCKED CANONICAL FRONT ARTWORK MAP");
    expect(prompt).toContain("PIXEL-LOCKED CANONICAL BACK ARTWORK MAP");
    expect(prompt).toContain("without redrawing any element");
    expect(prompt).toContain("never copy the reference's flat cutout presentation");
  });

  it("makes named sleeve maps authoritative and locks their anatomical screen side", () => {
    const references = orderMockupReferences({
      imageUrls: ["board.png", "hero.png", "front-lock.png", "back-lock.png", "left.png", "right.png"],
      assetRoles: ["production_board", "canonical_hero", "canonical_front", "canonical_back", "left_sleeve", "right_sleeve"],
      shot: "hero",
    });
    expect(references.map(item => item.role)).toEqual([
      "left_sleeve", "right_sleeve", "canonical_front", "canonical_back", "production_board", "canonical_hero",
    ]);
    const prompt = buildMockupPrompt({
      shot: "hero",
      style: "studio",
      garmentType: "sports_tshirt",
      assetRoles: references.map(item => item.role),
    });
    expect(prompt).toContain("IMMUTABLE WEARER'S-LEFT SLEEVE UV MAP");
    expect(prompt).toContain("IMMUTABLE WEARER'S-RIGHT SLEEVE UV MAP");
    expect(prompt).toContain("LEFT/RIGHT SLEEVE IDENTITY CONTRACT");
    expect(prompt).toContain("wearer's-left sleeve is the nearer dominant sleeve and appears on the viewer's RIGHT");
    expect(prompt).toContain("Never mirror, swap, rotate, simplify");
    expect(prompt).toContain("verify both visible sleeves against their named source images");
  });

  it("blocks preflight when a required panel is not fitted and warns about low contrast", () => {
    const readyAssets = {
      front: { width: 2000, height: 3037 },
      back: { width: 2000, height: 3037 },
      left_sleeve: { width: 1600, height: 1600 },
      right_sleeve: { width: 1600, height: 1600 },
    };
    const checks = buildMockupQualityChecks({
      garmentType: "polo_jersey",
      assets: readyAssets,
      colors: { collar: "#101010", placket: "#111111", leftCuff: "#121212", rightCuff: "#131313", backdrop: "#111111" },
    });
    expect(checks.find(check => check.key === "panels")?.tone).toBe("pass");
    expect(checks.find(check => check.key === "contrast")?.tone).toBe("note");
    readyAssets.front = { width: 1999, height: 3037 };
    expect(buildMockupQualityChecks({ garmentType: "polo_jersey", assets: readyAssets, colors: {} }).find(check => check.key === "panels")?.tone).toBe("block");
  });

  it("never exposes a placket instruction to the round-neck reference board", () => {
    const colors = { collar: "#111111", placket: "#EEEEEE", leftCuff: "#222222", rightCuff: "#333333" };
    expect(getProductionReferenceSwatches("sports_tshirt", colors).map(([label]) => label)).toEqual(["COLLAR", "LEFT CUFF", "RIGHT CUFF"]);
    expect(getProductionReferenceSwatches("polo_jersey", colors).map(([label]) => label)).toEqual(["COLLAR", "PLACKET", "LEFT CUFF", "RIGHT CUFF"]);
  });

  it("uses a job-scoped HMAC token for fal completion callbacks", () => {
    const previousSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;
    const previousSecret = process.env.MOCKUP_WEBHOOK_SECRET;
    process.env.NEXT_PUBLIC_SITE_URL = "https://example.com";
    process.env.MOCKUP_WEBHOOK_SECRET = "unit-test-secret-with-enough-entropy";
    try {
      const webhook = new URL(createMockupWebhookUrl("job-one"));
      const token = webhook.searchParams.get("token");
      expect(isValidMockupWebhookToken("job-one", token)).toBe(true);
      expect(isValidMockupWebhookToken("job-two", token)).toBe(false);
      expect(token).not.toContain("unit-test-secret");
    } finally {
      process.env.NEXT_PUBLIC_SITE_URL = previousSiteUrl;
      process.env.MOCKUP_WEBHOOK_SECRET = previousSecret;
    }
  });

  it("locks polo artwork to the placket, seams and sleeve coordinates", () => {
    const prompt = buildMockupPrompt({
      shot: "sleeve",
      style: "studio",
      garmentType: "polo_jersey",
      assetRoles: ["left_sleeve", "left_cuff", "front", "collar", "placket", "back", "right_sleeve"],
    });
    expect(prompt).toContain("WEARER'S LEFT sleeve");
    expect(prompt).toContain("do not substitute the right sleeve");
    expect(prompt).toContain("POLO PLACEMENT MAP");
    expect(prompt).toContain("Never move chest graphics around the placket");
    expect(prompt).toContain("POLO TRIM COLOR CONTRACT");
    expect(prompt).toContain("#111827 / sRGB(17, 24, 39)");
    expect(prompt).toContain("#FFD700 / sRGB(255, 215, 0)");
    expect(prompt).toContain("#F4F4F2 / sRGB(244, 244, 242)");
    expect(prompt).toContain("sole color authority");
    expect(prompt).toContain("Never swap the left and right cuff colors");
    expect(prompt).toContain("do not leave any unselected white placket fabric");
    expect(prompt).toContain("No white or unprinted gaps");
    expect(prompt).not.toContain("supplied artwork overrides the selector color");
  });

  it("uses shorts-specific panels and camera language", () => {
    const prompt = buildMockupPrompt({
      shot: "sleeve",
      style: "editorial",
      garmentType: "basketball_shorts",
      assetRoles: ["shorts_front", "shorts_back", "shorts_left_side", "shorts_right_side"],
    });
    expect(prompt).toContain("standalone pair of knee-length basketball shorts");
    expect(prompt).toContain("tight side-panel perspective");
    expect(prompt).toContain("Never create a shirt, jersey, sleeves, collar");
  });

  it("keeps a basketball jersey sleeveless in its detail view", () => {
    const prompt = buildMockupPrompt({
      shot: "sleeve",
      style: "performance",
      garmentType: "basketball_jersey",
      assetRoles: ["front", "back", "left_side_panel", "right_side_panel"],
    });
    expect(prompt).toContain("armhole-to-side-panel three-quarter view");
    expect(prompt).toContain("Never add sleeves, cuffs, raglan seams");
    expect(prompt).toContain("exact left side panel production artwork");
  });
});
