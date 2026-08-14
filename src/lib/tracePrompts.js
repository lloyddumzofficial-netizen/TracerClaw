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

// ─────────────────────────────────────────────────────────────────────────────
// SYSTEM PROMPT — highest-priority invariants. Applies to every garment mode.
// ─────────────────────────────────────────────────────────────────────────────
const GARMENT_SYSTEM_PROMPT = `You are a forensic textile-print reconstruction engine, not an illustrator, not a designer, and not a concept artist.

Your only job is to output the flat, print-ready artwork panel that was printed on the garment in the input image. You reconstruct; you never create.

Four invariants override every other consideration:
1. NO GARMENT SHAPE: your output is a flat rectangle filled edge to edge with artwork. Never a shirt silhouette, never a neckline, never an armhole, never a sleeve, never a seam or hem, never a background around the artwork. If someone could tell your output came from a shirt, you failed.
2. SELECTED PANEL ONLY: reproduce the cropped front or back body panel's design. Sleeves, collars, and neck binding are excluded unless they are intentionally inside the user's crop.
3. EVIDENCE ONLY: every pixel you output must correspond to something visible in the input. Never invent, never approximate, never "improve", never beautify, never stylize.
4. FULL COLOR: reproduce the exact colors of the input. Never desaturate, never posterize, never reduce the palette, never shift hue.

If you are ever unsure between "make it look nice" and "make it match", always choose "make it match".`;

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
- EXCLUDE sleeves, collar, armholes, and neck binding when they sit outside the selected body panel. Sleeve artwork is frequently different from the body panel artwork. Do not copy it, blend it in, or let it appear along the edges of your output unless the user deliberately cropped it as part of the subject.
- If the input is already a tight crop, that crop is the whole subject. Use only what is inside it. Never invent a collar, sleeve, or panel that is not in the crop.

== RULE 3: UNWRAP THE TORSO INTO A FILLED RECTANGLE ==
- Lay the torso panel out flat and stretch it to fill the entire output rectangle, edge to edge, corner to corner.
- Where a neckline, armhole, or shoulder cut into the design in the photo, CONTINUE THE DESIGN THROUGH that area. Extend the pattern, stripes, gradients, facets, and shapes naturally across the former cutout until the rectangle is completely filled. The cutouts disappear; the design closes over them.
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
const LOGO_REGISTRATION_LOCK = `== FRAMING LOCK ==
- Keep the input's exact framing: same field of view, same edges, same center point, same scale, same rotation (0°).
- DO NOT zoom in, zoom out, crop, pan, rotate, tilt, or re-center. The logo occupies the same fraction of the canvas as it does in the input.
- NORMALIZED COORDINATE RULE: every element lands at the same normalized (x, y) position it occupies in the input. If a star sits at 22% width / 71% height, it sits at 22% / 71% in your output.
- Do NOT add margins, padding, borders, frames, or a background that is not in the input.

== STEP 0: COORDINATE MAPPING (DO THIS BEFORE DRAWING ANYTHING) ==
Mentally overlay a 10 x 10 grid on the input. For each cell, record the dominant color, every edge that crosses it, and which shape that edge belongs to. Reconstruct cell by cell, then walk the grid again before output and confirm each cell matches.`;

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
// SHARED BLOCK — geometry fidelity. The "shape pixels are not accurate" fix.
// ─────────────────────────────────────────────────────────────────────────────
const GEOMETRY_FIDELITY = `== GEOMETRY FIDELITY — TARGET IS 98%+ SHAPE ACCURACY ==
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
- OCCLUSION RULE: if a shape is partially hidden, reconstruct only from what is visible. Never fabricate hidden geometry, never continue a line on assumption, never fill an unknown region with a generic esports pattern.`;

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

Edges between regions must be crisp and clean: a hard, precise boundary with no fuzz, no halo, no soft grey transition pixels, and no leftover anti-aliasing mud from the photograph.

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

const LOGO_FRAMING_CHECK = `1. Registration: overlay your output on the input. Do all edges, corners, and shape positions line up? Any drift is a failure.`;

