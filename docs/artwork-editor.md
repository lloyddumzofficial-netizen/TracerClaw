# Selective garment artwork editing

## Enable in order

1. Apply `database/migrations/036_artwork_edits.sql` through the normal Supabase migration process. The migration was exercised with isolated PostgreSQL tests; the implementation does not apply it to a remote database automatically.
2. Set server-only `ARTWORK_EDITS_MODE=admin` and verify `ADMIN_EMAIL` identifies the tester. Restart the local server or redeploy after changing environment variables. The default is `off`. `all` enables eligible signed-in users after testing; `off` keeps the entry disabled and rejects requests.
3. Open **Keep Complete Design** in Garment Workspace. The sidebar has **Edit artwork** immediately above Actions. It is grey before extraction or while editing is unavailable/processing, then uses the same white gradient as Export as SVG when ready. **Clean Pattern Only**, Logo and Pattern workspaces have no editor entry. Existing standard/mockup projects with the legacy default preserve mode remain eligible. Draw a rectangle/brush selection and enter an instruction; use 1–5 instructions with non-overlapping selections.
4. Choose **Save instruction** after each area. Saving starts the next empty selection automatically; an untouched automatic slot is excluded from review. Instructions show **Draft**, **Saved**, or **Unsaved changes**; changing the prompt or geometry requires saving again. Overlapping areas are highlighted and block review. Choose **Review edits**, verify all regions and prompts, then **Generate edit · 1 Claw**. A real click sends a paid fal request. Automated checks use mocked provider requests and do not consume fal credits.
5. Compare the preview, use **Inspect** to focus an individual edited area, download it, or choose **Apply edit**. A selection-edge warning requires checking the spelling and edges and acknowledging review before Apply is enabled. Discarding keeps the paid preview in project history. The previous active raster/upscale/SVG can be restored. Rebuild HD/SVG with the existing resume pricing.

Existing `FAL_KEY`, R2, Supabase service-role, admin-email and cleanup-cron configuration is reused. No new credentials or packages are required by the app.

## Rollout status

Keep this feature in `off` or `admin` mode until final text-replacement validation is complete. A live two-region text/number test confirmed that the color-only reference removed copied numeric markers and that all pixels outside selections stayed unchanged. That output still retained an old selected word and showed an outline-edge artifact. The editing-only prompt was then clarified so exact replacement wording takes priority over the old word/line count; that final clarification has not had another live inference. Passing automated checks does not establish accurate model lettering or edge reconstruction for every artwork. The existing review warning and explicit Apply remain required.

## Boundaries

