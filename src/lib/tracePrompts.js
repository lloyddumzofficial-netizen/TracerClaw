/**
 * Prompt library for fal-ai/nano-banana-pro/edit.
 *
 * Design rules for this file:
 *  1. ONE coherent prompt per mode. Never stack a "booster" that contradicts the base
 *     prompt — contradictory instructions are the #1 cause of inaccurate output.
 *  2. Shared blocks live in constants so the modes cannot drift apart.
 *  3. Hard invariants that must never be negotiated go in the SYSTEM prompt, which the
 *     model weights above the user prompt.
 */

export const NANO_BANANA_EDIT_MODEL = "fal-ai/nano-banana-pro/edit";

// ─────────────────────────────────────────────────────────────────────────────
// SYSTEM PROMPT — highest-priority invariants. Applies to every garment mode.
// ─────────────────────────────────────────────────────────────────────────────
const GARMENT_SYSTEM_PROMPT = `You are a source-locked textile artwork restoration engine, not an illustrator, designer, or concept artist.

Your only job is to recover the flat print artwork visible on the selected garment panel. Copy the source; do not redesign it.

These priorities are absolute and must be followed in this order:
1. SOURCE IDENTITY LOCK: every visible PRINTED element that the selected mode says to keep is immutable. Preserve its exact composition, colors, shape count, scale, spacing, edge paths, and relative positions. In a preserve mode this includes text and logos; in a removal mode, remove only the categories explicitly named by that mode. Photographic shadows, reflections, highlights, fabric shine, folds, and lighting falloff are not printed artwork and must be removed. Never recompose, re-letter, simplify, beautify, modernize, or replace the print with a similar design.
2. NO GARMENT SHAPE: output one flat rectangle filled edge to edge with artwork. No shirt silhouette, neckline, armhole, sleeve, seam, hem, mannequin, photo background, or empty border.
3. SELECTED PANEL ONLY: reproduce only the cropped front or back body panel. Exclude sleeves, collars, and neck binding unless the user intentionally included them as the selected subject.
4. OBSERVED BEFORE INFERRED: pixels visible in the source always override any inferred continuation. Infer only the small areas physically hidden by a garment cutout or fold, and only by continuing the nearest visible color or boundary. Never invent a new motif, word, logo, stripe, or character detail.
5. COLOR AND EDGE LOCK: retain the source palette and every intentional boundary. Remove photographic lighting and fabric texture without moving, rounding, thickening, thinning, or softening the printed design edges.

If "cleaner" conflicts with "closer to the source," choose closer to the source.`;

const CLEAN_PATTERN_SYSTEM_PROMPT = `You are a source-locked textile cleanup engine, not an illustrator, designer, or concept artist.

The selected mode is CLEAN PATTERN ONLY. Isolate and flatten only the central front or back TORSO/BODY PANEL. Remove every logo, badge, crest, word, letter, and number, while preserving all other visible torso print geometry exactly.

Six invariants override every other consideration:
1. TORSO ONLY: detect the body-panel seams first. Exclude collar, neck opening, placket, sleeves, cuffs, and all artwork printed on those parts. Never use sleeve or collar pixels as evidence for the torso design.
2. REMOVE IDENTITY ARTWORK: remove logos, badges, crests, text, letters, and numbers completely, including their outlines, shadows, ribbons, and containers.
3. REMAINING SOURCE LOCK: every other visible torso pattern edge, color field, gradient, halftone, stripe, curve, facet, mascot, and illustration is immutable. Do not move, mirror, repeat, extend, redesign, or beautify it.
4. CONSERVATIVE REPAIR: after removal, fill with the local torso base color unless the same pattern boundary is visibly proven on two opposite sides of the removed area. One endpoint is never permission to invent or extend a shape.
5. ZERO NEW GEOMETRY: the output may contain no decorative contour, swoosh, stripe, curve, facet, accent, or halftone group without a visible torso-source counterpart. Plain source regions remain plain.
6. FLAT PRODUCTION OUTPUT: remove garment shape, perspective, weave, wrinkles, photographic shadows, reflections, and lighting while keeping true printed colors and boundaries exact.

When uncertain, delete the unproven decorative shape and restore the nearest proven torso base field. Accuracy is more important than visual balance or decoration.`;