const buildFinalGate = (modeChecks, framingCheck = GARMENT_FRAMING_CHECK) => `== FINAL VALIDATION — MANDATORY BEFORE OUTPUT ==
Inspect your reconstruction at maximum zoom and compare it against the input, region by region. Verify every item:
${framingCheck}
2. Geometry: shape count, vertex positions, edge angles, overlap order, micro details.
3. Color: exact hex per region, gradients, no hue shift, full color.
4. Canvas: rectangle only, edge-to-edge, no garment silhouette, no mockup furniture, no sleeve artwork.
5. Cleanliness: no fabric wrinkles, no photographic shadows, no fabric sheen, no reflections, no ghost silhouettes, no smudges, no blur patches, no white holes.
6. FLAT FILL PURITY — inspect every solid-color region at maximum zoom, and the white and black regions hardest of all. Is each one a single uniform hex value at every pixel? If you can see texture, grain, noise, mottling, creases, grey patches, or dirt, flatten that region to one pure color and check again. White must be exactly #FFFFFF.
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

${CANVAS_RULES}

${GEOMETRY_FIDELITY}

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
Deleting is only half the job. You must rebuild what was printed underneath.
- Continue the surrounding color fields, gradient direction, brush-stroke angle, splatter density, facet edges, pattern spacing, and texture straight through the vacated area, as if the logo, text, or number had never been printed on top.
- If a removed element sat on top of the mascot or on top of illustrated artwork, rebuild that artwork underneath it — continue the character's armor, hair, shoulder, cape, or body across the gap. Do not leave a hole in the illustration and do not flatten that area into plain background.
- Facet and polygon edges that ran under a removed element must be continued to their natural termination — carry the edge across at the same angle until it meets the next shape.
- A gradient that ran under a removed element continues its ramp smoothly across the gap.
- The repaired area must be undetectable. Zero ghost silhouettes, zero faint letter strokes, zero halo rings, zero blur patches, zero flat gray filler, zero white holes, zero smeared clone-stamp mush, zero color patches that do not match their surroundings.

== PIXEL-LEVEL REJECTION GATE ==
Zoom to maximum and scan the entire canvas. Reject and repair if ANY of these survive:
a readable letter or part of a letter, a digit, a badge edge, a crest outline, a shield border, a logo mark, a sponsor stroke, a text shadow, a semi-transparent ghost of a removed logo or word, or a colored speck left over from one.
Small leftover fragments count as a full failure.

Then run the opposite check, which is equally important: scan for anything that is MISSING. If the input has a mascot, a character, a face, or an illustration and your output does not, you have failed this mode — go back and draw it.

${buildFinalGate(`7. Removed: zoom in and confirm there is not one letter, not one digit, not one logo, and not one ghost anywhere on the canvas.
8. Kept: confirm the mascot and every illustrated element from the input is present in your output, fully drawn, in the same position and at the same scale — not deleted, not simplified, not replaced by brush strokes.
9. Repair quality: every area where something was removed reads as untouched original design.`)}`;

// ─────────────────────────────────────────────────────────────────────────────
// MODE: KEEP COMPLETE DESIGN  (traceType mockup_preserve → ai_prompt PRESERVE_LOGOS)
// ─────────────────────────────────────────────────────────────────────────────
const PRESERVE_LOGOS = `TASK: Reproduce this garment's complete design as a flat, full-color, print-ready rectangular artwork panel. Keep ALL customer-visible artwork — the background pattern, every logo, every badge, every mascot, every word, every player name, and every number — exactly as it appears.

${FULL_BLEED_PANEL_LOCK}

${FLAT_PANEL_CONVERSION}

${CANVAS_RULES}

${GEOMETRY_FIDELITY}

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

${buildFinalGate(`7. Artwork: every logo, badge, mascot, and word from the input is present, in the right place, at the right size, in the right colors.
8. Text: read your output's text and read the input's text character by character. They must be identical.
9. Numbers: every visible digit and player number from the input is present in the output, with the same outline, size, and position.
10. No omissions: nothing customer-visible was deleted just because it looked like a logo, name, or number.`)}`;

