# Design Extract admin beta

Implemented entry points: workspace chooser or Tools card → upload flat artwork → editor, and completed garment workspace → Extract design elements → editor. Design Extract projects appear in the shared homepage Recent Projects manager with an artwork thumbnail and a Design Extract badge. Search, rename, delete, and reopening use that manager. The old `/design-extract` start page redirects to `/#start`; project editors remain at `/design-extract/[id]`. Existing Design Extract records are included without a new migration.

## Setup and release gate

1. Apply `database/migrations/038_design_extract.sql` to the intended database through the normal migration workflow. This adds only Design Extract tables, guards and an atomic review RPC. The implementation does not apply migrations remotely.
2. Configure server-only `DESIGN_EXTRACT_ENABLED=true` for an admin preview. Existing `ADMIN_EMAIL`, Supabase service credentials, R2 credentials/public URL and `FAL_KEY` are required. Access is denied by default; the flag never grants non-admin access.
3. Keep the public release disabled until real full-resolution designs and fal billing have been reviewed. No credits are charged, refunded or modified in this beta.

The existing cleanup cron deletes Design Extract project prefixes after three days, cascades job records, and retries queued/saving jobs. Keep that cron enabled even when the UI flag is disabled. Asset export uses authenticated same-origin reads; provider URLs and keys are never accepted from the browser for result settlement.

## Qualification on 2026-11-17

With the user's explicit approval, cropped artwork from the supplied screenshots was sent to fal. Four-layer Qwen requests returned PNGs with alpha:

| Case | Native result | Time | Result |
| --- | --- | --- | --- |
| Jersey | 544 × 768 | 29 s | Useful pattern/foreground separation; some graphics grouped |
| Festival poster | 416 × 960 | 26 s | Weak separation; most poster content remained grouped |
| Text-heavy poster | 416 × 960 | 28 s | Weak separation; screenshot grid contamination |
| Overlapping subjects | 480 × 832 | 90 s | Background and badge separated; main subject/text stayed grouped, with screenshot toolbar contamination |

These inputs were small screenshot crops, not production-quality source files. The public quality gate has **not** passed. Do not describe this as exact recovery of all original elements. Qwen may introduce hidden content or change text. Initial output is a candidate, never automatically accepted.

SAM 3 was also tested live on the jersey crop: point selection returned a transparent cutout (112 × 159) of the selected logo. The live endpoint requires numeric `label: 1`, despite string labels in the generated client types. The implementation uses the live-tested shape. Provider cutouts preserve visible pixels; Qwen split requests reconstruct layers.

Qualification files and request IDs are under ignored `output/design-extract-qualification/`. `scripts/qualify-design-extract.cjs` accepts a local JSON list of `{name,path,crop?}`; running it sends those images to fal and incurs usage. Billing is not returned by these API responses: reconcile the saved request IDs in the fal dashboard before setting public credit prices.

## Editing and exports

The manifest is versioned and stores immutable assets plus separate composition and latag placements. Composition coordinates define PSD placement; latag is only an overview arrangement. Native layer dimensions are retained, and a proportional transform maps them to the original canvas. Layer count is capped at 32. Layer names are initially generic and can be renamed; automatic semantic labeling is not implemented.

Splitting replaces its parent only after explicit acceptance; point segmentation adds a cutout while retaining the parent. Refinement previews can be discarded. Browser exports run in a dedicated worker: transparent trimmed PNGs, ZIP with native PNGs and manifest, or raster layered PSD. PSD respects composition positions, sizes, visibility and order; its original reference is hidden. Text is raster, not editable typography. PSD export has a 64-million-working-pixel budget and 16,000-pixel canvas-side limit; use ZIP when exceeded.

Edits autosave after a short pause, with optimistic revision checks. Pending/reviewable AI work blocks edits. Browser refresh resumes provider polling; cron recovers abandoned work. A submission interrupted before its provider ID was saved is never automatically retried. The admin can reconnect its existing request ID from fal history. If no provider request exists, verify that in fal before marking the specific job failed through the database administration workflow; never blindly resubmit uncertain work.

## Validation

- `node node_modules/vitest/vitest.mjs run tests/api/design-extract.test.js tests/unit/design-extract.test.js`
- `node scripts/check-migrations.mjs`
- `node node_modules/@playwright/test/cli.js test tests/e2e/design-extract.spec.js` (installed Chrome can be selected with `PLAYWRIGHT_CHANNEL=chrome`). This uses mocked backend/provider boundaries, while PNG/ZIP/PSD generation and PSD parsing are real.
- Live fal qualification above is separate from mocked integration coverage. The migration must still be validated against the intended database, and exported PSDs should receive a visual check in Photoshop/Photopea before public release.

The production build compiled, but the repository-wide TypeScript step currently includes stale generated files under `scratch/next-security-storage/build/dev/types/validator.ts` that reference a missing route. Type checking with `scratch/` excluded passes. No unrelated build configuration was changed to hide that failure.