// ─────────────────────────────────────────────────────────────────────────────
// SHARED BLOCK — the single most-violated requirement: output a full-bleed flat
// panel, never a garment silhouette.
//
// NOTE: an earlier version of this block was a "pixel registration lock" telling
// the model to keep the input's exact framing so the before/after slider would
// line up. That instruction forces the mockup silhouette (neckline, armholes,
// background) into the output, which is the opposite of a flat extract. Framing
// is now defined by the torso panel, and position is preserved *relatively*
// within that panel rather than against the whole photo.
// ─────────────────────────────────────────────────────────────────────────────
const FULL_BLEED_PANEL_LOCK = `== RULE 1: NO GARMENT SHAPE. FULL-BLEED RECTANGLE ONLY. ==
This is the single most important rule and the one most often broken. Read it twice.

Your output is a PLAIN RECTANGLE completely filled with the printed design, corner to corner. It is a fabric print file — a repeating artwork panel — NOT a picture of a shirt.

If ANY of the following appears in your output, the output is a total failure:
- a neckline, collar, collar rib, V-neck, crew neck, neck binding, or neck tape
- a shoulder seam, shoulder slope, armhole, sleeve, sleeve cuff, or sleeve band
- a side seam, hem, hem band edge, bottom curve, or any garment outline
- the silhouette or outline of a shirt, jersey, tank top, vest, or any clothing
- ANY background around the artwork: white background, grey background, studio backdrop, cast shadow, mannequin, hanger, body, table, floor
- a drop shadow under the garment, fabric sheen, gloss highlight, light falloff, or vignette
- empty space, padding, a border, a frame, or rounded corners

There is NO background in your output, because the artwork IS the entire image. Every one of the four edges is design. A viewer must not be able to tell what garment this came from.

== RULE 2: SELECTED BODY PANEL ONLY ==
- Use the user's cropped body panel as the subject. It may be a FRONT panel or a BACK panel.
- If the crop contains a back panel with a player name, number, slogan, crest, or school logo, that back panel is the subject. Do not switch to an imagined front panel.
- Detect the torso/body-panel boundary before reconstructing anything. Follow the actual raglan seam, shoulder piping, armhole seam, side seam, and the lower edge of the collar or neck binding. The central fabric enclosed by those boundaries is the selected torso panel.
- EXCLUDE sleeves, collar, neck opening, neck placket, armholes, cuffs, and every printed shape on those garment parts. Sleeve and collar artwork is frequently different from the torso artwork. Do not copy it, blend it in, sample its color, or let it appear along the edges of your output.
- A sleeve-colored region touching a shoulder seam still belongs to the sleeve, not the torso. A collar stripe touching a chest stripe still belongs to the collar, not the torso. Physical adjacency is not proof that artwork continues onto the body panel.
- If the input is already a tight crop, that crop is the whole subject. Use only what is inside it. Never invent a collar, sleeve, or panel that is not in the crop.

== RULE 3: UNWRAP THE TORSO INTO A FILLED RECTANGLE ==
- Lay the torso panel out flat and stretch it to fill the entire output rectangle, edge to edge, corner to corner.
- Where the neckline, shoulder slope, or armhole leaves an unobserved area after the torso is flattened, fill it conservatively with the nearest proven TORSO base color or torso gradient. Do not pull artwork from the collar or sleeves into that area.
- Continue a torso stripe, curve, facet, halftone, or motif through an unobserved cutout ONLY when the same boundary is visibly present on both sides of that exact cutout and its direction, width, color, and exit point are unambiguous. One visible endpoint is not enough evidence. If two-sided proof is absent, use the local torso base field and add no boundary.
- Never copy a lower-torso flourish into the upper chest, never mirror a side motif across the chest, and never extend a side accent upward merely to decorate an empty region. A plain observed chest remains plain after flattening.
- PRESERVE RELATIVE LAYOUT within the panel. An element in the upper-left of the torso stays in the upper-left of your rectangle. A hem band at the bottom of the torso runs along the bottom edge of your rectangle. Left-to-right order, top-to-bottom order, and proportional spacing are all preserved.
- Keep the pattern scale consistent with the source: if a hexagon is about 1/20th of the chest width, it stays about 1/20th of the output width. Do not zoom the pattern in or out.
- Do not mirror, flip, kaleidoscope, or tile the panel to fill space. Extend the existing design honestly.

== TARGET REFERENCE — WHAT A CORRECT OUTPUT LOOKS LIKE ==
Picture a stock "JERSEY DESIGN | EPS 10" listing: the garment mockup sits on one side, and beside it is the flat rectangular background panel — pure pattern, full bleed, no shirt shape, no background, filling its frame completely.

THAT FLAT PANEL IS YOUR OUTPUT. Produce only that panel. Never produce the mockup side.

== STEP 0: COORDINATE MAPPING (DO THIS BEFORE DRAWING ANYTHING) ==
Mentally overlay a 10 x 10 grid on the TORSO PANEL of the input (not on the whole photo — on the torso region only). For each cell, record:
- the dominant color of that cell (as a hex value),
- every edge or boundary that crosses the cell, and the angle at which it crosses,
- which shape each edge belongs to.
Then map that same 10 x 10 grid onto your output rectangle and reconstruct it cell by cell. Cell (3,7) of the torso becomes cell (3,7) of your rectangle. Walk the grid again before you output and confirm each cell matches.`;

// ─────────────────────────────────────────────────────────────────────────────
// SHARED BLOCK — logo mode keeps the input's framing (unlike garment modes,
// which unwrap the torso into a full-bleed rectangle).
// ─────────────────────────────────────────────────────────────────────────────
const LOGO_REGISTRATION_LOCK = `Keep the original canvas and the foreground logo at its original position, size, orientation, and aspect ratio. Do not crop, move, center, stretch, or enlarge any foreground element. Change background pixels only where they are clearly outside the logo.`;

// ─────────────────────────────────────────────────────────────────────────────
// SHARED BLOCK — flat-panel conversion (de-perspective, de-3D).
// ─────────────────────────────────────────────────────────────────────────────
const FLAT_PANEL_CONVERSION = `== FLAT PANEL CONVERSION ==
Target output: the flat rectangular source artwork file that was sent to the fabric printer — the kind shown on the right side of a stock listing, with the garment photo on the left and the flat print file on the right. That flat file is your target.

- The input may be a garment worn on a body, on a hanger, or shot at an angle. Mentally unfold the fabric and lay it perfectly flat, straight-on, no perspective, no tilt, no 3D.
- If both a front and a back panel are visible, reproduce ONLY the front panel. Ignore the back entirely.
- Remove ONLY the photography: fabric wrinkles, fold shadows, drape creases, specular highlights, reflections, fabric sheen, gloss, lens vignette, ambient shading, light falloff, fabric weave noise, JPEG artifacts, motion blur. None of these are part of the printed design and none may appear in your output.
- Keep what was genuinely PRINTED: intentional gradients, halftone dot patterns, glows, soft blends, and thin lines — but render each one cleanly, as flat vector artwork. Printed halftone dots stay as crisp dots; they never become photographic grain. Never keep fabric texture or textile weave: that is the garment, not the design.
- DE-PERSPECTIVE LINES: any line, stripe, border, or panel edge that looks curved or bent ONLY because of body curvature, fabric drape, or camera angle must be output as a perfectly straight geometric line. A side panel that bows in at the waist becomes a ruler-straight band.
- CRITICAL DISTINCTION: curves that are intentional in the design (waves, arcs, swooshes, curved facet edges) stay curved exactly as designed. Only photographic distortion is straightened.
- The output must read as an Adobe Illustrator sublimation print file: crisp, flat, print-ready.`;

