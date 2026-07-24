const NANO_BANANA_ACCURACY_BOOSTER = `== ADDITIVE ACCURACY BOOSTER FOR FAL NANO BANANA PRO EDIT ==
This block reinforces the existing instructions above. Do not ignore any earlier rule.

== CUSTOMER QUALITY LOCK ==
- The user will compare the output directly beside the original reference. The output must survive side-by-side inspection.
- Do not produce a generic sublimation background if the reference contains a specific mascot, emblem, illustration, badge, crest, icon, number artwork, or central graphic.
- Preserve every non-text artwork element that is visibly part of the design: mascots, character faces, claws, paws, shields, marks, decorative icons, chest crests, sleeve graphics, labels, badges, and central illustrations.
- If earlier instructions require large text removal, remove only the text/letter strokes. Do NOT remove the surrounding mascot, illustration, outlines, shadows, color blocks, or graphic layers connected to it.
- If earlier instructions require logo/text copying, copy the logo/text exactly and do not apply any removal rule.

== NO GENERIC REPLACEMENT ==
- Never replace a real mascot, logo-like illustration, tiger head, animal face, team crest, central badge, or placed artwork with random brush strokes, abstract streaks, generic flames, generic lightning, generic esports shapes, or plain pattern fill.
- Never turn a detailed jersey design into only background streaks unless the source image itself contains only background streaks.
- The output must preserve the same visual identity as the source design, not just the same color palette.

== SUBJECT PRESERVATION ==
- Identify the main design subject first. The main subject is the largest intentional artwork element on the garment or crop area.
- Keep the main subject in the same relative position, same scale, same orientation, same color family, same outline style, and same internal detail.
- If the main subject overlaps text, preserve the visible subject artwork and reconstruct only the removed text area from nearby pattern evidence.
- Do not erase or blur face details, eyes, teeth, claws, line art, outlines, secondary borders, or internal highlights.

== CROP-AWARE REFERENCE LOCK ==
- If the input image was already cropped by the user, treat the cropped image as the complete source of truth.
- Do not expand beyond the crop. Do not invent sleeves, collars, missing panels, or hidden artwork outside the crop.
- Reproduce all visible artwork inside the crop with priority over making the canvas look decorative.

== FINAL QUALITY GATE ==
- Before output, ask internally: "Would a customer recognize this as the same jersey artwork?"
- If the answer is no, refine until the mascot/illustration, pattern placement, color regions, and overall identity match the reference.
- Accuracy of identity is more important than making a clean abstract pattern.`;

const NANO_BANANA_PATTERN_ONLY_BOOSTER = `== ADDITIVE PATTERN-ONLY ACCURACY BOOSTER FOR FAL NANO BANANA PRO EDIT ==
This block is active only when the user selected Extract Pattern Only. It overrides any preservation instruction that would keep foreground artwork.

== ABSOLUTE TASK LOCK ==
- Output ONLY the sublimation background/fabric pattern. Nothing else.
- Remove every foreground graphic layer: mascot, animal head, tiger face, character art, team name, player name, number, sponsor wordmark, logo, crest, badge, paw print, label, icon, sticker, emblem, patch, text outline, text shadow, and decorative graphic attached to text.
- Do not preserve the main subject if the main subject is a mascot, logo, text, number, badge, crest, paw print, emblem, or placed artwork. Those are foreground elements and must be erased.
- Foreground removal has higher priority than identity preservation, topology preservation, shape count preservation, and exact-copy instructions.

== BACKGROUND PATTERN ONLY ==
- Keep only the underlying jersey background: fabric color zones, sublimation streaks, gradients, halftones, abstract texture, geometric background panels, and non-logo background stripes.
- Reconstruct the hidden background underneath removed foreground objects by continuing nearby color fields, gradients, streak direction, pattern spacing, and texture.
- The removed area must blend seamlessly with the surrounding background. No ghost silhouettes, no faint letter strokes, no tiger/mascot fragments, no paw remnants, no logo outline, no white holes, no blur patches.
- If a foreground object covers the center, replace the entire covered center with the best continuation of the surrounding background pattern.

== PIXEL-LEVEL REJECTION GATE ==
- Inspect the final image at high zoom before output.
- Reject the result internally if ANY readable letter, number, mascot eye, animal face shape, teeth, whisker, paw, badge edge, logo mark, crest outline, sponsor text, or text shadow remains.
- Small leftover pixels count as failure. Tiny fragments, colored specks, partial outlines, and semi-transparent ghosts from removed foreground artwork must also be erased.
- The final should look like the original garment background existed before any logo/text/mascot was printed on top.

== DO NOT CONFUSE BACKGROUND WITH FOREGROUND ==
- Diagonal sublimation streaks, color washes, halftone fields, abstract angular panels, and fabric pattern are background: preserve them.
- Tiger heads, mascots, letters, numbers, paw prints, sponsors, badges, crests, logos, icons, and chest artwork are foreground: remove them completely.
- When uncertain, classify the element as foreground and remove it, then fill with continued background pattern.`;

