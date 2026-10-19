import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  requireUser: vi.fn(),
  enforceRateLimit: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({ adminSupabase: { from: mocks.from } }));
vi.mock("@/server/api/auth", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/rateLimit", () => ({ enforceRateLimit: mocks.enforceRateLimit }));

function chain(finalMethod, result) {
  const query = {};
  for (const method of ["select", "update", "eq", "is", "in", "order"]) {
    query[method] = vi.fn(() => query);
  }
  query[finalMethod] = vi.fn().mockResolvedValue(result);
  return query;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ user: { id: "user-1" }, response: null });
  mocks.enforceRateLimit.mockResolvedValue({ success: true, headers: {} });
});

describe("referral reward notice endpoint", () => {
  it("returns only unread settled rewards with the authoritative balance", async () => {
    const rewards = [{
      id: "123e4567-e89b-42d3-a456-426614174000",
      reward_type: "referrer_completion",
      amount: 1,
      settled_at: "2026-10-20T00:00:00.000Z",
    }];
    const rewardQuery = chain("limit", { data: rewards, error: null });
    const profileQuery = chain("single", { data: { credits: 7 }, error: null });
    mocks.from.mockImplementation((table) => ({
      select: vi.fn(() => table === "referral_rewards" ? rewardQuery : profileQuery),
    }));

    const { GET } = await import("@/app/api/referral-rewards/route.js");
    const response = await GET(new Request("https://desaynclaw.com/api/referral-rewards"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ unreadCount: 1, unreadAmount: 1, balance: 7 });
    expect(body.notifications[0]).toMatchObject({ type: "referrer_completion", amount: 1 });
    expect(rewardQuery.eq).toHaveBeenCalledWith("recipient_user_id", "user-1");
    expect(rewardQuery.is).toHaveBeenCalledWith("acknowledged_at", null);
  });

  it("acknowledges only rewards owned by the signed-in recipient", async () => {
    const rewardId = "123e4567-e89b-42d3-a456-426614174000";
    const updateQuery = chain("select", { data: [{ id: rewardId }], error: null });
    mocks.from.mockReturnValue({ update: vi.fn(() => updateQuery) });

    const { POST } = await import("@/app/api/referral-rewards/route.js");
    const response = await POST(new Request("https://desaynclaw.com/api/referral-rewards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [rewardId] }),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ acknowledged: [rewardId] });
    expect(updateQuery.eq).toHaveBeenCalledWith("recipient_user_id", "user-1");
    expect(updateQuery.eq).toHaveBeenCalledWith("status", "rewarded");
  });

  it("rejects malformed reward identifiers", async () => {
    const { POST } = await import("@/app/api/referral-rewards/route.js");
    const response = await POST(new Request("https://desaynclaw.com/api/referral-rewards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: ["not-a-uuid"] }),
    }));

    expect(response.status).toBe(400);
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