// ─────────────────────────────────────────────────────────────────────────────
// SHARED BLOCK — separates literal source copying from the very small amount of
// extrapolation required to close neckline/armhole cutouts. This prevents the
// model from treating the whole panel as a creative redraw.
// ─────────────────────────────────────────────────────────────────────────────
const SOURCE_AUTHORITY_LOCK = `== SOURCE AUTHORITY — COPY FIRST, INFER LAST ==
Treat the input as the only authority. Do not reconstruct visible artwork from memory and do not generate a cleaner alternative.

Split the panel into two zones before editing:
A. OBSERVED ZONE — every printed pixel that is actually visible.
- Copy the PRINTED CONTENT of this zone literally. Its shapes, text, logos, printed colors, printed gradients, scale, spacing, and edge paths are locked. Do not copy photographic illumination layered over that content.
- Do not move an element to make the layout more balanced. Do not straighten an intentional curve. Do not replace a difficult logo, mascot, letter, or number with a cleaner approximation.
- Preserve irregular details when they are printed artwork. Remove only distortions caused by fabric folds, camera perspective, lighting, weave, blur, or compression.

B. MISSING ZONE — only pixels absent because of a neckline, armhole, fold, crop boundary, or physical occlusion.
- Fill the smallest missing area necessary to complete the rectangular panel.
- Treat collar and sleeve pixels as unavailable evidence when reconstructing a torso panel. Never sample them to fill a torso missing zone.
- Continue a boundary only when matching visible segments enter and exit the same missing zone, proving its direction, width, spacing, color, and termination. A boundary visible on only one side must stop at the occlusion; it may not be guessed across it.
- When continuation is not proven from both sides, fill with the nearest surrounding torso base color or established torso gradient and create zero new edges.
- Stop the continuation as soon as the missing area is filled. Never propagate that inferred geometry into the observed zone.
- Never place text, logos, numbers, characters, emblems, or new decorative shapes inside a missing zone unless a directly visible continuation proves they belong there.

VISIBLE-EVIDENCE OVERRIDE: if an inferred continuation conflicts with even one visible source edge, discard the inference and follow the visible edge.`;

// ─────────────────────────────────────────────────────────────────────────────
// SHARED BLOCK — separates printed gradients from photographed lighting. The
// source lock applies to the ink design, never to light/shadow captured by the
// camera. This keeps the accurate geometry while producing a production flat.
// ─────────────────────────────────────────────────────────────────────────────
const PHOTOMETRIC_ARTIFACT_REMOVAL = `== PHOTOGRAPHIC LIGHT REMOVAL — ZERO SHADOWS OR REFLECTIONS ==
The source is a photograph of printed fabric. Separate the underlying PRINT from the LIGHT falling on that fabric. Preserve the print exactly; remove the light completely.

REMOVE ALL photographic illumination artifacts, even when they cover a large visible area:
- cast shadows, self-shadows, body shadows, mannequin shadows, contact shadows, and dark pools near the waist or hem
- fold shading, wrinkle shading, seam shadows, puckering shadows, drape gradients, and dark valleys caused by fabric depth
- specular reflections, glossy streaks, white shine, hot spots, softbox reflections, window reflections, glare, bloom, and lens flare
- rim light, edge light, colored reflected light, ambient color cast, exposure falloff, vignetting, and darkened corners
- fabric sheen and directional shimmer that changes with surface angle

LIGHTING-DETECTION TEST — classify a soft tonal change as PHOTOGRAPHIC and remove it when ANY of these is true:
1. It follows a fold, bulge, waist curve, hem, seam, body contour, or change in fabric angle.
2. It darkens or brightens several unrelated printed colors and shapes at the same time.
3. It has a broad soft edge, blurred pool, glossy streak, hotspot, or highlight shaped like a light source rather than a printed graphic.
4. It changes brightness while the underlying hue and printed boundaries continue through it.
5. A matching design region elsewhere is evenly lit and proves the darker or brighter patch is not part of the print.

PRINTED-GRADIENT TEST — keep a gradient only when it is anchored to the artwork:
- its boundary or ramp follows the printed composition rather than the garment's folds or body curvature;
- it remains inside a specific design region or intentionally crosses regions as one coherent graphic effect;
- it has a deliberate start point, end point, direction, and color progression that makes sense in the flat design;
- it does not behave like illumination across the entire photographed garment.
When uncertain, compare the same color region above, below, left, and right. Repeated base color and continuing graphic edges are evidence of the underlying print; the inconsistent light or dark overlay is photography and must be removed.

HOW TO REPAIR A SHADOWED OR REFLECTIVE AREA:
- Keep every underlying printed boundary in exactly the same position.
- Recover each region's base print color from the nearest evenly lit portion of that SAME region. Do not borrow a color from a different shape.
- Continue genuine printed gradients, patterns, stripes, and facets through the affected area using their existing direction and spacing.
- Normalize only the unwanted illumination. Do not flatten intentional printed gradients and do not redraw the design.
- A solid printed color must become one uniform color from edge to edge, including the lower torso and all four corners.

PRODUCTION REJECTION GATE: reject the output if any area still looks photographed, dimensional, glossy, wrinkled, shaded, reflective, spotlighted, or darker because of garment curvature. The finished panel must look self-illuminated and uniformly flat, with zero evidence of a camera or light source.`;

