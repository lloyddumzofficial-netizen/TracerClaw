import { beforeEach, describe, expect, it, vi } from "vitest";
import { jsonRequest, mockQuery, okRateLimit } from "../helpers/routeTestUtils.js";

const adminSupabase = {
  auth: {
    getUser: vi.fn(),
  },
  from: vi.fn(),
  rpc: vi.fn(),
};

const deleteFromR2 = vi.fn();
const uploadToR2 = vi.fn();
const fetchWithSSRFProtection = vi.fn();
const validateUrlForSSRF = vi.fn();
const isAllowedStorageUrl = vi.fn();
const isOwnedStorageUrl = vi.fn();
const sharpInstance = {
  metadata: vi.fn(async () => ({ width: 100, height: 100 })),
  resize: vi.fn(() => sharpInstance),
  sharpen: vi.fn(() => sharpInstance),
  png: vi.fn(() => sharpInstance),
  toBuffer: vi.fn(async () => Buffer.from("png")),
};
const sharpMock = vi.fn(() => sharpInstance);
const notifyProjectCompleted = vi.fn();

vi.mock("@/lib/supabase", () => ({ adminSupabase }));
vi.mock("@/lib/rateLimit", () => ({
  enforceRateLimit: okRateLimit(),
  getClientIp: () => "127.0.0.1",
  getRedisClient: () => null,
}));
vi.mock("@/lib/cloudflare", () => ({ deleteFromR2, uploadToR2 }));
vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));
vi.mock("@/lib/ssrf", async () => {
  const actual = await vi.importActual("@/lib/ssrf");
  return {
    ...actual,
    fetchWithSSRFProtection,
    validateUrlForSSRF,
    isAllowedStorageUrl,
    isOwnedStorageUrl,
    normalizeUserImageUrl: (url) => url,
    getAllowedStorageHosts: () => ["storage.example"],
    getAllowedProviderHosts: () => ["provider.example"],
  };
});
vi.mock("@fal-ai/client", () => ({
  fal: {
    subscribe: vi.fn(),
    queue: {
      submit: vi.fn(),
      status: vi.fn(),
      result: vi.fn(),
    },
  },
}));
vi.mock("@/lib/fetchWithRetry", () => ({ fetchWithRetry: vi.fn() }));
vi.mock("@/lib/integrations/webhook", () => ({ notifyProjectCompleted }));
vi.mock("sharp", () => ({ default: sharpMock }));

beforeEach(() => {
  vi.clearAllMocks();
  // Paid-generation routes intentionally verify provider readiness before
  // claiming a claw. Unit tests use a mocked provider, so make that readiness
  // contract explicit instead of depending on a developer's local env file.
  process.env.FAL_KEY = "test-fal-key";
  adminSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: "user-1", email: "user@example.com" } },
    error: null,
  });
  isAllowedStorageUrl.mockReturnValue(true);
  isOwnedStorageUrl.mockReturnValue(true);
  validateUrlForSSRF.mockResolvedValue(true);
  fetchWithSSRFProtection.mockResolvedValue({
    response: { ok: true, headers: new Headers({ "content-type": "image/png" }) },
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=", "base64"),
    finalUrl: "https://storage.example/users/user-1/source.png",
  });
});

describe("core API auth gates", () => {
  const protectedEndpoints = [
    ["project creation", () => import("@/app/api/upload/route.js"), "POST", { imageUrl: "https://storage.example/users/user-1/a.png" }],
    ["Auto Trace", () => import("@/app/api/trace/route.js"), "POST", { projectId: "project-1", step: 1 }],
    ["Precision SVG", () => import("@/app/api/trace-step3/route.js"), "POST", { projectId: "project-1", svgEngine: "precision" }],
    ["Remove Background", () => import("@/app/api/remove-bg/route.js"), "POST", { projectId: "project-1" }],
    ["Upscale", () => import("@/app/api/upscale/route.js"), "POST", { imageUrl: "https://storage.example/users/user-1/a.png" }],
    ["ZIP export", () => import("@/app/api/prepare-zip/route.js"), "POST", { projectId: "project-1" }],
    ["credit refund", () => import("@/app/api/refund/route.js"), "POST", { projectId: "project-1" }],
  ];

  it.each(protectedEndpoints)("%s rejects missing auth", async (_name, loadRoute, method, body) => {
    const route = await loadRoute();
    const res = await route[method](jsonRequest(body, { token: null }));
    const responseBody = await res.json();

    expect(res.status).toBe(401);
    expect(responseBody.error).toMatch(/unauthorized/i);
  });
});

