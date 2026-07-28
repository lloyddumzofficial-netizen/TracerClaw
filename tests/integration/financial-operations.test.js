import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTableRouter, jsonRequest, mockQuery, okRateLimit } from "../helpers/routeTestUtils.js";

const adminSupabase = {
  auth: {
    getUser: vi.fn(),
  },
  from: vi.fn(),
  rpc: vi.fn(),
};

const sendEmail = vi.fn();
const getDodoClient = vi.fn();

vi.mock("@/lib/supabase", () => ({ adminSupabase }));
vi.mock("@/lib/rateLimit", () => ({
  enforceRateLimit: okRateLimit(),
  getClientIp: () => "127.0.0.1",
  getRedisClient: () => null,
}));
vi.mock("@/lib/email", () => ({ sendEmail }));
vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));
vi.mock("@/lib/dodo", () => ({
  getDodoClient,
  getSiteUrl: () => "https://desaynclaw.com",
}));

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ADMIN_EMAIL = "admin@desaynclaw.test";
  process.env.DODO_PRODUCT_BASIC = "prod_basic";
  adminSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: "user-1", email: "user@example.com", user_metadata: {} } },
    error: null,
  });
});

describe("GCash payment submission", () => {
  it("normalizes references and creates one pending payment request", async () => {
    const insertSingle = vi.fn(async () => ({ data: { id: "pay-1", created_at: "2026-01-01" }, error: null }));
    const insertSelect = vi.fn(() => ({ single: insertSingle }));
    const insert = vi.fn(() => ({ select: insertSelect }));
    const tableRouter = createTableRouter({
      payment_requests: () => {
        const query = mockQuery({ data: null, error: null });
        query.insert = insert;
        return query;
      },
    });
    adminSupabase.from = tableRouter.from;

    const { POST } = await import("@/app/api/payments/gcash/submit/route.js");
    const res = await POST(jsonRequest({
      plan: "basic",
      referenceNumber: " 123 456 789 ",
      proofUrl: "https://storage.example/proof.png",
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true, requestId: "pay-1" });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      plan: "basic",
      reference_number: "123456789",
      status: "pending",
      user_id: "user-1",
    }));
  });

  it("blocks a second pending GCash request for the same user", async () => {
    const tableRouter = createTableRouter({
      payment_requests: () => mockQuery({ data: { id: "pending-1" }, error: null }),
    });
    adminSupabase.from = tableRouter.from;

    const { POST } = await import("@/app/api/payments/gcash/submit/route.js");
    const res = await POST(jsonRequest({
      plan: "basic",
      referenceNumber: "abc",
      proofUrl: "https://storage.example/proof.png",
    }));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toMatch(/already have a pending/i);
  });
});

describe("Manual GCash approval", () => {
  it("approves through the atomic RPC and sends receipt email after credit grant", async () => {
    adminSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: "admin-1", email: "admin@desaynclaw.test" } },
      error: null,
    });
    adminSupabase.from = vi.fn(() => mockQuery({
      data: {
        id: "pay-1",
        plan: "starter",
        email: "buyer@example.com",
        reference_number: "ref-1",
      },
      error: null,
    }));
    adminSupabase.rpc.mockResolvedValue({
      data: [{ status: "approved", credited_email: "buyer@example.com", credited_plan: "starter", credited_reference: "ref-1" }],
      error: null,
    });
    sendEmail.mockResolvedValue({ success: true });

    const { POST } = await import("@/app/api/admin/approve-payment/route.js");
    const res = await POST(jsonRequest({ requestId: "pay-1", markOnly: false }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true, addedCredits: 10 });
    expect(adminSupabase.rpc).toHaveBeenCalledWith("approve_manual_payment_request", {
      payment_request_id: "pay-1",
      credits_to_add: 10,
      mark_only: false,
    });
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "buyer@example.com" }));
  });
});

describe("Dodo checkout", () => {
  it("rejects GCash-only packages before creating a local payment", async () => {
    adminSupabase.from = vi.fn();

    const { POST } = await import("@/app/api/payments/dodo/checkout/route.js");
    const res = await POST(jsonRequest({ plan: "tingi" }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/only available via GCash/i);
    expect(adminSupabase.from).not.toHaveBeenCalled();
  });

  it("creates a pending local payment before opening Dodo checkout", async () => {
    const updateEq = vi.fn(() => ({}));
    const update = vi.fn(() => ({ eq: vi.fn(() => ({ eq: updateEq })) }));
    const insertSingle = vi.fn(async () => ({
      data: { id: "dodo-local-1", plan: "basic", amount: 14000, credits: 5 },
      error: null,
    }));
    const insert = vi.fn(() => ({ select: () => ({ single: insertSingle }) }));
    adminSupabase.from = vi.fn(() => ({ insert, update }));
    getDodoClient.mockReturnValue({
      checkoutSessions: {
        create: vi.fn(async () => ({ checkout_url: "https://checkout.example/session", session_id: "sess-1" })),
      },
    });

    const { POST } = await import("@/app/api/payments/dodo/checkout/route.js");
    const res = await POST(jsonRequest({ plan: "basic" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.checkoutUrl).toBe("https://checkout.example/session");
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      user_id: "user-1",
      plan: "basic",
      credits: 5,
      status: "pending",
    }));
    expect(getDodoClient().checkoutSessions.create).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ local_payment_id: "dodo-local-1", user_id: "user-1" }),
    }));
  });
});

describe("Credit refunds", () => {
  it("refuses to refund a failed project that still has usable output", async () => {
    adminSupabase.from = vi.fn(() => mockQuery({
      data: {
        user_id: "user-1",
        credit_deducted: true,
        refunded: false,
        failed_at: "2026-01-01T00:00:00Z",
        generated_image_url: null,
        upscaled_image_url: null,
        svg_url: "https://storage.example/output.svg",
      },
      error: null,
    }));

    const { POST } = await import("@/app/api/refund/route.js");
    const res = await POST(jsonRequest({ projectId: "project-1" }));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toMatch(/produced output/i);
    expect(adminSupabase.rpc).not.toHaveBeenCalled();
  });

  it("uses the atomic refund RPC only for eligible failed projects", async () => {
    adminSupabase.from = vi.fn(() => mockQuery({
      data: {
        user_id: "user-1",
        credit_deducted: true,
        refunded: false,
        failed_at: "2026-01-01T00:00:00Z",
        failed_step: "trace",
        generated_image_url: null,
        upscaled_image_url: null,
        svg_url: null,
      },
      error: null,
    }));
    adminSupabase.rpc.mockResolvedValue({ data: [{ status: "refunded" }], error: null });

    const { POST } = await import("@/app/api/refund/route.js");
    const res = await POST(jsonRequest({ projectId: "project-1" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(adminSupabase.rpc).toHaveBeenCalledWith("refund_project_credit", {
      target_user_id: "user-1",
      target_project_id: "project-1",
      refund_action: "Refund",
      failed_step_value: "trace",
      mark_generated_refunded: true,
    });
  });
});
