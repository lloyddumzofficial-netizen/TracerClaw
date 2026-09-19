import {
  MOCKUP_BACKDROP_PRESETS, MOCKUP_SHOTS, MOCKUP_STYLE_PRESETS,
  getSafeMockupBackdrop, getSafeMockupStyle, normalizeMockupColors,
} from "@/features/mockup-studio/config";
import { getGarmentProfile, getSafeGarmentType } from "@/features/mockup-studio/garmentCatalog";

const SHOT_DIRECTIONS = {
  hero: "controlled cinematic three-quarter hero view from the front-left, camera 8–12 degrees below chest height and garment rotated exactly 24 degrees; show the full jersey from collar to hem with the wearer's left sleeve slightly nearer camera and the right sleeve still readable; use an 85mm full-frame lens from sufficient distance to suppress perspective distortion, preserving the apparent scale and coordinates of every printed element",
  front: "precision front campaign view at chest height, garment square to camera with no more than 2 degrees of rotation; keep the complete neckline or collar, chest artwork, both shoulder/sleeve constructions, cuffs and hem visible; use an 85mm full-frame lens, parallel verticals, symmetrical shoulders and near-orthographic projection so artwork placement can be compared directly with the source panels",
  back: "precision straight rear campaign view at shoulder height, garment square to camera with no more than 2 degrees of rotation; show the complete back artwork, name/number area, rear collar, both sleeve joins and hem; use an 85mm full-frame lens from sufficient distance for near-orthographic projection; absolutely no front artwork may appear and left/right panels must remain anatomically correct",
  sleeve: "precision outer view of the WEARER'S LEFT sleeve, photographed from shoulder seam to cuff at a fixed shallow 10-degree angle; show that complete sleeve panel without rolling it toward the chest, plus only enough collar and front torso to prove garment identity; use a 100mm lens from sufficient distance and keep the complete sleeve artwork in sharp focus at its exact source scale and orientation",
  detail: "controlled macro view of the WEARER'S LEFT sleeve-to-cuff or collar construction using only a real region visible in the supplied panels; use a 100mm macro lens, keep the chosen printed motif at the same seam-relative coordinates as every wider view, and resolve rib knit, double-needle seam, sublimated ink and micro-mesh pores without inventing or rearranging artwork",
};

const SHOT_LIGHTING = {
  hero: "A large gridded softbox rakes across the torso at 45 degrees, with a narrow opposite rim defining the shoulder and sleeve; preserve deep cinematic blacks while retaining textile detail.",
  front: "Broaden the key light for even artwork readability, then add a soft top edge and restrained side fill; retain modeling and dimensional folds instead of flattening the shirt.",
  back: "Move the key slightly behind the garment so the rear shoulder and true construction seams catch a controlled highlight; use soft frontal fill so back graphics remain fully readable.",
  sleeve: "Use grazing side light parallel to the fabric surface to reveal weave, piping and seam relief; keep highlights textile-soft and never glossy.",
  detail: "Use a large diffused strip light at a very low grazing angle so individual fibers, pores, stitches and absorbed ink become visible without harsh specular clipping.",
};

const SHORTS_SHOT_DIRECTIONS = {
  hero: "cinematic low three-quarter hero view of one standalone pair of basketball shorts, suspended or worn on a matte lower-body mannequin, rotated 28–35 degrees so the front, waistband and one side insert are visible; show the complete garment from waistband to both hems with a 70mm lens",
  front: "premium front product view of the basketball shorts from slightly below waistband height, turned only 6–10 degrees off-axis; show the complete waistband, rise, both front legs, side inserts and hems with an 85mm lens",
  back: "rear three-quarter construction view of the same basketball shorts, rotated 22–28 degrees; keep the complete back, waistband, seat construction, both side panels and hems readable with correct left/right anatomy",
  sleeve: "tight side-panel perspective running from waistband to hem, composed around one complete side insert while enough front and back fabric remains visible to prove it is the same pair of shorts",
  detail: "extreme macro textile view at the waistband, side-panel junction or double-needle hem, resolving elastic channels, micro-mesh pores, sublimated ink and stitching at true optical scale",
};

