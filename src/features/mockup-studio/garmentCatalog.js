const TOP_OPTIONAL_PARTS = ["collar", "left_cuff", "right_cuff", "logo", "style_reference"];
const SHORTS_OPTIONAL_PARTS = ["waistband", "logo", "style_reference"];

export const GARMENT_CATALOG = Object.freeze({
  sports_tshirt: {
    label: "Sports T-shirt",
    shortLabel: "T-shirt",
    description: "Round neck · set-in short sleeves",
    kind: "top",
    requiredParts: ["front", "back", "left_sleeve", "right_sleeve"],
    optionalParts: TOP_OPTIONAL_PARTS,
    construction: "a true short-sleeve sports T-shirt with a circular crew neck, conventional set-in shoulder seams and sleeves ending above the elbow",
    exclusions: "Never add raglan seams, a polo placket, a V neck, a Mandarin collar, sleeveless armholes, three-quarter sleeves or long sleeves",
  },
  vneck_jersey: {
    label: "V-neck Jersey",
    shortLabel: "V-neck",
    description: "V neckline · set-in short sleeves",
    kind: "top",
    requiredParts: ["front", "back", "left_sleeve", "right_sleeve"],
    optionalParts: TOP_OPTIONAL_PARTS,
    construction: "a short-sleeve sports jersey with a clean symmetrical V-neck binding, conventional set-in shoulder seams and sleeves ending above the elbow",
    exclusions: "Never turn the V neck into a crew neck, polo collar or Mandarin collar; never add raglan seams, sleeveless armholes or long sleeves",
  },
  raglan_jersey: {
    label: "Raglan Jersey",
    shortLabel: "Raglan",
    description: "Round neck · raglan short sleeves",
    kind: "top",
    requiredParts: ["front", "back", "left_sleeve", "right_sleeve"],
    optionalParts: TOP_OPTIONAL_PARTS,
    construction: "a short-sleeve raglan sports jersey with a circular crew neck and diagonal raglan seams running cleanly from collar to underarm",
    exclusions: "Never use set-in shoulder seams, a polo placket, a V neck, a Mandarin collar, sleeveless armholes or long sleeves",
  },
  polo_jersey: {
    label: "Polo Jersey",
    shortLabel: "Polo",
    description: "Folded polo collar · short sleeves",
    kind: "top",
    requiredParts: ["front", "back", "left_sleeve", "right_sleeve"],
    optionalParts: ["logo", "style_reference"],
    construction: "a true short-sleeve performance polo with a structured folded collar, short reinforced center placket and conventional set-in sleeves ending above the elbow",
    exclusions: "Never remove the folded collar or placket; never create a crew neck, V neck, Mandarin collar, raglan sleeve, sleeveless armhole or long sleeve",
  },
  chinese_collar_jersey: {
    label: "Chinese Collar Jersey",
    shortLabel: "Chinese collar",
    description: "Mandarin collar · short sleeves",
    kind: "top",
    requiredParts: ["front", "back", "left_sleeve", "right_sleeve"],
    optionalParts: ["collar", "placket", "left_cuff", "right_cuff", "logo", "style_reference"],
    construction: "a short-sleeve performance jersey with a low upright Mandarin collar, clean collar stand, compact center opening and conventional set-in sleeves ending above the elbow",
    exclusions: "Never fold the collar like a polo, convert it to a crew or V neck, add raglan seams, sleeveless armholes or long sleeves",
  },
  long_sleeve_jersey: {
    label: "Long-sleeve Jersey",
    shortLabel: "Long sleeve",
    description: "Round neck · full-length sleeves",
    kind: "top",
    requiredParts: ["front", "back", "left_sleeve", "right_sleeve"],
    optionalParts: TOP_OPTIONAL_PARTS,
    construction: "a true long-sleeve performance jersey with a circular crew neck, full-length anatomically shaped sleeves reaching both wrists and fitted separate cuffs",
    exclusions: "Never shorten either sleeve, expose the forearms, make it sleeveless, add a polo placket, V neck or Mandarin collar",
  },
  basketball_jersey: {
    label: "Basketball Jersey",
    shortLabel: "Basketball",
    description: "Sleeveless · scoop neck · side panels",
    kind: "top",
    shotFamily: "basketball",
    requiredParts: ["front", "back", "left_side_panel", "right_side_panel"],
    optionalParts: ["collar", "logo", "style_reference"],
    construction: "a true sleeveless basketball jersey with a deep athletic scoop neck, bound armholes, wide shoulder straps and separate left and right torso side panels",
    exclusions: "Never add sleeves, cuffs, raglan seams, a polo placket, folded collar, Mandarin collar or football-shirt proportions",
  },
  basketball_shorts: {
    label: "Basketball Shorts",
    shortLabel: "Shorts",
    description: "Elastic waistband · four production panels",
    kind: "shorts",
    requiredParts: ["shorts_front", "shorts_back", "shorts_left_side", "shorts_right_side"],
    optionalParts: SHORTS_OPTIONAL_PARTS,
    construction: "a standalone pair of knee-length basketball shorts with a structured elastic waistband, athletic rise, separate front and back panels, left and right side inserts and a clean double-needle hem",
    exclusions: "Never create a shirt, jersey, sleeves, collar, full tracksuit, compression tights, pockets or drawstrings unless visibly supplied",
  },
  basketball_kit: {
    label: "Basketball Full Kit",
    shortLabel: "Full kit",
    description: "Sleeveless jersey + matching shorts",
    kind: "kit",
    requiredParts: ["front", "back", "left_side_panel", "right_side_panel", "shorts_front", "shorts_back", "shorts_left_side", "shorts_right_side"],
    optionalParts: ["collar", "waistband", "logo", "style_reference"],
    construction: "one coordinated basketball uniform consisting of a sleeveless scoop-neck jersey with bound armholes and a separate matching pair of knee-length basketball shorts with an elastic waistband and anatomically correct side panels",
    exclusions: "Never add sleeves, cuffs, a polo collar, Mandarin collar, football-shirt construction, tracksuit trousers or mismatched jersey and shorts materials",
  },
});

