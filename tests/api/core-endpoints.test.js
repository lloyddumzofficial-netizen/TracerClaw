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
vi.mock("sharp", () => ({ default: sharpMock }));

beforeEach(() => {
  vi.clearAllMocks();
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
    const res = await POST(jsonRequest({ projectId: "project-1", svgEngine: "precision" }));
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe("INSUFFICIENT_CREDITS");
    expect(adminSupabase.rpc).toHaveBeenCalledWith("adjust_user_credit_with_log", {
      target_user_id: "user-1",
      credit_delta: -1,
      log_action: "Precision SVG Engine",
    });
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
});