const BASKETBALL_SHOT_DIRECTIONS = {
  hero: "cinematic low three-quarter hero view from the front-left, camera 10–15 degrees below chest height and sleeveless jersey rotated 28–35 degrees; show the complete scoop neck, both bound armholes, wide shoulder straps, full torso and hem with a 70mm lens",
  front: "premium front campaign view from just above waist height, sleeveless jersey turned only 6–10 degrees off-axis; keep the complete scoop neckline, both shoulder straps, bound armholes, chest artwork, side inserts and hem visible with an 85mm lens",
  back: "cinematic rear three-quarter construction view of the sleeveless jersey rotated 22–28 degrees; show the complete back artwork, rear neckline, both bound armholes, side inserts and hem without any front artwork leaking through",
  sleeve: "intimate armhole-to-side-panel three-quarter view photographed at a shallow 18–25 degree angle; place the bound armhole and one complete torso side insert in the foreground while enough neckline, chest and hem remain visible to identify the same sleeveless jersey",
  detail: "extreme macro textile view at the real scoop-neck binding, armhole binding or side-panel junction, resolving micro-mesh pores, sublimated ink and double-needle stitching at true optical scale",
};

const KIT_SHOT_DIRECTIONS = {
  hero: "cinematic low three-quarter hero view of one coordinated basketball jersey-and-shorts uniform, both garments completely visible and presented as one matching kit; rotate 28–35 degrees and use a 65–70mm lens with the jersey dominant but the shorts unobstructed",
  front: "premium front campaign view of the complete sleeveless jersey and matching shorts, turned only 6–10 degrees off-axis; keep neckline, armholes, jersey hem, waistband, both short legs and every front artwork panel visible",
  back: "rear three-quarter construction view of the complete matching kit, rotated 22–28 degrees; show the full jersey back, rear neckline, side panels, shorts back, waistband and both hems without front artwork leaking through",
  sleeve: "tight three-quarter side construction view showing the jersey armhole binding, torso side insert and matching shorts side insert in one continuous composition; keep enough of both garments visible to prove the complete kit identity",
  detail: "extreme macro textile view pairing one authentic jersey seam with the corresponding shorts waistband or side-panel junction, proving identical fabric, trim color, sublimation quality and production finish",
};

function getShotDirection(profile, shot) {
  if (profile.kind === "shorts") return SHORTS_SHOT_DIRECTIONS[shot];
  if (profile.kind === "kit") return KIT_SHOT_DIRECTIONS[shot];
  if (profile.shotFamily === "basketball") return BASKETBALL_SHOT_DIRECTIONS[shot];
  return SHOT_DIRECTIONS[shot];
}

const VISIBLE_ARTWORK = {
  hero: "Use the front body, wearer's-left sleeve and wearer's-right sleeve references in their exact physical locations; anatomical left/right always means the wearer's perspective, never the viewer's screen side.",
  front: "Use the front body, wearer's-left sleeve and wearer's-right sleeve references in their exact physical locations; anatomical left/right always means the wearer's perspective, never the viewer's screen side.",
  back: "Use the back body and the same wearer's-left and wearer's-right sleeve references without swapping or mirroring them; anatomical labels remain the wearer's perspective after the camera moves behind the garment.",
  sleeve: "Feature only the supplied wearer's-left sleeve reference on the dominant sleeve, with its matching left cuff when supplied, and only the naturally visible portion of the front body reference; do not substitute the right sleeve.",
  detail: "Magnify a real wearer's-left sleeve/cuff or collar junction from this same jersey; retain the exact nearby motif, seam distance, orientation and colors instead of inventing a decorative swatch.",
};

