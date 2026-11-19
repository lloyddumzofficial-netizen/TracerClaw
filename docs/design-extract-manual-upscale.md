# Selected-layer upscale and workspace polish

Select a raster layer and choose **Upscale image** in Layer properties. Direct
Recraft Crisp enlarges it 4x while retaining the original alpha coverage, base
variant and displayed composition/Overview dimensions. The canvas shows animated
progress on that layer. SVG layers do not offer raster upscaling.

Each layer may be successfully upscaled once. Existing automatic enhancements,
enhanced variants (including Topaz/ESRGAN history), and persistent manual upscale
markers count as already upscaled. Choosing a base version or editing its mask
does not reset eligibility. Clicking again shows a muted-red warning without
calling the provider.

`POST /api/design-extract/[id]/upscale` uses existing administrator/ownership
validation, revision checks and private storage. A per-layer conditional R2 claim
prevents simultaneous or refreshed requests from regenerating. Saved provider
outputs and final PNGs are reused after storage/commit failures. Ambiguous paid
requests are never automatically repeated; operator recovery may be required.
Claims and outputs share the existing owned project prefix and retention policy.
No migration, added Claw charge, deployment or access expansion is included.

Canvas source/layer boundaries are square. Generic sidebar instructions and
duplicate production-review text are removed; actual extraction notes remain.

Warnings use the shared `--dc-warning: #D98484` Muted Rose accent documented in
AGENTS.md. Surfaces remain neutral Graphite and body text Silver Gray. The
lower-left notification measures the actual toolbar position to retain a 16px
vertical gap. It fades in/out, auto-dismisses after eight seconds, pauses while
hovered/focused, and supports manual dismissal. Access failures retain Retry.

Validation includes concurrency, already-enhanced history, unsafe sizes, locked
and SVG layers, ambiguous provider responses, storage recovery, canvas progress,
repeat-click suppression, square corners, minimal copy, warning color, placement
and automatic dismissal.