// ─────────────────────────────────────────────────────────────────────────────
// SHARED BLOCK — corrects the fuzzy, jagged and haloed boundaries seen in user
// comparisons without changing the geometry those boundaries describe.
// ─────────────────────────────────────────────────────────────────────────────
const EDGE_INTEGRITY_LOCK = `== EDGE INTEGRITY — CLEAN WITHOUT REDESIGN ==
Every printed boundary must follow the same path as the source while rendering cleanly at the output resolution.

- Preserve the exact contour, corner position, angle, curvature, stroke width, taper, notch, overlap, and termination point of every visible edge.
- Hard printed edges remain hard. Soft printed edges remain soft only when the softness is visibly part of the artwork.
- Use a narrow, natural anti-aliased transition only along the true boundary. Do not create stair-step jaggies, saw-tooth edges, pixel chunks, doubled contours, ringing, color fringing, white halos, dark halos, glow, feathering, blur, or smeared edge pixels.
- Never "improve" an edge by rounding a sharp corner, smoothing away a deliberate notch, straightening an intentional curve, widening a thin stripe, or merging two nearby shapes.
- Remove photographic edge contamination caused by fabric weave, wrinkles, shadows, JPEG blocks, camera sharpening, and chromatic fringing while keeping the underlying printed boundary in the same location.
- At T-junctions and overlaps, preserve which shape is on top and keep all meeting points closed and precise. No gaps, leaks, pinholes, or accidental bridges between colors.
- Thin strokes, small counters inside letters, tiny gaps, and narrow accent lines must remain open and distinct; they may not collapse or fuse.

EDGE AUDIT: inspect the entire canvas at 200% zoom. Compare each boundary against the input from top-left to bottom-right. Repair any shifted, swollen, eroded, jagged, haloed, or blurry edge before output.`;

// ─────────────────────────────────────────────────────────────────────────────
// SHARED BLOCK — geometry fidelity. The "shape pixels are not accurate" fix.
// ─────────────────────────────────────────────────────────────────────────────
const GEOMETRY_FIDELITY = `== GEOMETRY FIDELITY — SOURCE-LOCKED SHAPES ==
Operate as a forensic geometry engine. Every polygon in the input has one exact shape and one exact place. Reproduce both.

- Preserve every polygon, angle, corner, cut, notch, diagonal, intersection, edge, offset, taper, thickness, spacing, proportion, and alignment.
- Count locks: if the input has 7 facets, output exactly 7 facets. If it has 3 gold slashes, output exactly 3 gold slashes — not 2, not 4. Count before you draw and count again before you output.
- VERTEX PRECISION: for each polygon, locate its corner points against the 10 x 10 grid from Step 0 and place them there. A facet whose apex sits at (0.41, 0.18) must have its apex at (0.41, 0.18).
- EDGE ANGLE LOCK: every straight edge keeps its exact angle. A 27° diagonal stays 27°, not 30°, not 25°. Parallel edges in the input stay parallel in the output.
- TOPOLOGY LOCK: the shape count and the overlap hierarchy must match. Which shape sits on top of which, which shape is clipped by which, and where they intersect — all identical.
- NEVER MERGE: two adjacent regions of similar color stay two separate regions with the boundary intact. Never average, never dissolve, never simplify a gradient into a flat fill.
- NEVER SIMPLIFY: no smoothing, no rounding of sharp corners, no straightening of intentional irregularities, no cleanup of asymmetry.
- MICRO DETAIL SURVIVAL: micro triangles, micro slashes, tiny bevels, chamfers, clipped corners, micro zigzags, thin connectors, hairline strokes, subtle breaks, partial shapes cut off by the canvas edge — every one survives intact.
- ASYMMETRY LOCK: do NOT mirror, reflect, symmetrize, or kaleidoscope. If the left side differs from the right side, reproduce both sides differently, exactly as in the input.
- OCCLUSION RULE: never guess the identity of a hidden object. In the small missing zones required for full bleed, continue only a directly adjacent, clearly established boundary according to SOURCE AUTHORITY. Otherwise use the nearest surrounding color field. Never fill an unknown region with a generic esports pattern.`;