const TOP_PLACEMENT_LOCKS = Object.freeze({
  sports_tshirt: "ROUND-NECK PLACEMENT MAP — Treat the front, back, left sleeve and right sleeve uploads as four fixed production print maps. Anchor each body map simultaneously to the collar centerline, both side seams and bottom hem; anchor each sleeve map to its shoulder seam, underarm seam and cuff edge. The round neck must remain centered and may occlude only the pixels physically covered by its binding. Never slide, rotate, rescale, mirror, continue or regenerate a motif independently of its source panel.",
  polo_jersey: "POLO PLACEMENT MAP — Treat the front, back, left sleeve and right sleeve uploads as four fixed production print maps. Anchor each body map simultaneously to the folded-collar centerline, both side seams and bottom hem; anchor each sleeve map to its shoulder seam, underarm seam and cuff edge. The folded collar and short center placket sit physically above the front artwork and may occlude only the narrow fabric area they truly cover. Never move chest graphics around the placket, widen the opening, slide, rotate, rescale, mirror, continue or regenerate any motif independently of its source panel.",
});

const SHORTS_VISIBLE_ARTWORK = {
  hero: "Use the shorts front, left side and right side references in their exact physical locations.",
  front: "Use the shorts front and both naturally visible side-panel references in their exact physical locations.",
  back: "Use the shorts back and correct left/right side-panel references in their exact physical locations.",
  sleeve: "Use the correct shorts side-panel reference and only naturally visible portions of the front and back references.",
  detail: "Magnify a real waistband, side-panel or hem junction from these same shorts; never invent a decorative swatch.",
};

const BASKETBALL_VISIBLE_ARTWORK = {
  hero: "Use the front body, left side panel and right side panel references in their exact physical locations.",
  front: "Use the front body and both naturally visible torso side-panel references in their exact physical locations.",
  back: "Use the back body and correct left/right torso side-panel references in their exact physical locations.",
  sleeve: "Use the correct torso side-panel reference and only naturally visible portions of the front and back body references.",
  detail: "Magnify a real neckline, armhole-binding or side-panel junction from this same sleeveless jersey; never invent a decorative swatch.",
};

const KIT_VISIBLE_ARTWORK = {
  hero: "Use the jersey front, torso side panels, shorts front and shorts side panels in their exact physical locations.",
  front: "Use the jersey front, both torso side panels, shorts front and both shorts side panels in their exact physical locations.",
  back: "Use the jersey back, correct torso side panels, shorts back and correct shorts side panels in their exact physical locations.",
  sleeve: "Use the correct torso side-panel and matching shorts side-panel references, with only naturally visible portions of the front and back artwork.",
  detail: "Magnify real construction junctions from this same coordinated kit; never invent a decorative swatch or mismatch jersey and shorts artwork.",
};

function getVisibleArtwork(profile, shot) {
  if (profile.kind === "shorts") return SHORTS_VISIBLE_ARTWORK[shot];
  if (profile.kind === "kit") return KIT_VISIBLE_ARTWORK[shot];
  if (profile.shotFamily === "basketball") return BASKETBALL_VISIBLE_ARTWORK[shot];
  return VISIBLE_ARTWORK[shot];
}

const MATERIAL_LOCK = [
  "Treat every output in this set as a photograph of the SAME physical garment or coordinated kit made from the SAME fabric roll.",
  "Material lock: premium 150 GSM matte micro-mesh performance polyester; fine uniform breathable pores; soft textile hand; sublimation ink absorbed into the fibers; no surface sticker or raised print.",
  "All main production panels use one identical micro-mesh weave, scale, thickness and matte finish. Bound openings, collar, cuffs and waistband use compact purpose-appropriate rib or elastic construction only, with clean double-needle stitching and realistic seam tension.",
  "Keep identical panel geometry, seam paths, openings, sleeve or leg length, trim widths, hems, piping and garment proportions in every camera view.",
].join(" ");

const PHOTOGRAPHY_LOCK = [
  "Photographic realism lock: premium commercial sportswear photography captured in-camera, not an illustration and not a 3D render.",
  "Use physically plausible studio lighting, controlled highlight rolloff, realistic exposure, subtle lens depth and neutral professional color science. Retain detail in both deep shadows and bright artwork.",
  "Show subtle gravity, natural drape, tiny fabric wrinkles and believable seam puckering; keep texture crisp without oversharpening or artificial noise.",
  "Render true optical depth: foreground texture is slightly more present, distant fabric falls off naturally, edges are not uniformly razor-sharp, and the background stays smooth without synthetic bokeh artifacts.",
].join(" ");

