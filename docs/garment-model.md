# Garment extraction model

Garment Workspace extraction (stored project `trace_type: "mockup"`, trace step 1) uses the fal endpoint `google/nano-banana-2.1/edit` with an explicit `resolution: "1K"`.

On 2026-11-16 the user confirmed that generation worked after returning to 1K and selected 1K as the ongoing garment setting. Keep this explicit override; do not increase it to 2K/4K or change models without a new user request. This confirmation does not guarantee acceptance of every future request or establish the cause of earlier moderation failures.

The request generates one PNG output, disables web search, and retains the existing source image, prompts, system prompt, aspect-ratio selection, timeout, and billing/refund flow. This setting applies to the extraction step; it does not change the later upscale or SVG stages.

Logo and pattern workspaces continue to use their existing Nano Banana Pro endpoint and resolution settings.

## Garment upscale

Step 2 uses `fal-ai/esrgan`, model `RealESRGAN_x4plus`, PNG output, face enhancement disabled, and `tile: 400`. At the user's request the adaptive output budget is 8192 pixels on the longest edge and 32 megapixels, with a maximum requested scale of 8. Scale is rounded down to half-step increments so measured inputs that fit these limits stay within them. This is an application budget, not a claimed fal maximum. Existing larger sources are not downsampled by the scale selection; they use a minimum scale of 1. If metadata cannot be measured, garment processing retains the conservative 2x fallback.

Examples: 1024 × 1024 at 5.5x becomes 5632 × 5632; 768 × 1344 at 5.5x becomes 4224 × 7392. Scale beyond the native 4x model adds enlargement and does not promise additional recovered source detail. Larger outputs can increase processing time, storage, and provider compute costs. Extraction remains at 1K. Logo/pattern deterministic upscale paths are unchanged.

Official schema: https://fal.ai/models/google/nano-banana-2.1/edit/api

Dispatch coverage uses a mocked provider in `tests/api/garment-model-routing.test.js`; these checks do not generate paid images.

## Reliability and moderation

- Decode source metadata before claiming credits. An invalid source returns `INVALID_SOURCE_IMAGE` without a charge or provider call.
- Use one provider submission per attempt, with the existing 85-second provider budget. Do not automatically resubmit moderation failures or silently fall back to another paid model.
- Validate that the response contains a URL and readable image metadata before persisting the output.
- Refund failed idempotent step-1 attempts independently of older project output. A saved result from the current attempt remains recoverable if final billing bookkeeping fails.
- Surface `AI_CONTENT_BLOCKED` as an expected workspace error, with the provider request reference when available. Never expose private prompts or source URLs in that message.
- Provider moderation remains authoritative. Changing resolution or handling the error does not establish that a rejected image can be generated successfully.

Confirmed provider incident (2026-11-16): `google/nano-banana-2.1/edit`, 2K, HTTP 422, `content_policy_violation`, category `model_moderated`, request reference `01a1e49e-9f11-7ad1-b47a-934db004101b`. The application sends one PNG output request, medium thinking by provider default, and web search disabled. Request fields match the published endpoint schema. A provider investigation is still needed to determine the rejection reason; the category alone does not identify which input or output content triggered it.