- The new editing prompt is `src/server/artworkEdits/prompt.js`. Extraction prompts in `src/lib/tracePrompts.js` are unchanged.
- The fixed model is `fal-ai/nano-banana-2/edit`, one image, 1K and one provider request per batch. Image 1 is a focused crop around the combined selections with neighboring context; image 2 is a color-only selection map, with no rendered numbers, labels, circles or pins. The editing prompt maps each region to its shared `selection_color`; UI selection numbers never enter the reference raster. New context manifests record `referenceFormat: "color-overlay-v2"`. Small lettering therefore occupies more of the generation resolution. Widely separated selections may still require a large crop. The provider has no dedicated mask input on this endpoint, so generation quality still requires review.
- A versioned `context-v1.json` sidecar stores crop coordinates, original dimensions and request fingerprint under the owned edit prefix. Submission stores it before contacting fal. Settlement maps the returned crop back to the original coordinates; older full-frame queued jobs without a sidecar retain their existing settlement path. No additional migration is required.
- Before compositing a focused result, the server checks aspect ratio and substantial changes in protected surrounding context, including a narrow ring around mask boundaries. A mismatched frame is still rejected/refunded. New jobs store `reviewBoundary: true` in their manifest: context differences produce a separate masked preview with `EDIT_BOUNDARY_REVIEW`, not an automatic rejection. The UI warns about possible clipped lettering/seams and requires review acknowledgement before Apply. The warning is persisted before preview upload, so interrupted settlement retains it. Older manifests keep their original strict policy, and already-refunded jobs remain refunded. This pixel check is not OCR and cannot prove spelling, baseline or font fidelity. Provider costs can still be incurred for rejected generations.
- The editing-only prompt reinforces literal spelling for the app's explicit text-replacement starter using the requested string and its character sequence. The original instruction is retained verbatim; free-form wording is not heuristically rewritten. This does not guarantee correct AI text rendering.
- The server composites only selected pixels into the decoded source raster and persists a lossless PNG. Pixels outside the mask remain byte-identical after decoding. Inside-mask visual quality, seams and prompt adherence require the user's before/after review.
- Applying/Restoring is atomic and revision-checked. Older upscale/SVG requests cannot save over a newer artwork revision. Existing extraction flags and refund logic are not reused for edit billing.
- Editor entry reads the owned artifact snapshot and current revision before opening. Generate checks that same image/version again before its paid POST, while the database still performs the final atomic revision check. A genuinely changed image refreshes the canvas and requires a new review instead of automatically retrying a generation. Revision-only refreshes recover saved selections only for the exact same source URL; older-image drafts remain separate. This also handles workspace state that has the new extraction URL but still holds its pre-extraction revision.
- One generated batch costs 1 Claw. Duplicate request keys replay the same job. Changing a submitted request under the same key is rejected. A completed preview is paid even if it requires correction or is discarded; this is disclosed before Generate. Failed requests without a saved preview are refunded.
- Rejected/refunded attempts show an explicit **Edit not applied** outcome with the reason and refund confirmation, including after reopening the editor. They cannot be applied. **Review instructions** restores that attempt's selections for the same image/version and creates a fresh draft request key; it never generates automatically. The user must review and explicitly confirm the next paid request. Failed attempts also remain accessible in Edit history.
- A terminal failure is refunded once. Transient polling/storage failures stay recoverable. An ambiguous submission is never automatically resubmitted; without a recoverable provider ID or stored preview it is refunded after a 15-minute grace period. This may leave an orphan provider request at the business's expense, rather than charging the user twice.
- A completed fal job whose result explicitly reports `User is locked. Reason: TOP_UP.` is a terminal no-output failure and is refunded. A 403 while checking queue status, or an unrelated forbidden result, remains recoverable because its outcome is unconfirmed. Neither path automatically submits another generation.
- Browser polls every four seconds, sequentially. Existing cleanup also settles abandoned jobs. A deterministic preview key recovers a successful upload if database settlement was interrupted.
- Client overlap checks run after geometry changes, not during live pointer previews or prompt typing. Rectangles use geometric intersections; brush/eraser checks use local raster masks with cancellable work. Browser rasterization can differ slightly at antialiased edges, so server mask validation remains authoritative. Selection-edge notices are guidance, not AI object detection.
- Edit assets live under the existing `projects/{id}/` prefix. Project deletion removes them; database edit rows cascade with the project. Browser drafts carry project expiry and are pruned on editor entry; local-storage data is never an authoritative server record.
- Requests require ownership, valid source revision, 1–5 nonempty instructions of at most 1,000 characters, one rectangle per instruction, at most 40 selection strokes per instruction, 400 points per brush stroke, 2,000 total brush points, and a 256KB body limit. Redrawing a rectangle replaces its area. Corner handles resize it; Undo restores the prior selection and Clear area resets it. Service-role-only RPCs own credits and active-output transitions.

## Verification

`node node_modules/vitest/vitest.mjs run` runs pixel, validation, HTTP, billing/recovery and existing regressions.

Focused-edit regressions are in `tests/unit/artwork-edit-context.test.js` and `tests/unit/artwork-edit-service.test.js`: crop geometry, coordinate restoration, outside-mask pixel identity, brush/eraser holes, clipped-content rejection, refunds and legacy-job recovery.

Optional SQL transaction tests use an isolated local PostgreSQL engine, without Supabase credentials:

```
pnpm --dir scratch/artwork-sql add @electric-sql/pglite
node node_modules/vitest/vitest.mjs run tests/integration/artwork-edits-sql.test.js
```

Create `scratch/artwork-sql` first if needed. This test dependency is intentionally excluded from production dependencies.

Browser tests: `tests/e2e/artwork-editor.spec.js` cover drawing, brush erase, instruction limit, local drafts, confirmation, preview, reopening and explicit Apply. Use the project's Playwright configuration and an available Chrome channel. No live AI calls occur.

Before public enablement, run one separately authorized real-image generation in admin mode and inspect lettering, region registration, edge blending, latency and final PNG download. Logs include edit IDs and failures without storing prompt text in application logs. Use edit/generation-attempt rows to measure completion, refunds and latency. Provider spend is checked in the existing fal dashboard.
