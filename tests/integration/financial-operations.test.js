import { beforeEach, describe, expect, it, vi } from "vitest";
import { jsonRequest, mockQuery, okRateLimit } from "../helpers/routeTestUtils.js";

const adminSupabase = {
  auth: {
    getUser: vi.fn(),
  },
  from: vi.fn(),
  rpc: vi.fn(),
};

const sendEmail = vi.fn();
const getDodoClient = vi.fn();
const fulfillDodoPayment = vi.fn();
const markDodoPaymentStatus = vi.fn();

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
vi.mock("@/server/payments/dodoFulfillment", () => ({
  fulfillDodoPayment,
  markDodoPaymentStatus,
}));

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ADMIN_EMAIL = "admin@desaynclaw.test";
  process.env.DODO_PRODUCT_BASIC = "prod_basic";
  process.env.DODO_PAYMENTS_WEBHOOK_SECRET = "test-webhook-secret";
  adminSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: "user-1", email: "user@example.com", user_metadata: {} } },
    error: null,
  });
});

describe("Legacy manual GCash submission", () => {
  it("is permanently disabled in favor of automatic QR Ph", async () => {
    adminSupabase.from = vi.fn();
    const { POST } = await import("@/app/api/payments/gcash/submit/route.js");
    const res = await POST(jsonRequest({ plan: "basic" }));
    const body = await res.json();

    expect(res.status).toBe(410);
    expect(body).toEqual(expect.objectContaining({
      code: "MANUAL_GCASH_DISABLED",
      error: expect.stringMatching(/QR Ph/i),
    }));
    expect(adminSupabase.from).not.toHaveBeenCalled();
  });
});

describe("Dodo webhook fulfillment", () => {
  it("verifies a successful event and delegates to the idempotent fulfillment service", async () => {
    const payment = { payment_id: "pay-provider-1", metadata: { local_payment_id: "dodo-local-1" } };
    const unwrap = vi.fn(() => ({ type: "payment.succeeded", data: payment }));
    getDodoClient.mockReturnValue({ webhooks: { unwrap } });
    fulfillDodoPayment.mockResolvedValue({ status: "paid", granted: true });

    const { POST } = await import("@/app/api/payments/dodo/webhook/route.js");
    const request = new Request("http://localhost/api/payments/dodo/webhook", {
      method: "POST",
      headers: {
        "webhook-id": "evt-1",
        "webhook-signature": "signature-1",
        "webhook-timestamp": "1700000000",
      },
      body: JSON.stringify({ type: "payment.succeeded" }),
    });
    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    expect(unwrap).toHaveBeenCalledWith(expect.any(String), {
      headers: {
        "webhook-id": "evt-1",
        "webhook-signature": "signature-1",
        "webhook-timestamp": "1700000000",
      },
      key: "test-webhook-secret",
    });
    expect(fulfillDodoPayment).toHaveBeenCalledWith({ payment, source: "webhook" });
  });

  it.each(["payment.failed", "payment.cancelled"])("marks %s as failed without granting credits", async (type) => {
    const payment = { payment_id: "pay-provider-failed" };
    getDodoClient.mockReturnValue({ webhooks: { unwrap: vi.fn(() => ({ type, data: payment })) } });

    const { POST } = await import("@/app/api/payments/dodo/webhook/route.js");
    const response = await POST(new Request("http://localhost/api/payments/dodo/webhook", {
      method: "POST",
      body: "{}",
    }));

    expect(response.status).toBe(200);
    expect(markDodoPaymentStatus).toHaveBeenCalledWith(payment, "failed");
    expect(fulfillDodoPayment).not.toHaveBeenCalled();
  });
});

describe("Legacy manual GCash approval", () => {
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
  it("rejects QR-Ph-only packages before creating a local payment", async () => {
    adminSupabase.from = vi.fn();

    const { POST } = await import("@/app/api/payments/dodo/checkout/route.js");
    const res = await POST(jsonRequest({ plan: "tingi" }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/QR Ph/i);
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
      mark_generated_refunded: false,
    });
  });
});

describe("Provider and refund failure boundaries", () => {
  it("returns 400 for malformed Dodo checkout JSON without creating a payment", async () => {
    adminSupabase.from = vi.fn();
    const { POST } = await import("@/app/api/payments/dodo/checkout/route.js");
    const response = await POST(new Request("http://localhost/api/payments/dodo/checkout", {
      method: "POST",
      headers: { authorization: "Bearer test-token" },
      body: "{",
    }));

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("INVALID_REQUEST");
    expect(adminSupabase.from).not.toHaveBeenCalled();
  });

  it("rejects malformed provider payment identifiers before database access", async () => {
    adminSupabase.from = vi.fn();
    const { GET: getDodoStatus } = await import("@/app/api/payments/dodo/status/route.js");
    const { GET: getPayMongoStatus } = await import("@/app/api/payments/paymongo/status/route.js");
    const headers = { authorization: "Bearer test-token" };

    const dodoResponse = await getDodoStatus(new Request(
      "http://localhost/api/payments/dodo/status?paymentId=../../other-user",
      { headers },
    ));
    const payMongoResponse = await getPayMongoStatus(new Request(
      "http://localhost/api/payments/paymongo/status?paymentId=%3Cscript%3E",
      { headers },
    ));

    expect(dodoResponse.status).toBe(400);
    expect(payMongoResponse.status).toBe(400);
    expect(adminSupabase.from).not.toHaveBeenCalled();
  });

  it("fails closed when Dodo webhook verification throws", async () => {
    getDodoClient.mockReturnValue({
      webhooks: { unwrap: vi.fn(() => { throw new Error("invalid signature"); }) },
    });
    const { POST } = await import("@/app/api/payments/dodo/webhook/route.js");
    const response = await POST(new Request("http://localhost/api/payments/dodo/webhook", {
      method: "POST",
      headers: {
        "webhook-id": "evt-invalid",
        "webhook-signature": "bad-signature",
        "webhook-timestamp": "1700000000",
      },
      body: "{}",
    }));

    expect(response.status).toBe(400);
    expect(fulfillDodoPayment).not.toHaveBeenCalled();
    expect(markDodoPaymentStatus).not.toHaveBeenCalled();
  });

  it("returns the same successful result for an already-refunded project", async () => {
    adminSupabase.from = vi.fn(() => mockQuery({
      data: {
        user_id: "user-1",
        credit_deducted: true,
        refunded: true,
        failed_at: "2026-01-01T00:00:00Z",
        generated_image_url: null,
        upscaled_image_url: null,
        svg_url: null,
      },
      error: null,
    }));

    const { POST } = await import("@/app/api/refund/route.js");
    const response = await POST(jsonRequest({ projectId: "project-1" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      message: "Refund already processed",
    });
    expect(adminSupabase.rpc).not.toHaveBeenCalled();
  });

  it("returns 400 for malformed refund JSON without querying a project", async () => {
    adminSupabase.from = vi.fn();
    const { POST } = await import("@/app/api/refund/route.js");
    const response = await POST(new Request("http://localhost/api/refund", {
      method: "POST",
      headers: { authorization: "Bearer test-token" },
      body: "{",
    }));

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("INVALID_REQUEST");
    expect(adminSupabase.from).not.toHaveBeenCalled();
  });
});
