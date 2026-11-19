# Design Extract model cost qualification — 2026-11-19

## Applied: cheaper optional cutout

New manual cutouts use `fal-ai/sam2/image`, with `prompts`, PNG output and
`apply_mask: false`. The server uses the returned mask with native source RGB.
Existing SAM 3 jobs retain their original endpoint and recorded input schema.
Submission remains one HTTP attempt; ownership, charging and recovery remain
unchanged. This is a secondary tool, not the automatic extraction action.

The authenticated fal pricing endpoint returned $0.001111111 per compute second
for both SAM 2 endpoints. A synthetic 512×768 sample returned a full-size mask.
Its recorded inference time was 0.345 seconds, suggesting about $0.000383 in
compute at that rate. This is an estimate, not a verified billing receipt:
the current key received HTTP 403 from the usage ledger API.

## Applied: budget automatic extraction

`fal-ai/sam2/auto-segment` returned 14 masks without user points in the same
synthetic design, at a recorded inference time of 3.363 seconds (about $0.003737
at the quoted compute rate). It isolated several shapes and the logo, but text
was fragmented and not every character was isolated. The user explicitly chose
this budget tradeoff. New automatic extraction and Split further now use SAM 2
Auto; no user points are required. Existing Qwen receipts retain recovery.

The actual renderer produced 14 PNG layers from the captured live masks,
preserving visible native RGB and the recomposed source alpha. It removes
near-duplicate masks and allocates smaller masks before parent masks. Remaining
source content is preserved in a Remaining artwork layer. This is visible-pixel
separation, not reconstruction of hidden content or editable text fonts.

Migration `041_design_extract_sam2.sql` is required for the database job-claim
allowlist. It retains the existing tariffs, access and settlement behavior.
It passed isolated PostgreSQL tests including idempotence and legacy claims.

The inspected official Replicate Qwen Layered page lists a base fee plus $0.01
per output image: fast mode $0.03 base, regular mode $0.07 base. Four outputs
therefore list at $0.07 fast or $0.11 regular. The earlier $0.04 estimate omitted
the base charge and is superseded. Replicate was evaluated but not integrated;
the selected budget model remains on fal.

Evidence is under `output/design-extract-sam2-qualification/`: recorded receipts,
provider results, source, masks, contact sheet and runtime/cost-read report.
Provider results contain synthetic artwork only. The qualification did submit
two billable fal requests. No production deployment was performed.

References:
- https://fal.ai/models/fal-ai/sam2/image/api
- https://fal.ai/models/fal-ai/sam2/auto-segment/api
- https://fal.ai/docs/documentation/model-apis/pricing
- https://replicate.com/qwen/qwen-image-layered