// ─────────────────────────────────────────────────────────────────────────────
// SHARED BLOCK — color fidelity.
// ─────────────────────────────────────────────────────────────────────────────
const COLOR_FIDELITY = `== COLOR FIDELITY — FULL COLOR, EXACT MATCH ==
- Sample the exact hex value of every color region in the input and use that exact hex in the output.
- Zero hue shift, zero saturation boost, zero brightness lift, zero "cinematic grade", zero warm or cool cast, zero contrast punch.
- If the input is deep navy #101A3C, output #101A3C — not a brighter blue, not a purple-leaning blue.
- Reproduce the full color design: never convert to grayscale, monochrome, duotone, sepia, or a limited palette. Never reduce the number of colors.
- GRADIENTS AND BLENDS: reproduce every INTENTIONAL printed gradient with the same start color, end color, direction, and falloff. A magenta-to-crimson blend keeps its exact ramp. Never invent a gradient where the input has a solid fill.
- PRINTED GRADIENT vs PHOTOGRAPHIC SHADING — apply this test to every soft variation you see:
  - Does it ramp smoothly and deliberately across a large area in one consistent direction (blue at the top fading to black at the bottom of the whole panel)? That is a PRINTED GRADIENT. Keep it, and render it perfectly smooth and banding-free.
  - Is it low-amplitude blotching, mottling, speckle, grain, or shading that follows a fabric fold, crease, or the curve of a body? That is PHOTOGRAPHY. Delete it and flatten that area to one solid color.
  - When a region is ambiguous, treat it as photography and flatten it. A too-clean output is acceptable; a dirty output is not.
- GLOWS AND SHEENS: printed glows, inner highlights, edge sheens, and metallic gold ramps are design elements — reproduce them. Only photographic lighting is removed.
- COLOR ZONE MAP: before outputting, verify the dominant color at the top-left, top-center, top-right, center-left, center, center-right, bottom-left, bottom-center, and bottom-right of your output matches the input at those same nine positions.`;

// ─────────────────────────────────────────────────────────────────────────────
// SHARED BLOCK — flat fill purity. Stops photographed fabric texture, creases and
// grey mottling from surviving into what should be clean solid-color regions.
// This also matters downstream: noise in a "solid" area explodes into hundreds of
// junk paths when the image is vectorized in step 3.
// ─────────────────────────────────────────────────────────────────────────────
const FLAT_FILL_PURITY = `== FLAT FILL PURITY — SOLID AREAS MUST BE PERFECTLY CLEAN ==
This is a print file, not a photograph of fabric. Every area that was printed as one solid ink color must come out as ONE mathematically uniform color — the identical hex value at every single pixel of that region.

ZERO TOLERANCE for any of the following anywhere in the output:
- fabric texture, textile weave, canvas grain, paper grain, cotton or jersey-knit texture
- noise, film grain, dithering, speckle, stipple, mottling, blotching, cloudiness, marbling
- creases, folds, wrinkle shadows, crumple lines, pressed lines
- dirt, dust, smudges, stains, scuffs, streaks, fingerprints, discoloration, yellowing, aging
- soft grey patches, uneven lighting, hot spots, dark corners, vignetting
- JPEG compression blocks, banding, colored fringing along edges

PURE WHITE RULE — this is the most visible failure:
- A white area of the design must be PURE WHITE, hex #FFFFFF, uniform across every pixel.
- Not #FAFAFA, not #F5F5F5, not #F8F6F2, not cream, not ivory, not warm white, not cool grey, not "paper white".
- White fabric photographed under studio lighting reads as light grey, beige, or blotchy in the input. That is the lighting, NOT the design. Correct it to pure #FFFFFF.
- The same rule applies to pure black areas: solid black is #000000, uniform, with no grey wash and no lifted shadows.

SOLID REGION DETECTION — do this for every region before you output:
1. Ask: "Was this region printed as a single flat ink color?"
2. If YES → sample its dominant color, then fill the ENTIRE region with that one hex value. Zero variation, zero texture, zero noise. Every pixel identical.
3. If NO (it is a genuine printed gradient) → render it as a perfectly smooth, banding-free ramp, still with zero texture and zero noise.

Edges between regions must be crisp and clean. Preserve one narrow, natural anti-aliased transition on the true boundary, with no fuzz, halo, grey fringe, doubled contour, or leftover anti-aliasing mud from the photograph. Do not remove anti-aliasing so aggressively that curves and diagonals become jagged.

The finished output must look like clean vector artwork exported straight from Adobe Illustrator — flat, pure, and printable — not like a photograph of a shirt.`;

// ─────────────────────────────────────────────────────────────────────────────
// SHARED BLOCK — canvas rules.
// ─────────────────────────────────────────────────────────────────────────────
const CANVAS_RULES = `== CANVAS RULES ==
- The output is a plain filled RECTANGLE. No shirt shape, no neckline cutout, no armhole curve, no sleeve outline, no collar rib, no seam line, no hem band, no stitching.
- Fill the canvas completely edge to edge. Every color zone, stripe, and facet bleeds fully to all four edges. No white space, no letterboxing, no rounded corners.
- No mockup furniture: no hanger, no mannequin, no body, no background room, no floor, no props, no watermark, no caption, no label, no color swatch strip, no ruler, no annotation.
- Output one single image. No collage, no grid of variations, no before/after split, no side-by-side.`;

// ─────────────────────────────────────────────────────────────────────────────
// SHARED BLOCK — final self-check.
// ─────────────────────────────────────────────────────────────────────────────
const GARMENT_FRAMING_CHECK = `1. FRAMING — CHECK THIS FIRST AND HARDEST: is your output a full-bleed rectangle of pure artwork? Trace all four edges and all four corners. If you can see a neckline, a collar, a shoulder slope, an armhole, a sleeve, a hem curve, a shirt outline, or ANY background around the artwork, you have failed. Delete the garment shape and extend the design outward until it fills the frame completely.`;