const TRACE_PROMPTS = {
  ERASE_LOGOS: `🔴 CRITICAL REFERENCE LOCK — THIS IS THE MOST IMPORTANT INSTRUCTION:
You are given an INPUT IMAGE. That input image IS the source of truth. Every color, every shape, every stripe, every pattern in your output MUST be copied EXACTLY from that input image. Do NOT invent. Do NOT approximate. Do NOT be creative. COPY EXACTLY.
If you deviate from the input image in ANY way — wrong color, wrong stripe angle, wrong shape position, wrong pattern — you have FAILED.

⚠️ HARDEST RULE — READ THIS FIRST AND OBEY IT ALWAYS:
DO NOT DRAW A SHIRT. DO NOT DRAW A JERSEY SHAPE. DO NOT DRAW A NECKLINE. DO NOT DRAW ARMHOLES. DO NOT DRAW SLEEVES. DO NOT DRAW ANY CLOTHING SILHOUETTE WHATSOEVER.
Your output canvas is a PLAIN RECTANGLE filled edge-to-edge with design pattern ONLY.

== REFERENCE IMAGE ANALYSIS — DO THIS FIRST, BEFORE ANYTHING ELSE ==
Step 0 (mandatory): Look at the input image. Count every color. Note every stripe direction and angle. Note every shape. Memorize the exact color of each zone (top-left, top-right, center, bottom-left, bottom-right). You will reproduce ALL of this exactly.

== FINAL OUTPUT STANDARD — THIS IS YOUR TARGET ==
Your output must look EXACTLY like the flat rectangular source artwork panel shown next to a jersey product mockup image — the kind you see on stock design websites where the jersey photo is on the LEFT and the flat pattern file is on the RIGHT. That flat pattern on the RIGHT is your target output:
- A perfectly flat rectangle filled completely edge-to-edge with the jersey's design
- Zero shirt shape — no collar outline, no sleeve silhouette, no armhole curve
- Preserve ALL intricate design details: halftones, dot patterns, fine lines, and design gradients.
- ONLY remove 3D lighting: no fabric wrinkles, no fold shadows, no lens vignette.
- All lines are perfectly geometric (straight or smoothly curved AS DESIGNED — not distorted by the 3D shirt/body)
- It looks like a professional Adobe Illustrator sublimation print file, ready to send to a fabric printer
- The SAME pattern that is on the jersey — not a reinterpretation, not a reinvention — the EXACT same design

You are a FORENSIC COPY ARTIST. Your ONLY task is to make a pixel-accurate flat rectangular replica of the DESIGN PATTERN on this jersey. You are NOT allowed to be creative. You are NOT allowed to invent anything.

== STEP 1: ANALYZE THE REFERENCE IMAGE (DO THIS FIRST) ==
Before drawing anything, mentally catalog EVERY design element with surgical precision:
- What are the EXACT background colors? (list every color zone)
- What geometric shapes exist? (stripes, polygons, chevrons, curves, sublimation patterns — describe each one's exact angle, thickness, size, and position)
- Where exactly is each color zone? (top-left corner, center-left, bottom-right, etc. — use a mental grid)
- What exact colors are used? (e.g. "navy blue", "golden yellow", "white", "black")
- How many stripes, polygons, or pattern repeats are there? Count them exactly.

== STEP 2: PERSPECTIVE CORRECTION (MANDATORY) ==
- The photo may show the jersey worn on a person, hung on a hanger, or shot at an angle. Mentally "cut open" the fabric and lay it completely flat.
- Output the design as if the jersey fabric is unfolded into a flat rectangle — 100% straight-on, no perspective, no tilt, no 3D.
- If both front and back panels are visible, ONLY reproduce the FRONT panel. Completely ignore the back.
- The output must be a perfect upright rectangle — never crooked, never skewed.

== STEP 2B: DE-PERSPECTIVE & STRAIGHTEN ALL LINES (MANDATORY) ==
- ANY line, stripe, border, or panel edge that appears curved or diagonal in the photo ONLY because of fabric drape, body curvature, or camera angle MUST be straightened to a perfect geometric line in the output.
- Side panels (left stripe, right stripe) that look curved because of the shirt shape must be output as perfectly straight vertical bands.
- If a stripe appears to curve inward at the waist due to the body shape — straighten it. Output it as a ruler-straight vertical or diagonal line.
- The output must look like the design was drawn in Adobe Illustrator with straight crisp lines and no fabric distortion whatsoever.
- CRITICAL DISTINCTION: Lines that are curved IN THE DESIGN ITSELF (intentional artistic curves/waves) must remain. But lines that are only curved because of the 3D shirt/body/camera angle — must be output as straight.

== STEP 3: CANVAS REQUIREMENTS ==
- The output is a RECTANGLE. No shirt shape. No neckline cutout. No sleeve cutouts. No armholes. JUST A SOLID RECTANGLE.
- Fill the entire canvas completely edge-to-edge with the design pattern.
- Every color zone, stripe, and shape must bleed fully to all four canvas edges — no white space, no padding, no border.

== STEP 4: SHAPE & COLOR ACCURACY — THIS IS ABSOLUTE LAW ==
- EXACT HEX COLORS: You MUST extract and use the exact same color hex codes as the original. Do not saturate, brighten, or wash out the colors.
- COPY EVERY SHAPE EXACTLY: same position on the canvas, same angle, same size, same color. No exceptions.
- ANTI-HALLUCINATION RULE (CRITICAL): Do NOT substitute real design elements with invented ones.
  If you see HOT PINK, output HOT PINK. If you see diagonal straight stripes, output STRAIGHT STRIPES — NOT wavy swirls.
  Do NOT reimagine or "improve" any element. COPY IT EXACTLY.
- SUBLIMATION PATTERNS: Reproduce the EXACT SAME sublimation shapes, colors, waves, or geometric polygons. Do not replace them with a generic pattern.
- Zero tolerance for invented elements: every output pixel must correspond to a real element in the reference image.

== STEP 5: TEXT AND LOGO REMOVAL (ZERO TOLERANCE) ==
- ABSOLUTELY NO TEXT, NO LETTERS, NO NUMBERS, NO WORDS, NO LOGOS, NO BADGES.
- REMOVE ALL player names, team names, jersey numbers, sponsor logos, chest badges, quotes, years, and taglines.
- Erase them completely and replace them with the BACKGROUND PATTERN that logically continues underneath.
- There must be ZERO text in the final output.
- No white boxes, no smudges, no blank gaps. The pattern must flow seamlessly.

== STEP 6: FINISHING ==
- Flatten all fabric wrinkles, fold shadows, and photographic lighting into clean 2D artwork.
- CRITICAL: Do NOT flatten intentional design gradients, halftone dots, or intricate patterns into solid blocks. Reproduce them exactly.
- The final output must look like a professional rectangular sublimation print file — perfectly clean, print-ready.

== STEP 7: SHAPE PLACEMENT LOCK — CRITICAL FOR ACCURACY ==
- Divide the canvas into a 4x4 grid (16 cells). Before outputting, verify every shape is in the correct grid cell matching the reference.
- Left-side shapes stay left. Right-side shapes stay right. Center shapes stay center. Top shapes stay top. Bottom shapes stay bottom.
- Do NOT mirror, flip, or reposition any element. Shape drift is a failure.
- EXACT COLOR MATCHING: You MUST sample the exact HEX color codes from the reference image. Do NOT brighten, do NOT over-saturate, do NOT shift the hue. If the reference is dark navy blue, the output must be the exact same dark navy blue.
- STRIPE/POLYGON COUNT LOCK: If there are 3 yellow stripes in the reference, output exactly 3 yellow stripes — not 2, not 4.

== STEP 8: NO MIRRORING — ABSOLUTE RULE ==
- DO NOT mirror, reflect, or symmetrize the design. The output must NOT be left-right symmetric unless the reference design itself is symmetric.
- If the left side has a pattern and the right side is different — reproduce them differently, exactly as in the reference.
- DO NOT create a butterfly/kaleidoscope/mirror effect. This is a real design file.
- Every asymmetric element (logo position, stripe layout, patch placement) must remain asymmetric exactly as in the original.

== STEP 9: EXACT GEOMETRY PRESERVATION — ZERO TOLERANCE ==
You are now operating as a FORENSIC GEOMETRY ENGINE. Every polygon in the original image has a specific shape. You must preserve it with absolute precision.
- Preserve every original polygon, every angle, every corner, every cut, every notch, every diagonal, every intersection, every edge, every offset, every taper, every thickness, every spacing, every proportion, every alignment, every symmetry.
- No approximations. No simplification. No smoothing. No redesign. Zero tolerance for invented geometry.

== STEP 10: EXACT SHAPE MATCHING ==
- Every visible blue shape must be reconstructed exactly.
- Every dark navy panel must keep identical borders.
- Every chevron must match the original width, height, taper, angle, overlap, spacing, offset, clipping, layering, and intersection.
- Every stripe angle must remain identical.
- Every lightning cut, triangular notch, zigzag, beveled edge, clipped corner, overlapping panel, hidden continuation, and internal contour must be reproduced.
- Nothing may be guessed. Nothing may be replaced. Nothing may be stylized.

== STEP 11: FORCE PIXEL ANALYSIS (MANDATORY) ==
- Inspect the image pixel-by-pixel. Analyze at maximum zoom.
- Compare neighboring pixels. Trace every color boundary. Follow every edge transition.
- Reconstruct directly from observed pixels.
- Never infer missing shapes. Never hallucinate geometry. Never invent symmetry. Never "clean up" irregularities.

== STEP 12: VECTOR TRACE MODE ==
Behave like Adobe Illustrator Image Trace combined with manual Pen Tool tracing — not like an illustrator, not a concept artist, not a designer.
- Every path must follow the original image exactly.
- No artistic interpretation whatsoever.

== STEP 13: CHEVRON RECONSTRUCTION — HIGHEST PRIORITY ==
The layered V patterns and chevron shapes are the highest priority elements.
Each chevron must preserve: identical width, identical height, identical taper, identical angle, identical overlap, identical spacing, identical offsets, identical clipping, identical layering, identical intersections.
- Do not replace with generic V stripes. Each layer is independent and unique.

== STEP 14: MICRO DETAILS — MUST SURVIVE ==
Preserve all of the following without exception:
- micro triangles, micro slashes, tiny bevels, tiny chamfers, small clipped corners, micro zigzags, micro offsets, hidden intersections, partial shapes, cropped polygons, thin connectors, tiny angular cuts, subtle breaks, edge discontinuities.
Every one of these must survive extraction intact.

== STEP 15: COLOR REGION PRESERVATION ==
- Never merge two adjacent blue regions, even if they appear similar.
- Never merge similar navy colors. Every color island must remain independent.
- Every boundary must remain intact.
- Do not average colors. Do not simplify gradients into flat fills. Keep every distinct region separate.

== STEP 16: TOPOLOGY LOCK ==
- Preserve the exact topology of the original artwork.
- The number of visible shapes in the output should remain nearly identical to the original.
- The hierarchy of overlapping panels must remain identical.
- Do not reduce complexity. Do not merge polygons. Do not split polygons unless required by the source image.

== STEP 17: STRUCTURAL FIDELITY OVER CLEANLINESS ==
- Prioritize structural fidelity over visual cleanliness.
- If the original contains asymmetry, preserve it. If the original contains irregular cuts, preserve them. If the original contains imperfect geometry, preserve it.
- Never beautify. Never improve. Never redesign. Only reconstruct.

== STEP 18: ANTI-HALLUCINATION — STRICT EVIDENCE ONLY ==
- If any shape is partially obscured, reconstruct it ONLY from visible evidence in the image.
- Never fabricate hidden geometry. Never invent missing edges. Never continue lines based on assumptions.
- Never replace unknown details with generic esports patterns.

== STEP 19: FINAL VALIDATION (MANDATORY BEFORE OUTPUT) ==
Before producing the final output, internally compare your reconstruction against the original image.
Verify every single one of the following:
- overall geometry, every polygon, every stripe, every chevron, every angle, every border, every spacing, every notch, every layer, every color region, every intersection.
If any difference is detected, continue refining until the reconstruction is visually indistinguishable from the original. Only then produce the final output.`,

  LOGO_FLATTEN: `You are a FORENSIC LOGO REPRODUCTION ARTIST. Your task is to create a 100% pixel-accurate, flat vector-ready copy of the logo in this reference image. You are NOT allowed to be creative. You are NOT allowed to simplify, stylize, or interpret. Copy it EXACTLY.

== ACCURACY IS THE ONLY RULE (TARGET: 99%+ MATCH) ==
- Reproduce the logo with MATHEMATICAL EXACTNESS. Every shape, curve, angle, and proportion must be a perfect copy of the reference.
- Every color must be the EXACT same solid flat color as the reference. Do not shift the hue. Do not change the lightness. Copy it exactly.
- If the logo has multiple color layers or regions, reproduce ALL of them in their exact positions, sizes, and proportions.
- ZERO HALLUCINATION: Do not add any element that does not exist in the reference. Do not remove any element that does exist.

== TEXT & TYPOGRAPHY \u2014 ABSOLUTE RULE: COPY VERBATIM ==
- If the logo contains any text, letterforms, numbers, or words \u2014 reproduce EVERY SINGLE CHARACTER EXACTLY as written.
- Same font style, same weight (bold/thin/italic), same letter-spacing, same capitalization, same arrangement.
- Do NOT autocorrect spelling. Do NOT rewrite any word. Do NOT change any letter's shape.
- Even if the font looks unusual or custom, copy the letterforms exactly as they appear.

== ELEMENTS TO PRESERVE \u2014 ALL OF THEM ==
- Every icon, symbol, mascot, crest, shield, crown, star, swoosh, and decorative element.
- Every border, outline, ring, frame, and inner detail stroke.
- Every secondary piece of text: taglines, year numbers, location text, sub-brand text.

== BACKGROUND ==
- Preserve the original background exactly (transparent, white, or solid color).
- Do NOT add shadows, glows, gradients, or decorative borders that are not in the original.

== FINISHING ==
- Strip out all fabric texture, photo noise, compression artifacts, lighting shadows, and 3D shading.
- Output only pure, clean, flat solid colors \u2014 as if redrawn in Adobe Illustrator from scratch.
- Maintain the exact original proportions and centering.

== SHAPE PLACEMENT LOCK ==
- Divide the logo into a 3x3 grid. Every element must be in the correct grid cell matching the reference.
- Do NOT drift, shift, or reposition any element. Position accuracy is as important as color accuracy.

== ADDITIONAL: EXACT GEOMETRY PRESERVATION — ZERO TOLERANCE ==
You are now operating as a FORENSIC GEOMETRY ENGINE. Every polygon in the original image has a specific shape. You must preserve it with absolute precision.
- Preserve every original polygon, every angle, every corner, every cut, every notch, every diagonal, every intersection, every edge, every offset, every taper, every thickness, every spacing, every proportion, every alignment, every symmetry.
- No approximations. No simplification. No smoothing. No redesign. Zero tolerance for invented geometry.

== ADDITIONAL: EXACT SHAPE MATCHING ==
- Every visible shape must be reconstructed exactly as it appears in the reference.
- Every boundary, border, and outline must keep identical dimensions and angles.
- Every clipped corner, beveled edge, notch, and internal contour must be reproduced faithfully.
- Nothing may be guessed. Nothing may be replaced. Nothing may be stylized.

== ADDITIONAL: FORCE PIXEL ANALYSIS (MANDATORY) ==
- Inspect the image pixel-by-pixel. Analyze at maximum zoom.
- Compare neighboring pixels. Trace every color boundary. Follow every edge transition.
- Reconstruct directly from observed pixels.
- Never infer missing shapes. Never hallucinate geometry. Never invent symmetry. Never "clean up" irregularities.

== ADDITIONAL: VECTOR TRACE MODE ==
Behave like Adobe Illustrator Image Trace combined with manual Pen Tool tracing — not like an illustrator, not a concept artist, not a designer.
- Every path must follow the original image exactly. No artistic interpretation whatsoever.

== ADDITIONAL: MICRO DETAILS — MUST SURVIVE ==
Preserve all of the following without exception:
- micro details, tiny bevels, tiny chamfers, small clipped corners, micro offsets, hidden intersections, partial shapes, cropped polygons, thin connectors, tiny angular cuts, subtle breaks, edge discontinuities.
Every one of these must survive extraction intact.

== ADDITIONAL: COLOR REGION PRESERVATION ==
- Never merge two adjacent regions, even if they appear similar in color.
- Every color island must remain independent. Every boundary must remain intact.
- Do not average colors. Keep every distinct region separate.

== ADDITIONAL: TOPOLOGY LOCK ==
- Preserve the exact topology of the original artwork.
- The number of visible shapes in the output should remain nearly identical to the original.
- Do not reduce complexity. Do not merge polygons unless required by the source.

== ADDITIONAL: STRUCTURAL FIDELITY OVER CLEANLINESS ==
- Prioritize structural fidelity over visual cleanliness.
- Never beautify. Never improve. Never redesign. Only reconstruct.

== ADDITIONAL: ANTI-HALLUCINATION — STRICT EVIDENCE ONLY ==
- If any shape is partially obscured, reconstruct it ONLY from visible evidence.
- Never fabricate hidden geometry. Never invent missing edges. Never replace unknown details with generic patterns.

== ADDITIONAL: FINAL VALIDATION (MANDATORY BEFORE OUTPUT) ==
Before producing the final output, internally compare your reconstruction against the original image.
Verify: overall geometry, every polygon, every shape, every angle, every border, every spacing, every notch, every layer, every color region, every intersection.
If any difference is detected, continue refining until the reconstruction is visually indistinguishable from the original.`,

  DEFAULT: `🔴 CRITICAL REFERENCE LOCK — THIS IS THE MOST IMPORTANT INSTRUCTION:
You are given an INPUT IMAGE. That input image IS the source of truth. Every color, every shape, every stripe, every pattern in your output MUST be copied EXACTLY from that input image. Do NOT invent. Do NOT approximate. Do NOT be creative. COPY EXACTLY.
If you deviate from the input image in ANY way — wrong color, wrong stripe angle, wrong shape position, wrong pattern — you have FAILED.

⚠️ HARDEST RULE — READ THIS FIRST AND OBEY IT ALWAYS:
DO NOT DRAW A SHIRT. DO NOT DRAW A JERSEY SHAPE. DO NOT DRAW A NECKLINE. DO NOT DRAW ARMHOLES. DO NOT DRAW SLEEVES. DO NOT DRAW ANY CLOTHING SILHOUETTE WHATSOEVER.
Your output canvas is a PLAIN RECTANGLE filled edge-to-edge with design pattern ONLY.

== REFERENCE IMAGE ANALYSIS — DO THIS FIRST, BEFORE ANYTHING ELSE ==
Step 0 (mandatory): Look at the input image. Count every color. Note every stripe direction and angle. Note every shape. Memorize the exact color of each zone (top-left, top-right, center, bottom-left, bottom-right). You will reproduce ALL of this exactly.

== FINAL OUTPUT STANDARD — THIS IS YOUR TARGET ==
Your output must look EXACTLY like the flat rectangular source artwork panel shown next to a jersey product mockup image — the kind you see on stock design websites where the jersey photo is on the LEFT and the flat pattern file is on the RIGHT. That flat pattern on the RIGHT is your target output:
- A perfectly flat rectangle filled completely edge-to-edge with the jersey's design
- Zero shirt shape — no collar outline, no sleeve silhouette, no armhole curve anywhere in the output
- Preserve ALL intricate design details: halftones, dot patterns, fine lines, and design gradients.
- ONLY remove 3D lighting: no fabric wrinkles, no fold shadows, no lens vignette.
- All lines are perfectly geometric (straight or smoothly curved AS DESIGNED — not distorted by the 3D shirt/body)
- It looks like a professional Adobe Illustrator sublimation print file, ready to send to a fabric printer
- The SAME pattern that is on the jersey — not a reinterpretation, not a reinvention — the EXACT same design colors, shapes, and layout

You are a FORENSIC COPY ARTIST. Your ONLY task is to make a pixel-accurate flat rectangular replica of the DESIGN PATTERN on this jersey. You are NOT allowed to be creative. You are NOT allowed to invent anything.

== STEP 1: ANALYZE THE REFERENCE IMAGE (DO THIS FIRST) ==
Before drawing anything, mentally catalog EVERY design element with surgical precision:
- What are the EXACT background colors? (list every color zone)
- What geometric shapes exist? (stripes, polygons, chevrons, curves, sublimation patterns — describe each one's exact angle, thickness, size, and position)
- Where exactly is each color zone? (top-left corner, center-left, bottom-right, etc. — use a mental grid)
- What exact colors are used? (e.g. "navy blue", "golden yellow", "white", "black")
- How many stripes, polygons, or pattern repeats are there? Count them exactly.

== STEP 2: PERSPECTIVE CORRECTION (MANDATORY) ==
- The photo may show the jersey worn on a person, hung on a hanger, or shot at an angle. Mentally "cut open" the fabric and lay it completely flat.
- Output the design as if the jersey fabric is unfolded into a flat rectangle — 100% straight-on, no perspective, no tilt, no 3D.
- If both front and back panels are visible, ONLY reproduce the FRONT panel. Completely ignore the back.
- The output must be a perfect upright rectangle — never crooked, never skewed.

== STEP 2B: DE-PERSPECTIVE & STRAIGHTEN ALL LINES (MANDATORY) ==
- ANY line, stripe, border, or panel edge that appears curved or bent in the photo ONLY because of fabric drape, body curvature, or camera angle MUST be straightened to a perfect geometric line in the output.
- Side panels (left stripe, right stripe) that look curved because of the shirt shape must be output as perfectly straight vertical bands.
- If a stripe appears to curve inward at the waist due to the body shape — straighten it. Output it as a ruler-straight vertical or diagonal line.
- The output must look like the design was drawn in Adobe Illustrator with straight crisp lines and no fabric distortion whatsoever.
- CRITICAL DISTINCTION: Lines that are curved IN THE DESIGN ITSELF (intentional artistic curves/waves) must remain. But lines that are only curved because of the 3D shirt/body/camera angle — must be output as straight.

== STEP 3: CANVAS REQUIREMENTS ==
- The output is a RECTANGLE. No shirt shape. No neckline cutout. No sleeve cutouts. No armholes. JUST A SOLID RECTANGLE.
- Fill the entire canvas completely edge-to-edge with the design pattern.
- Every color zone, stripe, and shape must bleed fully to all four canvas edges — no white space, no padding, no border.

== STEP 4: SHAPE & COLOR ACCURACY — THIS IS ABSOLUTE LAW ==
- EXACT HEX COLORS: You MUST extract and use the exact same color hex codes as the original. Do not saturate, brighten, or wash out the colors.
- COPY EVERY SHAPE EXACTLY: same position on the canvas, same angle, same size, same color. No exceptions.
- ANTI-HALLUCINATION RULE (CRITICAL): Do NOT substitute real design elements with invented ones.
  If you see HOT PINK, output HOT PINK. If you see TEAL/CYAN, output TEAL/CYAN. If you see diagonal straight stripes, output STRAIGHT STRIPES — NOT wavy swirls.
  Do NOT reimagine or "improve" any element. COPY IT EXACTLY.
- SUBLIMATION PATTERNS: Reproduce the EXACT SAME sublimation shapes, colors, waves, or geometric polygons. Do not replace them with a generic pattern.
- Zero tolerance for invented elements: every output pixel must correspond to a real element in the reference image.

== STEP 5: TEXT, NUMBERS, AND LOGOS ==
- STRICT RULE: REMOVE ALL LARGE TEXT, PLAYER NAMES, TEAM NAMES, SPONSOR NAMES, QUOTES, YEARS, AND TAGLINES.
- DO NOT replicate large text elements that span across the jersey (e.g. big team names, vertical text, year ranges).
- Fill those areas with the background pattern that logically continues underneath, as if the text was never there. No smudges, no blank gaps.
- You MAY replicate small team logos or chest crests, but DO NOT include floating large text.

== STEP 6: FINISHING ==
- Flatten all fabric wrinkles, fold shadows, and photographic lighting into clean 2D artwork.
- CRITICAL: Do NOT flatten intentional design gradients, halftone dots, or intricate patterns into solid blocks. Reproduce them exactly.
- The final output must look like a professional rectangular sublimation print file — perfectly clean, print-ready. NO SHIRT SHAPE. NO MOCKUP. RECTANGLE ONLY.

== STEP 7: SHAPE PLACEMENT LOCK — CRITICAL FOR ACCURACY ==
- Divide the canvas into a 4x4 grid (16 cells). Before outputting, verify every shape is in the correct grid cell matching the reference.
- Left-side shapes stay left. Right-side shapes stay right. Center shapes stay center. Top shapes stay top. Bottom shapes stay bottom.
- Do NOT mirror, flip, or reposition any element. Shape drift is a failure.
- EXACT COLOR MATCHING: You MUST sample the exact HEX color codes from the reference image. Do NOT brighten, do NOT over-saturate, do NOT shift the hue. If the reference is dark navy blue, the output must be the exact same dark navy blue.
- STRIPE/POLYGON COUNT LOCK: If there are 3 yellow stripes in the reference, output exactly 3 yellow stripes — not 2, not 4.

== STEP 8: NO MIRRORING — ABSOLUTE RULE ==
- DO NOT mirror, reflect, or symmetrize the design. The output must NOT be left-right symmetric unless the reference design itself is symmetric.
- If the left side has a pattern and the right side is different — reproduce them differently, exactly as in the reference.
- DO NOT create a butterfly/kaleidoscope/mirror effect. This is a real sublimation print file, not a reflected pattern.
- Every asymmetric element (logo position, stripe layout, graphic placement) must remain asymmetric exactly as in the original.

== STEP 9: EXACT GEOMETRY PRESERVATION — ZERO TOLERANCE ==
You are now operating as a FORENSIC GEOMETRY ENGINE. Every polygon in the original image has a specific shape. You must preserve it with absolute precision.
- Preserve every original polygon, every angle, every corner, every cut, every notch, every diagonal, every intersection, every edge, every offset, every taper, every thickness, every spacing, every proportion, every alignment, every symmetry.
- No approximations. No simplification. No smoothing. No redesign. Zero tolerance for invented geometry.

== STEP 10: EXACT SHAPE MATCHING ==
- Every visible blue shape must be reconstructed exactly.
- Every dark navy panel must keep identical borders.
- Every chevron must match the original width, height, taper, angle, overlap, spacing, offset, clipping, layering, and intersection.
- Every stripe angle must remain identical.
- Every lightning cut, triangular notch, zigzag, beveled edge, clipped corner, overlapping panel, hidden continuation, and internal contour must be reproduced.
- Nothing may be guessed. Nothing may be replaced. Nothing may be stylized.

== STEP 11: FORCE PIXEL ANALYSIS (MANDATORY) ==
- Inspect the image pixel-by-pixel. Analyze at maximum zoom.
- Compare neighboring pixels. Trace every color boundary. Follow every edge transition.
- Reconstruct directly from observed pixels.
- Never infer missing shapes. Never hallucinate geometry. Never invent symmetry. Never "clean up" irregularities.

== STEP 12: VECTOR TRACE MODE ==
Behave like Adobe Illustrator Image Trace combined with manual Pen Tool tracing — not like an illustrator, not a concept artist, not a designer.
- Every path must follow the original image exactly.
- No artistic interpretation whatsoever.

== STEP 13: CHEVRON RECONSTRUCTION — HIGHEST PRIORITY ==
The layered V patterns and chevron shapes are the highest priority elements.
Each chevron must preserve: identical width, identical height, identical taper, identical angle, identical overlap, identical spacing, identical offsets, identical clipping, identical layering, identical intersections.
- Do not replace with generic V stripes. Each layer is independent and unique.

== STEP 14: MICRO DETAILS — MUST SURVIVE ==
Preserve all of the following without exception:
- micro triangles, micro slashes, tiny bevels, tiny chamfers, small clipped corners, micro zigzags, micro offsets, hidden intersections, partial shapes, cropped polygons, thin connectors, tiny angular cuts, subtle breaks, edge discontinuities.
Every one of these must survive extraction intact.

== STEP 15: COLOR REGION PRESERVATION ==
- Never merge two adjacent blue regions, even if they appear similar.
- Never merge similar navy colors. Every color island must remain independent.
- Every boundary must remain intact.
- Do not average colors. Do not simplify gradients into flat fills. Keep every distinct region separate.

== STEP 16: TOPOLOGY LOCK ==
- Preserve the exact topology of the original artwork.
- The number of visible shapes in the output should remain nearly identical to the original.
- The hierarchy of overlapping panels must remain identical.
- Do not reduce complexity. Do not merge polygons. Do not split polygons unless required by the source image.

== STEP 17: STRUCTURAL FIDELITY OVER CLEANLINESS ==
- Prioritize structural fidelity over visual cleanliness.
- If the original contains asymmetry, preserve it. If the original contains irregular cuts, preserve them. If the original contains imperfect geometry, preserve it.
- Never beautify. Never improve. Never redesign. Only reconstruct.

== STEP 18: ANTI-HALLUCINATION — STRICT EVIDENCE ONLY ==
- If any shape is partially obscured, reconstruct it ONLY from visible evidence in the image.
- Never fabricate hidden geometry. Never invent missing edges. Never continue lines based on assumptions.
- Never replace unknown details with generic esports patterns.

== STEP 19: FINAL VALIDATION (MANDATORY BEFORE OUTPUT) ==
Before producing the final output, internally compare your reconstruction against the original image.
Verify every single one of the following:
- overall geometry, every polygon, every stripe, every chevron, every angle, every border, every spacing, every notch, every layer, every color region, every intersection.
If any difference is detected, continue refining until the reconstruction is visually indistinguishable from the original. Only then produce the final output.`,
};

export function isPatternOnlyPrompt(aiPrompt) {
  return aiPrompt === "ERASE_LOGOS";
}

export function buildNanoBananaPrompt(aiPrompt) {
  const basePrompt = isPatternOnlyPrompt(aiPrompt)
    ? TRACE_PROMPTS.ERASE_LOGOS
    : aiPrompt === "LOGO_FLATTEN"
      ? TRACE_PROMPTS.LOGO_FLATTEN
      : TRACE_PROMPTS.DEFAULT;

  const booster = isPatternOnlyPrompt(aiPrompt)
    ? NANO_BANANA_PATTERN_ONLY_BOOSTER
    : NANO_BANANA_ACCURACY_BOOSTER;

  return `${basePrompt}

${booster}`;
}

export function getNanoBananaInputTuning(aiPrompt) {
  if (isPatternOnlyPrompt(aiPrompt)) {
    return {
      guidance_scale: 13,
      num_inference_steps: 60,
      image_strength: 0.42,
    };
  }

  return {
    guidance_scale: 10,
    num_inference_steps: 50,
    image_strength: 0.55,
  };
}
