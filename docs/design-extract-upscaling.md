# Design Extract layer enhancement

## Current provider (2026-11-19)

New automatic enhancements and the manual Upscale image action use **Recraft
Crisp Upscale**, directly at `https://external.api.recraft.ai/v1/images/crispUpscale`
with `RECRAFT_API_KEY`. There is no automatic Topaz fallback. Source alpha is
restored after RGB enhancement, and native base variants remain available.

The published API price checked on 2026-11-19 is **$0.004 per image**, or **$0.016
for four enhanced layers**. This excludes separation, SVG conversion, storage,
and hosting. See [Recraft API pricing](https://www.recraft.ai/pricing?tab=api).
User Claw pricing is unchanged.

Untouched pending Topaz layers are revision-checked and moved to per-layer
Recraft checkpoints before submission. Layers outside Recraft's supported bounds
retain their original image. Known Topaz receipts continue polling the original
request; ambiguous submissions are never regenerated. Already-finished Topaz
outputs are preserved. Saved ESRGAN checkpoints keep their existing recovery path.

Validation: direct-provider default, no expensive fallback, pending-job migration,
known-receipt recovery, one-time manual upscale, alpha restoration, and worker
checks pass. This change does not deploy production or initiate a live paid test.

## Historical Topaz qualification (2026-11-18)

The following records the previous provider configuration, not the current
default. See also [current release notes](design-extract-vector-release.md).

Topaz Transparent is intended for transparent artwork and cutouts. It always
returns a 4x PNG; it does not offer a smaller scale. Planning checks the actual
4x dimensions against the existing 8192-pixel edge and 24 MP output limits before
submitting a billable request. An unsafe layer retains its base image and gets a
warning. Larger images are not silently resized to qualify.

The provider receives an RGBA input via a signed private-R2 URL. Completion
validates dimensions, restores the resized base alpha, and saves the accepted
PNG into the existing owned private-R2 prefix. Base variants and composition
coordinates remain intact. Enhancement is not recovery of original detail.

Saved ESRGAN checkpoints continue using their recorded endpoint, settings, and
request IDs. They are never restarted on Topaz. A compare-and-swap claim precedes
each new submission, paid POST requests are attempted once, and a lost receipt
falls back to the base image rather than repeating a possibly billed request.

At the published rate checked on 2026-11-18, Topaz Transparent costs $0.08 per
started 24 MP of output **per layer**, so four successful layers within our output
limit cost $0.32 in enhancement fees. Qwen, storage, and hosting are additional.
Claw prices and billing activation are unchanged by this provider update.

Reference: https://fal.ai/models/topaz/upscale/image/transparent/api

Validation: enhancement provider, alpha/alignment, job recovery, concurrency,
legacy-checkpoint compatibility, and Design Extract API tests. Live provider
qualification is recorded separately; synthetic samples do not establish quality
for all text, jersey patterns, or detailed artwork.

Live qualification on 2026-11-18: one synthetic RGBA graphic was submitted to
Topaz; saved receipt `01a1eef3-be34-75e2-8655-fec0b8c31ae2` completed successfully.
The returned PNG was 1024x1024 from a 256x256 source and retained an alpha channel.
The output was visually inspected. Local provider/integration/API/worker checks:
75 tests passed; server-module lint passed. This was a direct provider test, not
a complete authenticated upload-to-PSD test. The exact billed amount was not
verified against an account usage receipt.
