# Design Extract automatic workflow

Updated 2026-11-19: **Extract elements** is the primary one-click action. It
submits a SAM 2 Auto job without point selection. Completed initial
extraction results are automatically accepted into the editor. **Manual cutout**
is a secondary correction tool using point-guided SAM 2. The user explicitly
accepted weaker text grouping for the budget automatic model.

New automatic jobs record `maskExtraction: 1` and use returned masks with source
RGB. Near-duplicate masks are removed. Smaller regions receive their pixels
before parent masks; residual source content becomes Remaining artwork. This
preserves the source composition without generating hidden pixels. Text can
remain split into letters; native font editing is not supported.

The pass preserves native coordinates and isolated mask bases and respects the
32-layer project limit by retaining excess detail in Remaining artwork. Historical
Qwen jobs retain their recorded provider and previous local-separation setting.

New jobs continue using `enhanceLayers: 0`. Upscale is an explicit one-time
Recraft Crisp action. Existing recorded enhancement requests retain recovery
without automatic duplicate provider submissions.

Claw tariffs, access rules, ownership checks and rate limits are unchanged.
Migration 041 extends only the model allowlist. Paid extraction remains 2 Claws;
optional manual cutout remains 1 Claw. Local separation adds no AI request.

Validation covers one-click extraction without points, native RGBA preservation,
grouping, texture fallback, bounded layers, isolated masks, alignment, job
compatibility and exports. Browser provider responses are mocked. This update
does not deploy production or guarantee recovery of every original design layer.
