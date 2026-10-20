import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase", () => ({
  adminSupabase: {
    rpc: vi.fn(),
    from: vi.fn(),
    auth: { admin: { getUserById: vi.fn() } },
  },
}));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

afterEach(() => {
  delete process.env.REFERRALS_ENABLED;
  delete process.env.REFERRAL_SECURITY_SECRET;
  delete process.env.CRON_SECRET;
});

describe("referral endpoint gates", () => {
  it("exposes the server-side feature flag without caching it", async () => {
    const { GET } = await import("@/app/api/referrals/status/route.js");

    const disabledResponse = GET();
    expect(disabledResponse.status).toBe(200);
    expect(disabledResponse.headers.get("cache-control")).toBe("no-store");
    expect(await disabledResponse.json()).toEqual({ enabled: false });

    process.env.REFERRALS_ENABLED = "true";
    const enabledResponse = GET();
    expect(await enabledResponse.json()).toEqual({ enabled: true });
  });

  it("keeps link creation disabled by default", async () => {
    const { POST } = await import("@/app/api/referrals/code/route.js");
    const response = await POST(new Request("http://localhost/api/referrals/code", { method: "POST" }));
    expect(response.status).toBe(503);
    expect((await response.json()).error).toMatch(/not enabled/i);
  });

  it("does not set referral cookies while the feature is disabled", async () => {
    const { GET } = await import("@/app/r/[code]/route.js");
    const response = await GET(
      new Request("http://localhost/r/DC1234567890ABCDEF12"),
      { params: Promise.resolve({ code: "DC1234567890ABCDEF12" }) }
    );
    expect(response.status).toBe(307);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("location")).toContain("referral=disabled");
  });

  it("protects the settlement cron with CRON_SECRET", async () => {
    process.env.REFERRALS_ENABLED = "true";
    process.env.CRON_SECRET = "cron-secret";
    const { GET } = await import("@/app/api/cron/referrals/route.js");
    const response = await GET(new Request("http://localhost/api/cron/referrals"));
    expect(response.status).toBe(401);
  });
});