describe("project creation", () => {
  it("uses the verified user id and sanitizes the saved project name", async () => {
    const single = vi.fn(async () => ({ data: { id: "project-1" }, error: null }));
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select }));
    adminSupabase.from = vi.fn(() => ({ insert }));

    const { POST } = await import("@/app/api/upload/route.js");
    const res = await POST(jsonRequest({
      imageUrl: "https://storage.example/users/user-1/source.png",
      traceType: "mockup_erase",
      projectName: "<img src=x onerror=alert(1)> Team: Jersey!",
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.projectId).toBe("project-1");
    expect(insert).toHaveBeenCalledWith([
      expect.objectContaining({
        user_id: "user-1",
        name: "Team Jersey",
        trace_type: "mockup",
        ai_prompt: "ERASE_LOGOS",
      }),
    ]);
  });

  it.each([
    ["pattern_clean", "PATTERN_CLEAN"],
    ["pattern_preserve", "PATTERN_PRESERVE"],
  ])("stores %s as an isolated Pattern Workspace project", async (traceType, aiPrompt) => {
    const single = vi.fn(async () => ({ data: { id: "pattern-project" }, error: null }));
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select }));
    adminSupabase.from = vi.fn(() => ({ insert }));

    const { POST } = await import("@/app/api/upload/route.js");
    const res = await POST(jsonRequest({
      imageUrl: "https://storage.example/users/user-1/pattern.png",
      traceType,
      projectName: "Pattern Test",
    }));

    expect(res.status).toBe(200);
    expect(insert).toHaveBeenCalledWith([
      expect.objectContaining({
        trace_type: "pattern",
        ai_prompt: aiPrompt,
      }),
    ]);
  });
});

