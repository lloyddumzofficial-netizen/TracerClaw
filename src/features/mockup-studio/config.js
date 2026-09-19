export const MOCKUP_MODEL = "fal-ai/nano-banana-2/edit";
export const MOCKUP_RENDER_COST = 2;
export const MOCKUP_TOTAL_MAX_BYTES = 150 * 1024 * 1024;
export const MOCKUP_MAX_PIXELS = 8192;

export const MOCKUP_BACKDROP_PRESETS = Object.freeze({
  cinematic_gradient: {
    label: "Cinematic gradient",
    description: "Deep tonal falloff with controlled edge light.",
    direction: "a seamless cyclorama that begins near-black at the edges and blooms into a restrained colored halo behind the jersey, with smooth tonal falloff and no visible horizon line",
  },
  team_color_glow: {
    label: "Team color glow",
    description: "Richer team-color atmosphere behind the garment.",
    direction: "a dark commercial studio with a soft elliptical pool of the selected backdrop color behind the garment, subtle complementary edge light and deep clean corners",
  },
  blackout: {
    label: "Blackout",
    description: "Near-black premium set with sculpted rim light.",
    direction: "a near-black infinity studio with barely visible depth, a narrow controlled rim light separating the jersey silhouette and no decorative environment",
  },
  brushed_studio: {
    label: "Brushed studio",
    description: "Dark tactile wall with understated production depth.",
    direction: "a dark finely brushed studio wall with extremely subtle vertical texture, soft vignette and realistic floor-to-wall depth, kept quiet enough that the jersey remains dominant",
  },
});

// Philippine production names are retained because they are the terms users
// give local jersey suppliers. The directions describe visible construction
// instead of pretending every supplier uses one universal GSM/specification.
export const MOCKUP_FABRIC_PRESETS = Object.freeze({
  micro_cool: {
    label: "Micro Cool",
    description: "Fine micro-perforated knit with tiny, evenly spaced cooling pores.",
    direction: "fine matte micro-polyester sports knit with dense, tiny and evenly spaced round ventilation pores; lighter and tighter than open eyelet mesh; soft flexible drape; sublimation ink visibly absorbed into the yarns without sitting on top",
  },
  yonex: {
    label: "Yonex",
    description: "Compact athletic knit with a refined face and controlled structure.",
    direction: "compact single-face performance polyester knit commonly sold as Yonex fabric in Philippine garment production; very fine understated pebbled knit face, moderate body and shape retention, low sheen, smooth sublimation detail and no large open mesh holes; do not add any Yonex brand mark",
  },
  drifit: {
    label: "Dri-Fit",
    description: "Light moisture-wicking micro-knit with subtle capillary texture.",
    direction: "lightweight moisture-wicking polyester performance knit with a subtle micro-grid or bird's-eye capillary structure; small shallow pores, quick-dry matte face and soft athletic drape; keep the surface textile-realistic and unbranded, with no Nike or Dri-FIT logo",
  },
  neoprene: {
    label: "Neoprene",
    description: "Dense smooth bonded fabric with thicker, sculpted structure.",
    direction: "dense neoprene-like bonded performance fabric with a smooth fine-knit outer face, visibly thicker cross-section, cushioned body and structured sculptural folds; closed surface with no ventilation holes; matte and fabric-faced rather than shiny rubber or wetsuit gloss",
  },
  air_cool: {
    label: "Air Cool",
    description: "Open eyelet mesh with clearly visible airflow holes.",
    direction: "light open-eyelet polyester mesh with clearly visible, regular ventilation holes larger than Micro Cool pores; airy dimensional lattice, soft edges around every opening, low sheen and breathable loose drape; sublimated color remains inside the fibers",
  },
  polydex: {
    label: "Polydex",
    description: "Smooth dense interlock with crisp print definition and heavier drape.",
    direction: "dense smooth double-knit polyester interlock commonly sold as Polydex for sublimation; tight closed face with almost no visible holes, extremely fine knit grain, crisp graphic definition, richer structured drape and a clean matte finish",
  },
});

export const DEFAULT_MOCKUP_COLORS = Object.freeze({
  body: "#111827",
  collar: "#111827",
  placket: "#F4F4F2",
  leftCuff: "#FFD700",
  rightCuff: "#FFD700",
  backdrop: "#071827",
  backdropPreset: "cinematic_gradient",
  fabricPreset: "micro_cool",
});

export const MOCKUP_ALLOWED_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
];

export const MOCKUP_PARTS = Object.freeze({
  front: { label: "Front body", shortLabel: "Front", required: true, maxBytes: 30 * 1024 * 1024 },
  back: { label: "Back body", shortLabel: "Back", required: true, maxBytes: 30 * 1024 * 1024 },
  left_sleeve: { label: "Left sleeve", shortLabel: "L Sleeve", required: true, maxBytes: 20 * 1024 * 1024 },
  right_sleeve: { label: "Right sleeve", shortLabel: "R Sleeve", required: true, maxBytes: 20 * 1024 * 1024 },
  collar: { label: "Collar pattern", shortLabel: "Collar", required: false, maxBytes: 10 * 1024 * 1024 },
  left_cuff: { label: "Left cuff", shortLabel: "L Cuff", required: false, maxBytes: 10 * 1024 * 1024 },
  right_cuff: { label: "Right cuff", shortLabel: "R Cuff", required: false, maxBytes: 10 * 1024 * 1024 },
  placket: { label: "Collar placket", shortLabel: "Placket", required: false, maxBytes: 10 * 1024 * 1024 },
  left_side_panel: { label: "Left side panel", shortLabel: "L Side", required: true, maxBytes: 20 * 1024 * 1024 },
  right_side_panel: { label: "Right side panel", shortLabel: "R Side", required: true, maxBytes: 20 * 1024 * 1024 },
  shorts_front: { label: "Shorts front", shortLabel: "Shorts F", required: true, maxBytes: 30 * 1024 * 1024 },
  shorts_back: { label: "Shorts back", shortLabel: "Shorts B", required: true, maxBytes: 30 * 1024 * 1024 },
  shorts_left_side: { label: "Shorts left side", shortLabel: "Shorts L", required: true, maxBytes: 20 * 1024 * 1024 },
  shorts_right_side: { label: "Shorts right side", shortLabel: "Shorts R", required: true, maxBytes: 20 * 1024 * 1024 },
  waistband: { label: "Waistband pattern", shortLabel: "Waistband", required: false, maxBytes: 10 * 1024 * 1024 },
  logo: { label: "Logo / sponsor", shortLabel: "Logo", required: false, maxBytes: 10 * 1024 * 1024 },
  style_reference: { label: "Realism reference", shortLabel: "Realism", required: false, maxBytes: 15 * 1024 * 1024 },
});