const NEGATIVE_CONSTRAINTS = [
  "Reject glossy plastic, rubber, leather, satin, silk, metallic cloth, thick sweater knit, smooth CGI fabric, waxy mannequin skin and impossible folds.",
  "Reject inconsistent fabric between panels or views, changed seam geometry, random piping, extra badges, invented sponsors, fake embroidery, garbled lettering, mirrored marks, duplicated limbs or panels and floating garment pieces.",
  "No advertisement typography, captions, callout boxes, watermark, presentation board, collage, duplicate garment or unrelated props. Output one finished vertical campaign photograph only.",
].join(" ");

function describeReferences(assetRoles) {
  const anatomicalRole = {
    left_sleeve: "wearer's-left sleeve",
    right_sleeve: "wearer's-right sleeve",
    left_cuff: "wearer's-left cuff",
    right_cuff: "wearer's-right cuff",
  };
  return assetRoles.map((role, index) => {
    if (role === "production_board") return `Image ${index + 1}: PRODUCTION REFERENCE BOARD—authoritative map for garment construction, panel identity, placement and exact trim swatches; never reproduce the board layout, labels, borders or typography`;
    if (role === "canonical_hero") return `Image ${index + 1}: CANONICAL HERO PHOTOGRAPH—lock the same physical garment, mannequin or hanger, fabric, seam geometry, trim widths, lighting family and campaign identity; change only the camera view requested below`;
    if (role === "style_reference") {
      return `Image ${index + 1}: REALISM REFERENCE only—borrow its photographic lighting, textile credibility and premium mood; never copy its garment design, logos, words or colors`;
    }
    if (role === "logo") return `Image ${index + 1}: optional logo/sponsor artwork—use only where already indicated by the supplied garment artwork`;
    return `Image ${index + 1}: exact ${anatomicalRole[role] || role.replaceAll("_", " ")} production artwork`;
  }).join("; ");
}

function describeSrgb(hex) {
  const value = hex.replace("#", "");
  return `${hex} / sRGB(${parseInt(value.slice(0, 2), 16)}, ${parseInt(value.slice(2, 4), 16)}, ${parseInt(value.slice(4, 6), 16)})`;
}

function getTrimColorLock(garmentType, colors, garmentLabel) {
  const collar = describeSrgb(colors.collar);
  const placket = describeSrgb(colors.placket);
  const leftCuff = describeSrgb(colors.leftCuff);
  const rightCuff = describeSrgb(colors.rightCuff);
  if (garmentType === "polo_jersey") {
    return `POLO TRIM COLOR CONTRACT — The user's selectors are the sole color authority for all trim. Render the complete folded collar—including both collar leaves, collar stand, underside when visible and rear collar—in ${collar}. Render the full front button placket, from the collar opening through its bottom edge, in ${placket}; preserve realistic buttons but do not leave any unselected white placket fabric. Render the complete wearer's-left cuff in ${leftCuff}. Render the complete wearer's-right cuff in ${rightCuff}. Never borrow, sample or infer collar, placket or cuff colors from the body, sleeves, optional artwork, backdrop or realism reference. Never swap the left and right cuff colors. These four target sRGB colors must remain identical across all five views. Studio light may create physically natural highlights and shadows, but it must not change the base hue, saturation or material identity; neutral-lit areas must visibly resolve to the specified target color. No white or unprinted gaps may appear at the shoulder joins, collar seam, rear neck, placket edge or cuff seam: continue the correct adjacent production panel underneath every construction seam.`;
  }
  return `TRIM COLOR CONTRACT — Use ${collar} for the neckline, collar or waistband trim appropriate to ${garmentLabel}, ${leftCuff} for the left cuff or binding, and ${rightCuff} for the right cuff or binding. These selector colors remain authoritative unless a matching optional trim artwork reference is supplied.`;
}