describe("delete project", () => {
  it("deletes only an owned project row before deleting owned R2 files", async () => {
    const project = {
      original_image_url: "https://storage.example/users/user-1/original.png",
      generated_image_url: "https://storage.example/projects/project-1/generated.png",
      upscaled_image_url: null,
      svg_url: "https://storage.example/projects/project-1/output.svg",
      zip_url: null,
      user_id: "user-1",
    };
    const fetchQuery = mockQuery({ data: project, error: null });
    const deleteEq2 = vi.fn(async () => ({ error: null }));
    const deleteEq1 = vi.fn(() => ({ eq: deleteEq2 }));
    const deleteFn = vi.fn(() => ({ eq: deleteEq1 }));
    const deleteQuery = { delete: deleteFn };
    adminSupabase.from = vi.fn()
      .mockReturnValueOnce(fetchQuery)
      .mockReturnValueOnce(deleteQuery);

    const { DELETE } = await import("@/app/api/project/route.js");
    const res = await DELETE(new Request("http://localhost/api/project?id=project-1", {
      method: "DELETE",
      headers: { authorization: "Bearer test-token" },
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(deleteFn).toHaveBeenCalled();
    expect(deleteFromR2).toHaveBeenCalledTimes(3);
    expect(deleteFromR2).toHaveBeenCalledWith(project.original_image_url, {
      allowedPrefixes: ["users/user-1/", "projects/project-1/"],
    });
  });
});

describe("download proxy", () => {
  it("rejects missing download URL before any upstream fetch", async () => {
    const { GET } = await import("@/app/api/proxy/route.js");
    const res = await GET(new Request("http://localhost/api/proxy"));
    const body = await res.text();

    expect(res.status).toBe(400);
    expect(body).toMatch(/missing url/i);
  });
});

describe("paid AI operation charge boundaries", () => {
  it("finishes a standard SVG with the backup engine after the primary times out", async () => {
    const previousId = process.env.VECTORIZER_API_ID;
    const previousSecret = process.env.VECTORIZER_API_SECRET;
    process.env.VECTORIZER_API_ID = "test-id";
    process.env.VECTORIZER_API_SECRET = "test-secret";
    try {
      adminSupabase.from = vi.fn(() => mockQuery({
        data: {
          id: "project-1",
          user_id: "user-1",
          trace_type: "logo",
          upscaled_image_url: "https://storage.example/projects/project-1/upscaled.png",
        },
        error: null,
      }));
      uploadToR2.mockResolvedValue("https://storage.example/projects/project-1/vector.svg");
      const { fetchWithRetry } = await import("@/lib/fetchWithRetry");
      fetchWithRetry
        .mockRejectedValueOnce(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }))
        .mockResolvedValueOnce(new Response('<svg xmlns="http://www.w3.org/2000/svg"></svg>', { status: 200 }));

      const { POST } = await import("@/app/api/trace-step3/route.js");
      const response = await POST(jsonRequest({ projectId: "project-1", svgEngine: "standard" }));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.svg_url).toBe("https://storage.example/projects/project-1/vector.svg");
      expect(body.engineUsed).toBe("precision");
      expect(body.warning).toMatch(/no extra Claws/);
      expect(fetchWithRetry).toHaveBeenCalledTimes(2);
      expect(adminSupabase.rpc).not.toHaveBeenCalled();
    } finally {
      if (previousId === undefined) delete process.env.VECTORIZER_API_ID;
      else process.env.VECTORIZER_API_ID = previousId;
      if (previousSecret === undefined) delete process.env.VECTORIZER_API_SECRET;
      else process.env.VECTORIZER_API_SECRET = previousSecret;
    }
  });

  it("returns a recoverable SVG timeout without charging or discarding the saved raster", async () => {
    const previousId = process.env.VECTORIZER_API_ID;
    const previousSecret = process.env.VECTORIZER_API_SECRET;
    delete process.env.VECTORIZER_API_ID;
    delete process.env.VECTORIZER_API_SECRET;
    try {
      const projectQuery = mockQuery({
        data: {
          id: "project-1",
          user_id: "user-1",
          trace_type: "logo",
          upscaled_image_url: "https://storage.example/projects/project-1/upscaled.png",
        },
        error: null,
      });
      adminSupabase.from = vi.fn(() => projectQuery);
      const { fetchWithRetry } = await import("@/lib/fetchWithRetry");
      fetchWithRetry.mockRejectedValueOnce(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }));

      const { POST } = await import("@/app/api/trace-step3/route.js");
      const response = await POST(jsonRequest({ projectId: "project-1", svgEngine: "standard" }));
      const body = await response.json();

      expect(response.status).toBe(504);
      expect(body.code).toBe("VECTOR_PROVIDER_UNAVAILABLE");
      expect(body.retryable).toBe(true);
      expect(body.error).toMatch(/extracted image is saved/);
      expect(adminSupabase.rpc).not.toHaveBeenCalled();
      expect(projectQuery.update).toHaveBeenCalledWith(expect.objectContaining({ failed_step: "step3" }));
    } finally {
      if (previousId === undefined) delete process.env.VECTORIZER_API_ID;
      else process.env.VECTORIZER_API_ID = previousId;
      if (previousSecret === undefined) delete process.env.VECTORIZER_API_SECRET;
      else process.env.VECTORIZER_API_SECRET = previousSecret;
    }
  });

  it("Auto Trace returns INSUFFICIENT_CREDITS before calling the provider", async () => {
    adminSupabase.from = vi.fn(() => mockQuery({
      data: {
        id: "project-1",
        user_id: "user-1",
        original_image_url: "https://storage.example/users/user-1/source.png",
        trace_type: "logo",
      },
      error: null,
    }));
    adminSupabase.rpc.mockResolvedValue({ data: [{ status: "insufficient_credits", credits_remaining: 0 }], error: null });

    const { POST } = await import("@/app/api/trace/route.js");
    const res = await POST(jsonRequest({ projectId: "project-1", step: 1 }));
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe("INSUFFICIENT_CREDITS");
    expect(adminSupabase.rpc).toHaveBeenCalledWith("claim_project_credit", expect.objectContaining({
      target_user_id: "user-1",
      target_project_id: "project-1",
      charge_action: "Extract & Vectorize",
    }));
  });

  it("Remove Background blocks already-processed work before charging", async () => {
    adminSupabase.from = vi.fn(() => mockQuery({
      data: {
        id: "project-1",
        user_id: "user-1",
        original_image_url: "https://storage.example/users/user-1/source.png",
        generated_image_url: "https://storage.example/projects/project-1/bg.png",
      },
      error: null,
    }));

    const { POST } = await import("@/app/api/remove-bg/route.js");
    const res = await POST(jsonRequest({ projectId: "project-1", keepOriginal: true }));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toBe("ALREADY_PROCESSED");
    expect(adminSupabase.rpc).not.toHaveBeenCalled();
  });

  it("Precision SVG returns INSUFFICIENT_CREDITS before vectorizer provider call", async () => {
    process.env.VECTORIZER_API_ID = "vectorizer-id";
    process.env.VECTORIZER_API_SECRET = "vectorizer-secret";
    adminSupabase.from = vi.fn(() => mockQuery({
      data: {
        id: "project-1",
        user_id: "user-1",
        upscaled_image_url: "https://storage.example/projects/project-1/upscaled.png",
        trace_type: "logo",
      },
      error: null,
    }));
    adminSupabase.rpc.mockResolvedValue({ data: [{ status: "insufficient_credits", credits_remaining: 0 }], error: null });

    const { POST } = await import("@/app/api/trace-step3/route.js");
    const res = await POST(jsonRequest({ projectId: "project-1", svgEngine: "precision", requestKey: "precision-request-0001" }));
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe("INSUFFICIENT_CREDITS");
    expect(adminSupabase.rpc).toHaveBeenCalledWith("claim_generation_attempt", {
      target_user_id: "user-1",
      target_project_id: "project-1",
      attempt_operation: "precision_svg",
      attempt_request_key: "precision-request-0001",
      charge_action: "Precision SVG Engine",
      charge_amount: 1,
    });
  });

  it("does not charge or call the provider again while Precision SVG is processing", async () => {
    process.env.VECTORIZER_API_ID = "vectorizer-id";
    process.env.VECTORIZER_API_SECRET = "vectorizer-secret";
    adminSupabase.from = vi.fn(() => mockQuery({
      data: { id: "project-1", user_id: "user-1", upscaled_image_url: "https://storage.example/projects/project-1/upscaled.png" },
      error: null,
    }));
    adminSupabase.rpc.mockResolvedValue({ data: [{ status: "already_claimed", attempt_id: "attempt-1", attempt_status: "processing", attempt_created_at: new Date().toISOString() }], error: null });
    const { fetchWithRetry } = await import("@/lib/fetchWithRetry");
    const { POST } = await import("@/app/api/trace-step3/route.js");
    const response = await POST(jsonRequest({ projectId: "project-1", svgEngine: "precision", requestKey: "precision-request-0002" }));
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("GENERATION_IN_PROGRESS");
    expect(adminSupabase.rpc).toHaveBeenCalledTimes(1);
    expect(fetchWithRetry).not.toHaveBeenCalled();
  });

  it("Upscale returns INSUFFICIENT_CREDITS without queueing a provider job", async () => {
    adminSupabase.rpc.mockResolvedValue({ data: [{ status: "insufficient_credits", credits_remaining: 0 }], error: null });

    const { fal } = await import("@fal-ai/client");
    const { POST } = await import("@/app/api/upscale/route.js");
    const res = await POST(jsonRequest({
      imageUrl: "https://storage.example/users/user-1/source.png",
      idempotencyKey: "upscale-request-1",
    }));
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe("INSUFFICIENT_CREDITS");
    expect(fal.queue.submit).not.toHaveBeenCalled();
  });

  it.each([
    ["photo", "High Fidelity V3"], ["logo", "Text Refine"], ["artwork", "CGI"],
  ])("Upscale queues faithful Topaz %s settings without shrinking the source", async (profile, model) => {
    sharpInstance.metadata.mockResolvedValueOnce({ width: 1500, height: 1000 });
    adminSupabase.rpc.mockResolvedValue({ data: [{ status: "claimed", project_id: "project-1" }], error: null });
    const query = mockQuery({ data: {}, error: null });
    adminSupabase.from.mockReturnValue(query);
    const { fal } = await import("@fal-ai/client");
    fal.queue.submit.mockResolvedValue({ request_id: "topaz-job", status: "IN_QUEUE" });
    const { POST } = await import("@/app/api/upscale/route.js");
    const res = await POST(jsonRequest({ imageUrl: "https://storage.example/users/user-1/source.png", idempotencyKey: "topaz-request", profile }));
    expect(res.status).toBe(200);
    expect(fal.queue.submit).toHaveBeenCalledWith("topaz/upscale/image/precision", {
      input: expect.objectContaining({ image_url: "https://storage.example/users/user-1/source.png", model, upscale_factor: 4, face_enhancement: false, crop_to_fill: false, output_format: "png", denoise: 0, sharpen: 0.1 }),
    });
    expect(query.update).toHaveBeenCalledWith({ ai_prompt: "fal:topaz/upscale/image/precision:topaz-job" });
    expect(sharpInstance.resize).not.toHaveBeenCalled();
    expect((await res.json()).cost).toMatchObject({ outputSize: "6000x4000", estimatedUsd: 0.08 });
  });

  it("Upscale rejects output above 24 MP before claiming credits or queueing", async () => {
    sharpInstance.metadata.mockResolvedValueOnce({ width: 1501, height: 1000 });
    const { POST } = await import("@/app/api/upscale/route.js");
    const res = await POST(jsonRequest({ imageUrl: "https://storage.example/users/user-1/source.png", idempotencyKey: "too-large" }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("UPSCALE_INPUT_LIMIT");
    expect(adminSupabase.rpc).not.toHaveBeenCalled();
    const { fal } = await import("@fal-ai/client");
    expect(fal.queue.submit).not.toHaveBeenCalled();
  });

  it.each([
    [{ ai_prompt: "fal:topaz/upscale/image/precision:existing-job" }, { status: "IN_QUEUE", requestId: "existing-job" }],
    [{ generated_image_url: "https://storage.example/result.png" }, { status: "COMPLETED", upscaledUrl: "https://storage.example/result.png" }],
    [{ refunded: true, generated_image_url: "REFUNDED" }, { status: "FAILED", refunded: true }],
    [{ ai_prompt: null }, { status: "IN_QUEUE" }],
  ])("Upscale repeats return the existing job snapshot without resubmitting: %j", async (project, snapshot) => {
    adminSupabase.rpc.mockResolvedValue({ data: [{ status: "already_claimed", project_id: "project-1" }] });
    adminSupabase.from.mockReturnValue(mockQuery({ data: { id: "project-1", ...project }, error: null }));
    const { POST } = await import("@/app/api/upscale/route.js");
    const { fal } = await import("@fal-ai/client");
    const response = await POST(jsonRequest({ imageUrl: "https://storage.example/users/user-1/source.png", idempotencyKey: "same-request" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ projectId: "project-1", ...snapshot });
    expect(fal.queue.submit).not.toHaveBeenCalled();
    expect(adminSupabase.rpc).toHaveBeenCalledTimes(1);
  });

  it("Upscale status recovers a pending project without requiring the lost queue ID", async () => {
    adminSupabase.from.mockReturnValue(mockQuery({ data: { id: "project-1", ai_prompt: "fal:topaz/upscale/image/precision:job-1" }, error: null }));
    const { fal } = await import("@fal-ai/client");
    fal.queue.status.mockResolvedValue({ status: "IN_PROGRESS" });
    const { GET } = await import("@/app/api/upscale/route.js");
    const response = await GET(new Request("http://localhost/api/upscale?projectId=project-1", { headers: { authorization: "Bearer test-token" } }));
    expect(response.status).toBe(200);
    expect(fal.queue.status).toHaveBeenCalledWith("topaz/upscale/image/precision", { requestId: "job-1", logs: true });
  });

  it("does not refund or resubmit a queued job when saving its marker fails", async () => {
    adminSupabase.rpc.mockResolvedValue({ data: [{ status: "claimed", project_id: "project-1" }] });
    const query = mockQuery({ data: {}, error: null });
    query.then = resolve => resolve({ error: new Error("Database unavailable") });
    adminSupabase.from.mockReturnValue(query);
    const { fal } = await import("@fal-ai/client");
    fal.queue.submit.mockResolvedValue({ request_id: "queued-job" });
    const { POST } = await import("@/app/api/upscale/route.js");
    const response = await POST(jsonRequest({ imageUrl: "https://storage.example/users/user-1/source.png", idempotencyKey: "same-request" }));
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ projectId: "project-1", refunded: false, retryable: true });
    expect(adminSupabase.rpc).toHaveBeenCalledTimes(1);
    expect(fal.queue.submit).toHaveBeenCalledTimes(1);
    expect(query.update).toHaveBeenCalledTimes(3);
  });

  it("rejects malformed and animated upscale sources before claiming a credit", async () => {
    const { POST } = await import("@/app/api/upscale/route.js");
    sharpInstance.metadata.mockRejectedValueOnce(new Error("Invalid image"));
    const invalid = await POST(jsonRequest({ imageUrl: "https://storage.example/users/user-1/source.png", idempotencyKey: "invalid" }));
    expect(invalid.status).toBe(400);
    sharpInstance.metadata.mockResolvedValueOnce({ width: 100, height: 100, pages: 2 });
    const animated = await POST(jsonRequest({ imageUrl: "https://storage.example/users/user-1/source.png", idempotencyKey: "animated" }));
    expect(animated.status).toBe(400);
    expect(adminSupabase.rpc).not.toHaveBeenCalled();
  });

  it("Upscale rejects unapproved provider models before charging", async () => {
    const { POST } = await import("@/app/api/upscale/route.js");
    const res = await POST(jsonRequest({ imageUrl: "https://storage.example/users/user-1/source.png", idempotencyKey: "bad-model", profile: "Faces" }));
    expect(res.status).toBe(400);
    expect(adminSupabase.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["fal:topaz/upscale/image/precision:job-1", "topaz/upscale/image/precision"],
    ["fal:esrgan:job-1", "fal-ai/esrgan"],
    ["fal:aura-sr:job-1", "fal-ai/aura-sr"],
  ])("Upscale polls the saved endpoint for %s", async (marker, endpoint) => {
    adminSupabase.from.mockReturnValue(mockQuery({ data: { id: "project-1", ai_prompt: marker }, error: null }));
    const { fal } = await import("@fal-ai/client");
    fal.queue.status.mockResolvedValue({ status: "IN_PROGRESS" });
    const { GET } = await import("@/app/api/upscale/route.js");
    const res = await GET(new Request("http://localhost/api/upscale?projectId=project-1&requestId=job-1", { headers: { authorization: "Bearer test-token" } }));
    expect(res.status).toBe(200);
    expect(fal.queue.status).toHaveBeenCalledWith(endpoint, { requestId: "job-1", logs: true });
  });
});
