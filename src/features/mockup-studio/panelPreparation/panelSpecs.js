const TSHIRT_BODY_SPEC = Object.freeze({
  width: 2000,
  height: 2865,
  safeInset: 6,
  orientation: "body",
  guidance: "Keep critical logos, names and numbers inside the safe area. Align the artwork center with the collar and hem centerline.",
});

const TSHIRT_SLEEVE_SPEC = Object.freeze({
  width: 2000,
  height: 1036,
  safeInset: 7,
  orientation: "sleeve",
  guidance: "Keep critical sleeve artwork away from the shoulder, underarm and cuff seam allowance.",
});

const POLO_BODY_SPEC = Object.freeze({
  width: 2000,
  height: 3037,
  safeInset: 6,
  orientation: "body",
  guidance: "This frame follows the Polo PSD body Smart Object ratio. Keep critical marks clear of the folded collar, placket, side seams and hem allowance.",
});

const POLO_SLEEVE_SPEC = Object.freeze({
  width: 1600,
  height: 1600,
  safeInset: 7,
  orientation: "sleeve",
  guidance: "This square frame follows the Polo PSD sleeve Smart Object. Keep critical sleeve artwork away from the shoulder, underarm and cuff seams.",
});

const TSHIRT_PANEL_SPECS = Object.freeze({
  front: Object.freeze({ ...TSHIRT_BODY_SPEC, label: "Front body", topGuide: "COLLAR CENTER", bottomGuide: "HEM CENTER" }),
  back: Object.freeze({ ...TSHIRT_BODY_SPEC, label: "Back body", topGuide: "REAR COLLAR", bottomGuide: "HEM CENTER" }),
  left_sleeve: Object.freeze({ ...TSHIRT_SLEEVE_SPEC, label: "Left sleeve", topGuide: "SHOULDER SEAM", bottomGuide: "CUFF EDGE" }),
  right_sleeve: Object.freeze({ ...TSHIRT_SLEEVE_SPEC, label: "Right sleeve", topGuide: "SHOULDER SEAM", bottomGuide: "CUFF EDGE" }),
});

const POLO_FRONT_SPEC = Object.freeze({
  ...POLO_BODY_SPEC,
  label: "Front body",
  topGuide: "COLLAR CENTER",
  bottomGuide: "HEM CENTER",
  centerExclusion: "PLACKET ZONE",
});

const POLO_PANEL_SPECS = Object.freeze({
  front: POLO_FRONT_SPEC,
  back: Object.freeze({ ...POLO_BODY_SPEC, label: "Back body", topGuide: "REAR COLLAR", bottomGuide: "HEM CENTER" }),
  left_sleeve: Object.freeze({ ...POLO_SLEEVE_SPEC, label: "Left sleeve", topGuide: "SHOULDER SEAM", bottomGuide: "CUFF EDGE" }),
  right_sleeve: Object.freeze({ ...POLO_SLEEVE_SPEC, label: "Right sleeve", topGuide: "SHOULDER SEAM", bottomGuide: "CUFF EDGE" }),
});

const GARMENT_PANEL_SPECS = Object.freeze({
  sports_tshirt: TSHIRT_PANEL_SPECS,
  polo_jersey: POLO_PANEL_SPECS,
});

export function getPanelPreparationSpec(garmentType, role) {
  return GARMENT_PANEL_SPECS[garmentType]?.[role] || null;
}

export function matchesPanelPreparationSpec(spec, width, height) {
  return !spec || (Number(width) === spec.width && Number(height) === spec.height);
}