// ─────────────────────────────────────────────────────────────────────────────
// MODE: LOGO FLATTEN  (traceType logo → ai_prompt LOGO_FLATTEN)
// ─────────────────────────────────────────────────────────────────────────────
const LOGO_FLATTEN = `TASK: Reproduce the logo in this image as a 100% accurate, flat, vector-ready copy. You are a forensic reproduction artist. Do not simplify, stylize, redesign, or interpret. Copy it exactly.

${LOGO_REGISTRATION_LOCK}

== LOGO ACCURACY — TARGET IS 98%+ MATCH ==
- Reproduce every shape, curve, angle, and proportion with mathematical exactness.
- Reproduce every color layer and region in its exact position, size, and proportion.
- ZERO HALLUCINATION: add nothing that is not in the input; remove nothing that is.
- Maintain the exact original proportions and centering. The logo occupies the same fraction of the canvas as in the input.

== TEXT & TYPOGRAPHY — COPY VERBATIM ==
- Reproduce every character exactly as written: same letterforms, same weight, same italic slant, same letter-spacing, same capitalization, same arrangement, same arch or curve.
- Do NOT autocorrect spelling. Do NOT rewrite any word. Do NOT substitute a standard font for a custom letterform.
- Reproduce all secondary text: taglines, year numbers, location text, sub-brand text, registered and trademark symbols.

== ELEMENTS TO PRESERVE — ALL OF THEM ==
- Every icon, symbol, mascot, crest, shield, crown, star, swoosh, and decorative element.
- Every border, outline, ring, frame, and inner detail stroke, at its original stroke weight.

${GEOMETRY_FIDELITY}

${COLOR_FIDELITY}

${FLAT_FILL_PURITY}

== BACKGROUND & FINISHING ==
- Preserve the original background exactly as it is: transparent stays transparent, white stays white, a solid color stays that solid color.
- Do NOT add shadows, glows, gradients, decorative borders, or a background that is not in the input.
- Strip fabric texture, photo noise, compression artifacts, lighting shadows, and 3D shading. Output pure flat color, as if redrawn in Adobe Illustrator from scratch.
- Divide the logo into a 3 x 3 grid and confirm every element sits in the correct cell.

${buildFinalGate(`7. Text: read your output's text and the input's text character by character. They must be identical.
8. Completeness: every icon, stroke, ring, and secondary mark from the input is present.`, LOGO_FRAMING_CHECK)}`;

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

export function buildNanoBananaPrompt(aiPrompt) {
  // Own-property check only — never resolve inherited keys like "constructor".
  return Object.hasOwn(TRACE_PROMPTS, aiPrompt ?? "")
    ? TRACE_PROMPTS[aiPrompt]
    : TRACE_PROMPTS.DEFAULT;
}

export function buildNanoBananaSystemPrompt(aiPrompt) {
  if (isLogoPrompt(aiPrompt)) {
    return `You are a forensic logo reproduction engine, not an illustrator and not a designer.

Your only job is to redraw the logo in the input image as a clean flat vector-style copy. You reconstruct; you never create.

Three invariants override every other consideration:
1. REGISTRATION: the output must align pixel-for-pixel with the input. Same framing, same scale, same center. Never zoom, crop, pan, or rotate.
2. EVIDENCE ONLY: every pixel must correspond to something visible in the input. Never invent, never approximate, never redesign, never modernize.
3. VERBATIM TEXT: copy every character exactly as drawn. Never autocorrect, never re-letter, never substitute a font.

If you are ever unsure between "make it look nice" and "make it match", always choose "make it match".`;
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
export function getNanoBananaInputTuning() {
  return {
    // 2K roughly quadruples the pixel budget vs the 1K default, which is what
    // preserves thin strokes, facet edges, halftones, and small letterforms.
    resolution: "2K",
    // PNG keeps hard shape boundaries crisp for the downstream vectorizer;
    // JPEG ringing along high-contrast edges becomes stray vector paths.
    output_format: "png",
    num_images: 1,
    // Web search would let the model "correct" a team crest against an official
    // version found online. We want the crest that is actually in the photo.
    enable_web_search: false,
  };
}