const buildFinalGate = (modeChecks, framingCheck = GARMENT_FRAMING_CHECK) => `== FINAL VALIDATION — MANDATORY BEFORE OUTPUT ==
Inspect your reconstruction at maximum zoom and compare it against the input, region by region. Verify every item:
${framingCheck}
2. Geometry: shape count, vertex positions, edge angles, overlap order, micro details.
3. Color: exact hex per region, gradients, no hue shift, full color.
4. Canvas: rectangle only, edge-to-edge, no garment silhouette, no mockup furniture, no sleeve artwork.
5. Cleanliness: no fabric wrinkles, no photographic shadows, no fabric sheen, no reflections, no ghost silhouettes, no smudges, no blur patches, no white holes.
6. FLAT FILL PURITY — inspect every solid-color region at maximum zoom, and the white and black regions hardest of all. Is each one a single uniform hex value at every pixel? If you can see texture, grain, noise, mottling, creases, grey patches, or dirt, flatten that region to one pure color and check again. White must be exactly #FFFFFF.
7. EDGE INTEGRITY — inspect every contour at 200% zoom. It must follow the source path with clean natural anti-aliasing and no jaggies, halos, fringing, swelling, erosion, gaps, or merged details.
${modeChecks}

If any check fails, refine and re-check. Only output when the reconstruction is visually indistinguishable from the input under the rules of this mode. The user will inspect this side by side with the original at 200% zoom.`;

// ─────────────────────────────────────────────────────────────────────────────
// MODE: EXTRACT PATTERN ONLY  (traceType mockup_erase → ai_prompt ERASE_LOGOS)
// ─────────────────────────────────────────────────────────────────────────────
const ERASE_LOGOS = `TASK: Reproduce this garment's design as a flat, full-color, print-ready rectangular artwork panel, with the logos, text, and numbers removed.

Keep the ENTIRE design — the background pattern AND every piece of illustrated artwork, including the mascot or character. Delete only three things: logos, text, and numbers. Rebuild the design that runs underneath whatever you delete.

This is NOT a "background only" extraction. If the garment has a painted warrior, an animal, a face, or any illustration on it, that illustration is part of the design and must appear in your output, fully drawn.

${FULL_BLEED_PANEL_LOCK}

${FLAT_PANEL_CONVERSION}

${SOURCE_AUTHORITY_LOCK}

${PHOTOMETRIC_ARTIFACT_REMOVAL}

${CANVAS_RULES}

${GEOMETRY_FIDELITY}

${EDGE_INTEGRITY_LOCK}

${COLOR_FIDELITY}

${FLAT_FILL_PURITY}

== FOREGROUND REMOVAL — ZERO TOLERANCE ==
This mode removes EXACTLY THREE THINGS and nothing else: logos, text, and numbers. Every other part of the design is artwork and must be reproduced in full.

REMOVE COMPLETELY, leaving no trace — these three categories only:
1. LOGOS AND BRAND MARKS: sponsor logos, brand logos, manufacturer marks and swooshes, league marks, team crests, club badges, shields, patches, emblems, seals, roundels, and any icon-plus-text lockup that functions as an identifying mark.
2. TEXT: every letter and every word — team names, player names, sponsor wordmarks, taglines, slogans, quotes, country names, city names, league names, size tags, care labels.
3. NUMBERS: every digit — chest numbers, back numbers, sleeve numbers, shorts numbers, year numbers, any numeral of any size.
Also remove the decoration that belongs to those three: text outlines and strokes, drop shadows behind text, glows behind a logo, containment boxes, underlines, and banner ribbons that exist to carry text.

KEEP AND REPRODUCE IN FULL — everything else is design artwork:
- THE MASCOT AND ALL CHARACTER ARTWORK. This is critical and is the most common mistake. A warrior, spartan, knight, gladiator, human figure, face, portrait, animal head, tiger, eagle, wolf, dragon, skull, bird, beast, or any illustrated character printed on the garment is ARTWORK, NOT A LOGO. Reproduce it completely: the face, eyes, expression, hair, helmet, armor, plumes, muscles, hands, weapons, shading, highlights, outlines, and every internal detail. Do NOT delete it. Do NOT simplify it into a silhouette. Do NOT replace it with brush strokes.
- All illustrated scenery and objects: flames, lightning, wings, feathers, scales, chains, gears, foliage, waves, smoke, sparks, shattered glass, energy bursts.
- Fabric color fields and color-block zones.
- Printed brush strokes, paint splatters, ink spatter, sprays, washes, and streaks — reproduced as clean flat shapes with crisp edges, never as photographic grain or noise.
- Geometric structure: facets, low-poly triangles, crystal shards, chevrons, diagonal bands, stripes, panels, gradients, halftones, hex grids, camo, tribal fills, abstract flows.
- Decorative slashes and accent bands.

CLASSIFICATION TEST — apply it to every element, one at a time:
Ask only: "Is this a logo, a letter, or a digit?"
- YES → remove it.
- NO → keep it and reproduce it exactly.
There is no third category. A drawing of a person or an animal is not a logo — it is artwork, and it stays. When uncertain about a picture, KEEP IT. When uncertain about a small icon-and-text badge, remove it.

MASCOT VS LOGO — the one distinction that matters:
- A large illustrated character printed as part of the design, bleeding into the pattern, with no enclosing frame → ARTWORK. Keep it in full.
- A small mark enclosed in a badge, crest, circle, or shield, sitting next to or above lettering, placed like a sponsor patch on the chest or sleeve → LOGO. Remove the whole lockup including its icon.
If a garment has both — a big painted warrior across the front AND a small crest-with-text on the chest — keep the warrior, remove the crest.

== SEAMLESS RECONSTRUCTION UNDER THE REMOVED ELEMENTS ==
Deleting is only half the job, but cleanup must be conservative. Rebuild only what the visible source proves was underneath.
- First inspect a narrow ring immediately around each removed logo, text, or number. Determine the local torso base field from that ring.
- If all visible sides of the removed element are the same plain color, the entire vacated area becomes that same plain color. Do not add a stripe, curve, swoosh, facet, halftone, flourish, or accent there.
- Continue a pattern boundary through the vacated area ONLY when the same boundary visibly enters one side and exits another side, with matching color, width, angle or curvature, and an unambiguous connection. Connect only those two proven endpoints.
- A pattern edge that reaches only one side of the removed element must terminate there. Never extrapolate it to a canvas edge, invent its destination, mirror it, repeat it, or connect it to a different nearby motif.
- If a removed element sat on top of a mascot or illustrated artwork, restore only the directly proven continuation between matching visible fragments. If fragments do not prove the hidden drawing, use the local base field instead of hallucinating anatomy or decorative detail.
- A gradient continues only when the same ramp is visibly established on opposite sides. Otherwise fill with the nearest proven base color.
- The repaired region may contain no new contour that cannot be traced back to two matching visible source endpoints. The output's pattern-edge inventory must equal the visible source inventory minus the removed logo/text/number edges—never more.
- The repaired area must be undetectable. Zero ghost silhouettes, zero faint letter strokes, zero halo rings, zero blur patches, zero flat gray filler, zero white holes, zero smeared clone-stamp mush, zero color patches that do not match their surroundings.

== PIXEL-LEVEL REJECTION GATE ==
Zoom to maximum and scan the entire canvas. Reject and repair if ANY of these survive:
a readable letter or part of a letter, a digit, a badge edge, a crest outline, a shield border, a logo mark, a sponsor stroke, a text shadow, a semi-transparent ghost of a removed logo or word, or a colored speck left over from one.
Small leftover fragments count as a full failure.

Then run the opposite check, which is equally important: scan for anything that is MISSING. If the input has a mascot, a character, a face, or an illustration and your output does not, you have failed this mode — go back and draw it.

${buildFinalGate(`8. Removed: zoom in and confirm there is not one letter, not one digit, not one logo, and not one ghost anywhere on the canvas.
9. Kept: confirm the mascot and every illustrated element from the input is present in your output, fully drawn, in the same position and at the same scale — not deleted, not simplified, not replaced by brush strokes.
10. Repair quality: every area where something was removed reads as untouched original design.
11. No invented geometry: compare every remaining pattern contour against the torso source. If an output stripe, curve, swoosh, facet, accent, or halftone group has no visible source counterpart, delete it and restore the local torso base field.
12. Upper-chest audit: after removing chest logos and text, a source area that is otherwise plain must remain plain. No lower-body or sleeve motif may be copied, mirrored, or extended into it.`)}`;

