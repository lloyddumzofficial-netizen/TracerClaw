import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ adminSupabase: { rpc: mocks.rpc, from: mocks.from } }));
import { designBillingMode, designBillingQuote, claimPaidDesignOperation, settleDesignBilling } from "@/server/designExtract/billing";
const project = { id: "project", user_id: "owner", revision: 3 };
const record = { idempotency_key: "unique-request-key", kind: "extract", layer_id: null, model: "fal-ai/qwen-image-layered", input: { image_url: "https://owned.test/source" } };
beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllEnvs());
describe("Design Extract billing boundary", () => {
  it.each(['beta','paid'])('returns the real owned balance in %s mode without charging', async mode => {
    vi.stubEnv('DESIGN_EXTRACT_BILLING_MODE',mode);
    const query={select:vi.fn(),eq:vi.fn(),maybeSingle:vi.fn(async()=>({data:{credits:4}}))};
    query.select.mockReturnValue(query);query.eq.mockReturnValue(query);mocks.from.mockReturnValue(query);
    expect(await designBillingQuote('owner')).toMatchObject({mode,balance:4,prices:{extract:2,split:2,segment:1}});
    expect(query.eq).toHaveBeenCalledWith('id','owner');expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('never shows a made-up balance when profile lookup fails',async()=>{
    const query={select:()=>query,eq:()=>query,maybeSingle:async()=>({error:{code:'unavailable'}})};
    mocks.from.mockReturnValue(query);vi.stubEnv('DESIGN_EXTRACT_BILLING_MODE','beta');
    expect((await designBillingQuote('owner')).balance).toBeNull();
    vi.stubEnv('DESIGN_EXTRACT_BILLING_MODE','paid');await expect(designBillingQuote('owner')).rejects.toMatchObject({status:503});
  });
  it("defaults to paid when configuration is absent", () => { vi.stubEnv("DESIGN_EXTRACT_BILLING_MODE", undefined); expect(designBillingMode()).toBe("paid"); });
  it("allows only explicit supported modes", () => {
    vi.stubEnv("DESIGN_EXTRACT_BILLING_MODE", "paid"); expect(designBillingMode()).toBe("paid");
    vi.stubEnv("DESIGN_EXTRACT_BILLING_MODE", "typo"); expect(() => designBillingMode()).toThrow("not configured");
  });
  it("dispatches only the winning atomic paid claim, with no caller-selected amount", async () => {
    mocks.rpc.mockResolvedValue({ data: { status: "charged", job: { id: "job" } } });
    expect(await claimPaidDesignOperation(project, record)).toEqual({ job: { id: "job" }, dispatch: true });
    expect(mocks.rpc).toHaveBeenCalledWith("claim_design_extract", {
      target_user: "owner", target_project: "project", expected_revision: 3, request_key: "unique-request-key",
      operation_kind: "extract", target_layer: null, provider_model: record.model, provider_input: record.input,
    });
    mocks.rpc.mockResolvedValue({ data: { status: "existing", job: { id: "job" } } });
    expect((await claimPaidDesignOperation(project, record)).dispatch).toBe(false);
  });
  it.each(["PGRST202", "timeout", "unknown"])("fails closed on a missing or uncertain billing RPC (%s)", async code => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code } });
    await expect(claimPaidDesignOperation(project, record)).rejects.toMatchObject({ status: 503 });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it("returns an actionable insufficient-balance error", async () => {
    mocks.rpc.mockResolvedValue({ data: { status: "insufficient_credits" } });
    await expect(claimPaidDesignOperation(project, record)).rejects.toMatchObject({ status: 402 });
  });
  it("settles paid jobs even when the application has switched back to beta", async () => {
    vi.stubEnv("DESIGN_EXTRACT_BILLING_MODE", "beta");
    mocks.rpc.mockResolvedValue({ data: { status: "refunded" } });
    expect(await settleDesignBilling({ id: "job", user_id: "owner", billing_state: "held", status: "failed" })).toMatchObject({ billing_state: "refunded" });
    expect(mocks.rpc).toHaveBeenCalledWith("settle_design_extract_billing", { target_user: "owner", target_job: "job" });
  });
  it("leaves legacy beta jobs free without invoking a billing RPC", async () => {
    const legacy = { id: "old-job", status: "ready" };
    expect(await settleDesignBilling(legacy)).toBe(legacy); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("requires settlement confirmation before reporting completion", async () => {
    mocks.rpc.mockResolvedValue({ error: { code: "timeout" } });
    await expect(settleDesignBilling({ id: "job", user_id: "owner", billing_state: "held" })).rejects.toMatchObject({ status: 503 });
  });
});
