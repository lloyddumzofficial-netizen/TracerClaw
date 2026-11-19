# Selected-layer SVG conversion

> Updated behavior (2026-11-19): the editor now inserts a persistent SVG layer
> instead of automatically downloading. The original download-only POST remains
> compatible. See [the vector release notes](design-extract-vector-release.md)
> for the current document model, shape-layer PSD export and validation status.

Select an accepted layer on the canvas or in the Layers panel. In Layer
properties, choose **Convert to SVG**. The control shows **Converting to SVG…**
while busy and downloads the SVG on success. **Download SVG** downloads the same
result again. PNG artwork and PNG/ZIP/PSD exports retain their existing behavior.

The server-only route `POST /api/design-extract/[id]/svg` accepts a layer ID,
validates the current administrator and project ownership, and reads the current
accepted raster asset. It calls Recraft directly at `/v1/images/vectorize` with
`version: v1`, using the existing `RECRAFT_API_KEY`. No fal vectorization call is
made and no new Claw deduction is introduced by this change.

Inputs are prepared proportionally within Recraft's size limits; tiny cutouts
are padded transparently. This can change SVG canvas dimensions compared with
the original layer. SVG is a separate download, not an editable canvas layer or
editable font conversion.

SVGs and submission checkpoints are stored under the owned private project
prefix (`users/<owner>/design-extract/<project>/svg/`). Existing retention cleanup
covers both. The cache key includes the layer ID, accepted raster reference and
vectorizer version; mask/version changes produce a different conversion key.
No migration is required.

A conditional R2 create claims a conversion before a billable POST. Subsequent
requests reuse saved results, or resume downloading a saved provider result.
Ambiguous submissions are not automatically repeated. An interrupted submission
without a saved provider response requires operator investigation; there is no
automatic retry that could charge twice. Other SVG/storage failures leave PNGs
untouched. New provider submissions are limited to three per minute per user.

Outputs are bounded, checked for vector markup and prohibited active/external
content, and served as private attachments with sandbox and nosniff headers.
SVG markup is never inserted into the editor DOM.

## Verification — 2026-11-19

- Real direct Recraft call with a synthetic transparent graphic: valid SVG,
  712 bytes, 10 API units ($0.01 at the published standard rate).
- Real private-R2 SVG round trip: exact bytes and private cache headers verified.
  A duplicate create-only claim returned HTTP 412. Both isolated test files were
  deleted afterward.
- Browser fixtures verify selected-layer conversion, busy feedback, SVG download,
  unchanged PNG download and inspector fit with 4/32 layers.
- API/storage tests cover ownership, access, cache reuse, concurrency, interrupted
  downloads/submissions, rate limits and rejected SVG content.

The authenticated application flow was tested with fixtures; live Recraft and
R2 were tested separately. This is not a claim of a full live user-project run.

Reference: https://www.recraft.ai/docs/api-reference/tools/vectorize