// ─────────────────────────────────────────────────────────────────────────────
// MODE: KEEP COMPLETE DESIGN  (traceType mockup_preserve → ai_prompt PRESERVE_LOGOS)
// ─────────────────────────────────────────────────────────────────────────────
const PRESERVE_LOGOS = `TASK: Reproduce this garment's complete design as a flat, full-color, print-ready rectangular artwork panel. Keep ALL customer-visible artwork — the background pattern, every logo, every badge, every mascot, every word, every player name, and every number — exactly as it appears.

${FULL_BLEED_PANEL_LOCK}

${FLAT_PANEL_CONVERSION}

${SOURCE_AUTHORITY_LOCK}

${PHOTOMETRIC_ARTIFACT_REMOVAL}

${CANVAS_RULES}

${GEOMETRY_FIDELITY}

${EDGE_INTEGRITY_LOCK}

${COLOR_FIDELITY}

${FLAT_FILL_PURITY}

== ARTWORK PRESERVATION — KEEP EVERYTHING ==
This mode preserves the design's identity. A customer must recognize the output as the same jersey.

KEEP AND REPRODUCE EXACTLY, in the same position, at the same scale, in the same colors:
- The player name and every other word on the garment: team wordmarks, club names, city names, sponsor names, brand names, taglines, slogans, event names, sleeve text, chest text, back text, arched or curved text.
- Every number and digit: player numbers, back numbers, chest numbers, sleeve numbers, shorts numbers, year numbers, and numerals inside crests or logos.
- Every logo, crest, shield, badge, patch, emblem, seal, roundel, and sponsor mark.
- Every mascot and figurative graphic: animal heads, tiger faces, eagles, wolves, dragons, skulls, character art, illustrated icons, claw and paw graphics.
- Every decorative element attached to the above: outlines, second and third strokes, drop shadows, bevels, glows, inner highlights, containment shapes, banner ribbons.
- The full background pattern underneath all of it.

== TEXT REPRODUCTION — COPY VERBATIM ==
- Reproduce every character exactly as written. Do NOT correct spelling, do NOT rewrite, do NOT translate, do NOT substitute a similar word, do NOT abbreviate, do NOT re-order words.
- Match the letterforms precisely: same typeface character, same weight, same italic slant, same width, same letter-spacing, same capitalization, same baseline, same arch or curve of the text, same outline and shadow treatment.
- Match the text block's position and size against the 10 x 10 torso grid from Step 0. If the wordmark sits across cells (2,4) to (8,5) of the torso, it sits across cells (2,4) to (8,5) of your rectangle.
- If a letterform is custom or unusual, copy its silhouette as drawn rather than substituting a standard font.
- Never add text that is not in the input. No invented sponsor, no invented tagline, no signature, no watermark.
- If text is blurry, partially warped, or photographed at an angle, copy the visible characters and their placement as faithfully as possible. Do not replace them with different words, do not move them to a cleaner layout, and do not omit them.

== NO GENERIC REPLACEMENT ==
- Never replace a real mascot, crest, or logo with generic brush strokes, abstract streaks, generic flames, generic lightning, or a placeholder shape.
- Never reduce a detailed graphic to a rough blob. Faces, eyes, teeth, claws, line art, outlines, secondary borders, and internal highlights all survive.
- Preserve the visual identity, not just the color palette.

== NO REMOVAL IN THIS MODE ==
- Do not remove player names.
- Do not remove player numbers.
- Do not remove badges, logos, crests, school seals, sponsor marks, slogans, or small decorative symbols.
- Do not leave blank areas where text, logos, or numbers existed.
- The only things removed are photography artifacts: garment shape, wrinkles, shadows, fabric texture, perspective distortion, and background outside the printed design.

${buildFinalGate(`8. Artwork: every logo, badge, mascot, and word from the input is present, in the right place, at the right size, in the right colors.
9. Text: read your output's text and read the input's text character by character. They must be identical.
10. Numbers: every visible digit and player number from the input is present in the output, with the same outline, size, and position.
11. No omissions: nothing customer-visible was deleted just because it looked like a logo, name, or number.`)}`;