export const AVAILABLE_GARMENT_TYPES = Object.freeze(["sports_tshirt", "polo_jersey"]);

export const AVAILABLE_GARMENT_CATALOG = Object.freeze(Object.fromEntries(
  AVAILABLE_GARMENT_TYPES.map(type => [type, GARMENT_CATALOG[type]]),
));

export const DEFAULT_GARMENT_TYPE = "sports_tshirt";

export function isGarmentTypeAvailable(value) {
  return AVAILABLE_GARMENT_TYPES.includes(value);
}

export function getGarmentProfile(value) {
  if (value === "sports_raglan") return GARMENT_CATALOG.raglan_jersey;
  return GARMENT_CATALOG[value] || GARMENT_CATALOG[DEFAULT_GARMENT_TYPE];
}

export function getSafeGarmentType(value) {
  if (value === "sports_raglan") return "raglan_jersey";
  return GARMENT_CATALOG[value] ? value : DEFAULT_GARMENT_TYPE;
}

export function getGarmentParts(value) {
  const profile = getGarmentProfile(value);
  return { required: profile.requiredParts, optional: profile.optionalParts };
}

export function isGarmentPartAllowed(garmentType, role) {
  const profile = getGarmentProfile(garmentType);
  return profile.requiredParts.includes(role) || profile.optionalParts.includes(role);
}

export function getGarmentShotLabel(garmentType, shotKey) {
  const profile = getGarmentProfile(garmentType);
  if (shotKey === "sleeve" && profile.shotFamily === "basketball") return "Armhole & side";
  if (shotKey === "sleeve" && profile.kind === "shorts") return "Side panel";
  if (shotKey === "sleeve" && profile.kind === "kit") return "Kit side";
  if (shotKey === "detail" && profile.kind === "shorts") return "Waistband detail";
  if (shotKey === "detail" && profile.kind === "kit") return "Kit detail";
  return { hero: "Hero 3/4", front: "Front", back: "Back", sleeve: "Sleeve", detail: "Detail" }[shotKey] || shotKey;
}