export const REQUIRED_MOCKUP_PARTS = Object.entries(MOCKUP_PARTS)
  .filter(([role]) => ["front", "back", "left_sleeve", "right_sleeve"].includes(role))
  .map(([role]) => role);

export const MOCKUP_SHOTS = Object.freeze([
  { key: "hero", label: "Hero 3/4", description: "Premium three-quarter campaign angle" },
  { key: "front", label: "Front", description: "Straight-on front product view" },
  { key: "back", label: "Back", description: "Straight-on back product view" },
  { key: "sleeve", label: "Sleeve", description: "Side view featuring sleeve and cuff" },
  { key: "detail", label: "Detail", description: "Macro fabric, seam, collar and cuff detail" },
]);

export const MOCKUP_STYLE_PRESETS = Object.freeze({
  studio: {
    label: "Studio Mannequin",
    description: "Sculpted torso views, refined three-quarter angles and construction close-ups.",
    direction: "Use one matte dark graphite headless mannequin form appropriate to the selected garment throughout the set, with believable anatomy and no visible branding. Present it in a premium seamless studio with a large diffused softbox and subtle edge light. The selected garment remains the only visual subject",
  },
  editorial: {
    label: "Hanging Editorial",
    description: "Premium rack angles, natural drape and intimate hanger-mounted details.",
    direction: "Use one simple black hanger or matching minimal garment support appropriate to the selected garment on a dark brushed-metal rack throughout the set. Let every piece hang with natural gravity, accurate fabric weight and restrained editorial shadows",
  },
  performance: {
    label: "Performance Campaign",
    description: "Low athletic angles, sculpted contrast and tactile shoulder details.",
    direction: "Use one matte black athletic headless mannequin form appropriate to the selected garment throughout the set, posed only enough to reveal construction. Use controlled cinematic contrast without haze, motion effects or visual clutter",
  },
});

export function formatMockupMegabytes(bytes) {
  return `${Math.round(bytes / 1024 / 1024)}MB`;
}

export function validateMockupAsset({ role, contentType, fileSize }) {
  const part = MOCKUP_PARTS[role];
  if (!part) return { ok: false, status: 400, error: "Invalid garment part." };

  const normalizedType = String(contentType || "").toLowerCase();
  if (!MOCKUP_ALLOWED_MIME_TYPES.includes(normalizedType)) {
    return { ok: false, status: 400, error: "Use PNG, JPG, or WebP files only." };
  }

  const size = Number(fileSize);
  if (!Number.isFinite(size) || size <= 0) {
    return { ok: false, status: 400, error: "Invalid file size." };
  }
  if (size > part.maxBytes) {
    return {
      ok: false,
      status: 413,
      error: `${part.label} is limited to ${formatMockupMegabytes(part.maxBytes)}.`,
      maxBytes: part.maxBytes,
    };
  }

  return { ok: true, part, contentType: normalizedType, fileSize: size };
}

export function getSafeMockupStyle(value) {
  return MOCKUP_STYLE_PRESETS[value] ? value : "studio";
}

export function getSafeMockupBackdrop(value) {
  return MOCKUP_BACKDROP_PRESETS[value] ? value : DEFAULT_MOCKUP_COLORS.backdropPreset;
}

export function getSafeMockupFabric(value) {
  return MOCKUP_FABRIC_PRESETS[value] ? value : DEFAULT_MOCKUP_COLORS.fabricPreset;
}

export function normalizeMockupColors(value = {}) {
  const colors = value && typeof value === "object" ? value : {};
  const safeHex = (input, fallback) => /^#[0-9a-f]{6}$/i.test(String(input || "")) ? String(input).toUpperCase() : fallback;
  return {
    body: safeHex(colors.body, DEFAULT_MOCKUP_COLORS.body),
    collar: safeHex(colors.collar, DEFAULT_MOCKUP_COLORS.collar),
    placket: safeHex(colors.placket, DEFAULT_MOCKUP_COLORS.placket),
    leftCuff: safeHex(colors.leftCuff, DEFAULT_MOCKUP_COLORS.leftCuff),
    rightCuff: safeHex(colors.rightCuff, DEFAULT_MOCKUP_COLORS.rightCuff),
    backdrop: safeHex(colors.backdrop, DEFAULT_MOCKUP_COLORS.backdrop),
    backdropPreset: getSafeMockupBackdrop(colors.backdropPreset),
    fabricPreset: getSafeMockupFabric(colors.fabricPreset),
  };
}