// ─────────────────────────────────────────────────────────────────────────────
// MODE: LOGO FLATTEN  (traceType logo → ai_prompt LOGO_FLATTEN)
// ─────────────────────────────────────────────────────────────────────────────
const LOGO_FLATTEN = `Edit the supplied image conservatively. The visible logo is the source of truth, including its text, illustration, internal colors, and intentional background shapes inside the mark. Preserve it as the same artwork; do not generate a new interpretation.

${LOGO_REGISTRATION_LOCK}

Keep every visible letter, numeral, accent, icon, mascot, outline, overlap, gap, and small stroke. Match each visible letterform and its position; do not typeset, autocorrect, complete an unreadable word, or replace custom lettering with a font. If a tiny or blurry detail cannot be resolved from the image, retain its visible form instead of guessing a cleaner one. Do not add missing symbols, objects, or decorative shapes.

Preserve the foreground palette and all intentional gradients and shading drawn within the logo. Clean only photographic shadows, glare, JPEG noise, and blur when the underlying foreground boundary is clearly visible. Keep the boundary in place with natural anti-aliasing; avoid halos, jagged edges, doubled outlines, and artificial sharpness. Output a clean PNG at the requested resolution.

Identify the outer background separately from the complete foreground mark. Replace only that outer background with uniform white #FFFFFF through all four canvas edges. Keep enclosed colored fields, badges, plates, and shapes that are visibly part of the logo. Never erase a pale letter or thin stroke because it resembles the background.

Before output, compare the edited image to the input: same element count, text shapes, color regions, proportions, spacing, and foreground placement. When any proposed cleanup changes identity or an uncertain detail, leave that foreground detail as it appears in the input. Output one image only.`;

const TRACE_PROMPTS = {
  ERASE_LOGOS,
  PRESERVE_LOGOS,
  LOGO_FLATTEN,
  // Legacy projects and any unrecognized mode fall back to the non-destructive
  // behavior: keep the artwork rather than silently deleting the customer's design.
  DEFAULT: PRESERVE_LOGOS,
};

export function isPatternOnlyPrompt(aiPrompt) {
  return aiPrompt === "ERASE_LOGOS";
}

export function isLogoPrompt(aiPrompt) {
  return aiPrompt === "LOGO_FLATTEN";
}

export function resolveTracePromptMode(traceType, aiPrompt) {
  return traceType === "logo" ? "LOGO_FLATTEN" : aiPrompt;
}

export function buildNanoBananaPrompt(aiPrompt) {
  // Own-property check only — never resolve inherited keys like "constructor".
  return Object.hasOwn(TRACE_PROMPTS, aiPrompt ?? "")
    ? TRACE_PROMPTS[aiPrompt]
    : TRACE_PROMPTS.DEFAULT;
}

export function buildNanoBananaSystemPrompt(aiPrompt) {
  if (isLogoPrompt(aiPrompt)) {
    return `You are editing an existing logo image. Preserve the visible foreground artwork and its identity. Do not redraw, redesign, typeset, infer hidden details, or substitute a plausible logo. The only permitted changes are isolating the outer background to white #FFFFFF and cleaning clearly identifiable photographic or compression artifacts without shifting foreground edges, colors, text, or layout. If a foreground detail is ambiguous, preserve its visible pixels instead of guessing.`;
  }

  if (isPatternOnlyPrompt(aiPrompt)) {
    return CLEAN_PATTERN_SYSTEM_PROMPT;
  }

  return GARMENT_SYSTEM_PROMPT;
}

/**
 * Valid input fields for fal-ai/nano-banana-pro/edit only.
 *
 * NOTE: guidance_scale / num_inference_steps / image_strength are NOT part of this
 * endpoint's schema (it is a Gemini-class image editor, not a diffusion sampler).
 * They were previously sent and silently discarded. The real fidelity lever is
 * `resolution` — the 1K default is what was losing fine shape pixels.
 */
export function getNanoBananaInputTuning(aiPrompt) {
  return {
    // Logo restoration uses the endpoint's maximum native tier so custom
    // lettering and tight curves survive before vectorization. Garment extracts
    // stay at 2K to keep their larger-area processing cost predictable.
    resolution: isLogoPrompt(aiPrompt) ? "4K" : "2K",
    // PNG keeps hard shape boundaries crisp for the downstream vectorizer;
    // JPEG ringing along high-contrast edges becomes stray vector paths.
    output_format: "png",
    num_images: 1,
    // Web search would let the model "correct" a team crest against an official
    // version found online. We want the crest that is actually in the photo.
    enable_web_search: false,
  };
}
