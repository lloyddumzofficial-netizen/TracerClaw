# SVG document layers and Recraft enhancement

Implemented locally on 2026-11-19. No deployment, database migration, access
expansion, or paid-mode activation was performed. Generation remains 2 Claws
when paid mode is enabled; SVG conversion adds no Claw deduction.

## Document model

New vector insertion writes manifest version 2. Raster-only version-1 manifests
remain supported. Vector layers carry `kind: svg`, a private normalized SVG,
preview PNG, native logical dimensions, source fingerprint, converter version,
and bounded path/knot counts. Raster layers without `kind` remain raster.

`visibility.overview` and `visibility.composition` override legacy `visible`.
The source remains visible in Overview and hidden in Composition/PSD after
conversion. New SVGs preserve composition placement and use the same displayed
height beside existing artwork in Overview. The canvas renders the SVG itself.

Layer insertion is revision-checked and deterministic per source asset. Capacity
and active-generation checks precede conversion. A changed source cannot receive
an old conversion. Completed raw Recraft results are reused after insertion
conflicts. Up to 64 server-owned retired layer records preserve safe undo/redo
without trusting asset references sent by clients.

The original SVG-download endpoint remains compatible. New editor submissions
send `{layerId, attach: true, revision}` and receive `{project, layerId}`. SVG and
preview downloads use the existing authenticated asset endpoint. Assets remain
under the private owned project prefix and existing retention policy.

## Editable PSD export

`designVector.js` parses bounded XML using saxes and normalizes geometry with
svgpath. It supports solid filled paths, compound paths, fill rules, transforms,
opacity, rectangles, rounded rectangles, ellipses, circles and polygons. Strokes,
gradients, clipping effects and unsupported markup fail explicitly. Raw SVG
download remains available; there is no silent raster fallback labeled as shapes.

The worker writes a named PSD group per SVG and `vectorFill`/`vectorMask` data
per shape, together with cropped compatibility previews. ZIP uses real `.svg`
extensions for vectors. Preflight checks path/knot limits, and the worker also
bounds actual allocated preview pixels. SVG parsing is lazy through the export
worker; only the small visibility helper is imported into the editor bundle.

## Enhancement qualification

New jobs use direct Recraft `/v1/images/crispUpscale` via the existing server key.
Saved Topaz and ESRGAN checkpoints retain their recorded providers and receipts.
Direct Recraft output references are saved before downloads. Storage/download
retries reuse the reference; ambiguous paid POST requests are not repeated.

Synthetic text, repeating dots, and gradient artwork were processed by both
Topaz and Recraft. Recraft returned 1024x1024 from 256x256 at four API units per
sample. Exact RGB input preparation was also tested. Outputs were visually
inspected; text/content remained recognizable and no major layout changes were
observed. Recraft output was opaque, so the existing original-alpha restoration
is essential and retained. These tests justify the local beta default, not a
promise of perfect typography or quality for every production design.

Published cost: $0.004 per Recraft enhancement; four layers cost $0.016 before
Qwen/SVG/storage/hosting. Oversized or unsupported 4x outputs retain base artwork.

## Verification and remaining release gate

- Complete automated suite: 551 tests passed.
- Design Extract browser regression: 19 tests passed.
- Mixed PNG/SVG browser export produced a PSD whose vector masks/fills and hidden
  source PNG were verified by ag-psd read-back.
- Production build, TypeScript build check, and scoped server/editor lint passed.
- Two automated Photopea initialization attempts stayed blank and never emitted
  the documented ready message. Photoshop verification was requested; the user
  agreed to inspect `test-results/design-extract-editable-shapes.psd`.

Do not mark Photoshop/Photopea compatibility visually verified until that check
is completed. No full live authenticated user-project run was performed; provider
qualification and browser/API fixtures were verified separately.
