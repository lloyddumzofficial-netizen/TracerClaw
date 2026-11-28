import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { POST } from "@/app/api/payments/dodo/checkout/route";

const mocks = vi.hoisted(() => ({
  insert: vi.fn(),
  update: vi.fn(),
  checkout: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  adminSupabase: {
    auth: { getUser: async () => ({ data: { user: { id: "user-1", email: "test@example.com" } } }) },
    from: () => ({ insert: mocks.insert, update: mocks.update }),
  },
}));
vi.mock("@/lib/rateLimit", () => ({ enforceRateLimit: async () => ({ success: true }) }));
vi.mock("@/lib/dodo", () => ({
  getDodoClient: () => ({ checkoutSessions: { create: mocks.checkout } }),
  getSiteUrl: () => "https://desaynclaw.com",
}));

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("DODO_PAYMENTS_ENVIRONMENT", "live_mode");
  vi.stubEnv("DODO_PAYMENTS_API_KEY", "test-key");
  vi.stubEnv("DODO_PAYMENTS_WEBHOOK_SECRET", "test-secret");
  vi.stubEnv("DODO_PRODUCT_INTL_BASIC_V3", "product-basic");
  mocks.insert.mockReturnValue({ select: () => ({ single: async () => ({ data: { id: "local-1" } }) }) });
  mocks.update.mockReturnValue({ eq: () => ({ eq: async () => ({ error: null }) }) });
  mocks.checkout.mockResolvedValue({ checkout_url: "https://checkout.example/session", session_id: "session-1" });
});
afterEach(() => vi.unstubAllEnvs());

function request(plan = "basic") {
  return new Request("https://desaynclaw.com/api/payments/dodo/checkout", {
    method: "POST",
    headers: { Authorization: "Bearer test-token", "Content-Type": "application/json" },
    body: JSON.stringify({ plan, billingCurrency: "EUR" }),
  });
}

it("reserves the USD catalog offer and opens a localized hosted checkout", async () => {
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ checkoutUrl: "https://checkout.example/session" });
  expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
    amount: 279, currency: "USD", credits: 5, requested_billing_currency: "EUR",
  }));
  expect(mocks.checkout).toHaveBeenCalledWith(expect.objectContaining({
    billing_currency: "EUR",
    product_cart: [{ product_id: "product-basic", quantity: 1 }],
    metadata: expect.objectContaining({ local_payment_id: "local-1" }),
  }));
});

it("keeps Mini out of Dodo and blocks live checkout without a webhook secret", async () => {
  expect((await POST(request("tingi"))).status).toBe(400);
  vi.stubEnv("DODO_PAYMENTS_WEBHOOK_SECRET", "");
  expect((await POST(request())).status).toBe(503);
  expect(mocks.insert).not.toHaveBeenCalled();
  expect(mocks.checkout).not.toHaveBeenCalled();
});
