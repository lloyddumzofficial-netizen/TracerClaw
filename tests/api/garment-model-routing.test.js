import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jsonRequest, mockQuery } from "../helpers/routeTestUtils.js";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(), from: vi.fn(), subscribe: vi.fn(), claim: vi.fn(), refund: vi.fn(), metadata: vi.fn(),
}));
vi.mock("@/lib/supabase", () => ({ adminSupabase: { auth: { getUser: mocks.getUser }, from: mocks.from } }));
vi.mock("@/lib/rateLimit", () => ({ enforceRateLimit: async () => ({ success: true }) }));
vi.mock("@/server/billing", () => ({
  claimGenerationAttempt: mocks.claim, refundGenerationAttempt: mocks.refund,
  completeGenerationAttempt: vi.fn(), isGenerationAttemptStale: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));
vi.mock("@/lib/ssrf", () => ({
  DEFAULT_MAX_IMAGE_BYTES: 10_000, DEFAULT_MAX_UPSCALED_IMAGE_BYTES: 10_000,
  normalizeUserImageUrl: url => url, isOwnedStorageUrl: () => true,
  validateUrlForSSRF: async () => true,
  getAllowedStorageHosts: () => ["storage.example"], getAllowedProviderHosts: () => ["provider.example"],
  fetchWithSSRFProtection: async () => ({ response: { ok: true }, buffer: Buffer.from("test source"), finalUrl: "https://storage.example/source.png" }),
}));
vi.mock("sharp", () => ({ default: () => ({ metadata: mocks.metadata }) }));
vi.mock("@fal-ai/client", () => ({ fal: { subscribe: mocks.subscribe } }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("FAL_KEY", "mock-key-no-provider-call");
  mocks.metadata.mockResolvedValue({ width: 800, height: 1200 });
  mocks.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  mocks.claim.mockResolvedValue({ mode: "idempotent", status: "charged", attempt_id: "attempt-1" });
  mocks.refund.mockResolvedValue({ status: "refunded" });
  // Stop at the mocked provider boundary: no paid generation or output storage.
  mocks.subscribe.mockRejectedValue(new Error("Mock provider stopped after dispatch"));
});
afterEach(() => vi.unstubAllEnvs());

describe("workspace model dispatch", () => {
  it.each([
    [1024, 1024, 5.5],
    [768, 1344, 5.5],
    [512, 1024, 7.5],
    [512, 512, 8],
    [1536, 2048, 3],
  ])("maximizes garment upscale within the export budget for %sx%s", async (width, height, scale) => {
    mocks.from.mockReturnValue(mockQuery({ data: { id: "project-1", user_id: "user-1", trace_type: "mockup", generated_image_url: "https://storage.example/generated.png" }, error: null }));
    mocks.metadata.mockResolvedValue({ width, height });
    const { POST } = await import("@/app/api/trace/route.js");
    await POST(jsonRequest({ projectId: "project-1", step: 2 }));
    expect(mocks.subscribe).toHaveBeenCalledExactlyOnceWith("fal-ai/esrgan", expect.objectContaining({
      input: expect.objectContaining({ model: "RealESRGAN_x4plus", scale, tile: 400, face: false, output_format: "png" }),
      abortSignal: expect.any(AbortSignal),
    }));
    expect(Math.max(width, height) * scale).toBeLessThanOrEqual(8192);
    expect(width * height * scale * scale).toBeLessThanOrEqual(32e6);
    expect(mocks.claim).not.toHaveBeenCalled();
  });
  it.each([{}, { data: { images: [] } }, { data: { images: [{}] } }])("refunds an unusable provider response without retrying", async result => {
    mocks.from.mockReturnValue(mockQuery({ data: { id: "project-1", user_id: "user-1", trace_type: "mockup", original_image_url: "https://storage.example/source.png" }, error: null }));
    mocks.subscribe.mockResolvedValue(result);
    const { POST } = await import("@/app/api/trace/route.js");
    const response = await POST(jsonRequest({ projectId: "project-1", step: 1, requestKey: "empty-output" }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ refunded: true });
    expect(mocks.subscribe).toHaveBeenCalledOnce();
    expect(mocks.refund).toHaveBeenCalledOnce();
  });
  it("refunds corrupt output rather than saving it as a successful generation", async () => {
    mocks.from.mockReturnValue(mockQuery({ data: { id: "project-1", user_id: "user-1", trace_type: "mockup", original_image_url: "https://storage.example/source.png" }, error: null }));
    mocks.subscribe.mockResolvedValue({ data: { images: [{ url: "https://provider.example/output.png" }] } });
    mocks.metadata.mockResolvedValueOnce({ width: 800, height: 1200 }).mockRejectedValueOnce(new Error("Corrupt output"));
    const { POST } = await import("@/app/api/trace/route.js");
    const response = await POST(jsonRequest({ projectId: "project-1", step: 1, requestKey: "corrupt-output" }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ refunded: true });
    expect(mocks.refund).toHaveBeenCalledOnce();
  });
  it("rejects an unreadable source before charging or calling the provider", async () => {
    mocks.from.mockReturnValue(mockQuery({ data: { id: "project-1", user_id: "user-1", trace_type: "mockup", original_image_url: "https://storage.example/source.png" }, error: null }));
    mocks.metadata.mockRejectedValueOnce(new Error("Invalid image"));
    const { POST } = await import("@/app/api/trace/route.js");
    const response = await POST(jsonRequest({ projectId: "project-1", step: 1, requestKey: "invalid-source" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "INVALID_SOURCE_IMAGE", refunded: false });
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.subscribe).not.toHaveBeenCalled();
    expect(mocks.refund).not.toHaveBeenCalled();
  });
  it.each([
    { status: 429, message: "Rate limited" },
    { status: 503, message: "Provider unavailable" },
    { name: "TimeoutError", message: "The operation was aborted due to timeout" },
  ])("refunds a failed new attempt even when an older successful image exists: $message", async failure => {
    mocks.from.mockReturnValue(mockQuery({ data: { id: "project-1", user_id: "user-1", trace_type: "mockup", original_image_url: "https://storage.example/source.png", generated_image_url: "https://storage.example/old-output.png" }, error: null }));
    mocks.subscribe.mockRejectedValue(failure);
    const { POST } = await import("@/app/api/trace/route.js");
    const response = await POST(jsonRequest({ projectId: "project-1", step: 1, requestKey: "new-attempt" }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "AI_PROVIDER_UNAVAILABLE", refunded: true });
    expect(mocks.refund).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ attemptId: "attempt-1" }));
    expect(mocks.subscribe).toHaveBeenCalledOnce();
  });
  it("returns a non-retryable content rejection and refunds the charged attempt", async () => {
    mocks.from.mockReturnValue(mockQuery({ data: { id: "project-1", user_id: "user-1", trace_type: "mockup", original_image_url: "https://storage.example/source.png" }, error: null }));
    mocks.subscribe.mockRejectedValue({ status: 422, requestId: "provider-reference-123", message: "Unprocessable Entity", body: { detail: [{ type: "content_policy_violation", categories: ["model_moderated"] }] } });
    const { POST } = await import("@/app/api/trace/route.js");
    const response = await POST(jsonRequest({ projectId: "project-1", step: 1, requestKey: "moderation-test" }));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "AI_CONTENT_BLOCKED", retryable: false, refunded: true, error: expect.stringContaining("Reference: provider-reference-123") });
    expect(mocks.refund).toHaveBeenCalledOnce();
    expect(mocks.subscribe).toHaveBeenCalledOnce();
  });
  it.each([
    ["mockup", "PRESERVE_LOGOS", "google/nano-banana-2.1/edit", "1K"],
    ["mockup", "ERASE_LOGOS", "google/nano-banana-2.1/edit", "1K"],
    ["mockup", null, "google/nano-banana-2.1/edit", "1K"],
    ["logo", "LOGO_FLATTEN", "fal-ai/nano-banana-pro/edit", "4K"],
    ["pattern", "PATTERN_PRESERVE", "fal-ai/nano-banana-pro/edit", "4K"],
  ])("routes %s / %s to %s at %s", async (traceType, mode, model, resolution) => {
    mocks.from.mockReturnValue(mockQuery({ data: { id: "project-1", user_id: "user-1", trace_type: traceType, ai_prompt: mode, original_image_url: "https://storage.example/source.png" }, error: null }));
    const { POST } = await import("@/app/api/trace/route.js");
    await POST(jsonRequest({ projectId: "project-1", step: 1, requestKey: "test-request" }));
    expect(mocks.subscribe).toHaveBeenCalledExactlyOnceWith(model, expect.objectContaining({
      input: expect.objectContaining({ resolution, num_images: 1, output_format: "png", enable_web_search: false, image_urls: ["https://storage.example/source.png"], prompt: expect.any(String), system_prompt: expect.any(String) }),
      abortSignal: expect.any(AbortSignal),
    }));
  });
});
