# Nano Banana 2.1 moderation comparison

Verified from existing fal request history on 2026-11-16. Read-only inspection; no new generation submitted.

| Field | Successful request | Rejected request |
| --- | --- | --- |
| Request ID | `01a1e497-b7d7-75f3-97e4-ddf5a1597575` | `01a1e49e-9f11-7ad1-b47a-934db004101b` |
| Endpoint | `google/nano-banana-2.1/edit` | `google/nano-banana-2.1/edit` |
| HTTP status | 200 | 422 |
| Resolution | 1K | 2K |
| Aspect ratio | 9:16 | 2:3 |
| Input image | Black/yellow shirt, 651 × 1243 JPEG | White basketball jersey, 373 × 595 JPEG |
| Prompt length | 33,733 characters | 33,733 characters |
| System prompt length | 6,094 characters | 6,094 characters |

Both requests have identical prompt and system-prompt SHA-256 hashes, PNG output, one image requested, and web search disabled. Source-image bytes are different, not merely different storage URLs.

The successful request's cost shown in the user's fal history is **$0.065207**, duration **18.51 seconds**. That observation applies to its 1K request; it is not a measured 2K price.

The failed request reports `content_policy_violation` and `model_moderated`. This identifies the model moderation boundary, not the specific triggering element. Because artwork, source dimensions, resolution, and aspect ratio differ, this comparison does not establish which difference caused rejection. Do not conclude that a logo, particular brand, resolution, or aspect ratio caused it, and do not change those fields to evade moderation.

Current user decision (2026-11-16): the user reported successful generation after returning to 1K and asked to keep Nano Banana 2.1 at 1K for ongoing garment use. Backend prompts remain unchanged. The historical request settings above remain recorded as observed. No automatic moderation retry or model fallback is enabled. This user-confirmed success does not establish the cause of the prior rejection or guarantee that moderation and provider outages can never occur.

## Prepared provider investigation request

Please compare the two request IDs above and investigate the rejected garment extraction. The user prompt and system prompt are identical between requests, while the input artworks and output settings differ. The rejected source is a garment mockup, and the workflow extracts its flat printable artwork. Can you identify whether the rejection happened on input or generated output, and whether it is a false positive or a documented model limitation? Please advise on a supported correction without bypassing moderation. Application-side refunds and error handling are already in place, but they do not resolve generation acceptance.

This report has not been sent to fal. Do not attach private source artwork or prompt text without the user's authorization.

Official references:

- https://fal.ai/docs/documentation/model-apis/errors#content_policy_violation
- https://fal.ai/models/google/nano-banana-2.1/edit/api