export function buildMockupPrompt({ shot, style, colors = {}, assetRoles = [], garmentType }) {
  const safeShot = MOCKUP_SHOTS.some(item => item.key === shot) ? shot : "hero";
  const safeGarmentType = getSafeGarmentType(garmentType);
  const garment = getGarmentProfile(safeGarmentType);
  const preset = MOCKUP_STYLE_PRESETS[getSafeMockupStyle(style)];
  const safeColors = normalizeMockupColors(colors);
  const backdrop = MOCKUP_BACKDROP_PRESETS[getSafeMockupBackdrop(safeColors.backdropPreset)];
  const indexedAssets = describeReferences(assetRoles);
  const trimColorLock = getTrimColorLock(safeGarmentType, safeColors, garment.label);

  return [
    `TASK — Create a cinematic, editorial-grade commercial photograph of ${garment.construction}. It must feel art-directed and photographed by a specialist sportswear campaign team, never like a generic ecommerce mockup.`,
    `GARMENT TYPE LOCK — The selected template is ${garment.label}. ${garment.exclusions}. Do not blend this template with any other garment category.`,
    `SHOT — ${getShotDirection(garment, safeShot)}. ${getVisibleArtwork(garment, safeShot)}`,
    `SHOT-SPECIFIC LIGHT — ${SHOT_LIGHTING[safeShot]}`,
    `GARMENT PRESENTATION — ${preset.direction}. Keep the exact same presentation system, mannequin or hanger identity across the complete five-image campaign, adapted anatomically to the selected ${garment.label}.`,
    `CUSTOM BACKDROP — Use ${safeColors.backdrop} as the dominant backdrop hue. Build ${backdrop.direction}. The selected backdrop changes only the environment and reflected light; it must never recolor the jersey, artwork or skin of the mannequin.`,
    "COMPOSITION — Design a premium vertical 4:5 campaign frame with deliberate negative space, strong visual hierarchy and subtle foreground/background layering. Keep the selected garment dominant. Do not center every shot identically; follow the specified camera position while preserving production clarity.",
    `REFERENCE MAP — ${indexedAssets}. Artwork references are authoritative design data, not loose visual inspiration.`,
    "ARTWORK LOCK — Apply each production panel only to its named garment area as a fixed UV-style print map, not as inspiration. Preserve every supplied logo, letter, number, line, motif, negative space, spacing, scale, orientation, edge and color. Keep every element at the same proportional distance from the collar, shoulder seam, side seam, underarm, cuff and hem in all five views. Perspective may foreshorten the fabric naturally, but the print must remain attached to the same fabric coordinates. Never redraw, simplify, translate, mirror, move, re-center, resize, crop away, duplicate, continue across a seam or replace artwork. Preserve deliberate blank areas.",
    TOP_PLACEMENT_LOCKS[safeGarmentType] || "PANEL PLACEMENT MAP — Preserve every production panel as a fixed print map anchored to its real construction seams and hems.",
    `SOURCE COLOR LOCK — The uploaded body, back, sleeve and side-panel artwork is the only authority for all main garment colors. Preserve those source colors exactly; never recolor, tint, harmonize, replace or reinterpret the body or panel palette. Apply trim only to construction elements valid for ${garment.label}. Do not shift source hue, contrast or saturation between shots, even when the backdrop changes the surrounding atmosphere. ${trimColorLock}`,
    `GARMENT IDENTITY LOCK — ${MATERIAL_LOCK}`,
    `CAMERA AND LIGHT LOCK — ${PHOTOGRAPHY_LOCK}`,
    "QUALITY BAR — Resolve authentic micro-mesh pores, individual rib-knit channels, precise overlock construction, double-needle topstitching, sublimation ink inside fibers, soft fold compression and realistic shadow occlusion at seams. Preserve clean logo edges without making them look pasted on. The final image should withstand close inspection as a real photographed sample garment.",
    `STRICT EXCLUSIONS — ${NEGATIVE_CONSTRAINTS}`,
  ].join("\n");
}
