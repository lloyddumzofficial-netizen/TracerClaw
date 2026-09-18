import { beforeEach, describe, expect, it, vi } from "vitest";

const adminSupabase = { rpc: vi.fn(), from: vi.fn() };
const logger = { error: vi.fn() };

vi.mock("@/lib/supabase", () => ({ adminSupabase }));
vi.mock("@/lib/logger", () => ({ logger }));

const { claimGenerationAttempt, isGenerationAttemptStale, isValidGenerationRequestKey } = await import(
  "@/server/billing/generationAttempts.js"
);

describe("generation attempt billing", () => {
  beforeEach(() => vi.clearAllMocks());

  it("recognizes only attempts older than the recovery window as stale", () => {
    expect(isGenerationAttemptStale(new Date(Date.now() - 16 * 60_000).toISOString())).toBe(true);
    expect(isGenerationAttemptStale(new Date(Date.now() - 2 * 60_000).toISOString())).toBe(false);
    expect(isGenerationAttemptStale("invalid")).toBe(false);
  });

  it("rejects short or unsafe request keys before reaching the database", async () => {
    expect(isValidGenerationRequestKey("short")).toBe(false);
    expect(isValidGenerationRequestKey("this key contains spaces")).toBe(false);

    const result = await claimGenerationAttempt({
      userId: "user-1",
      projectId: "project-1",
      operation: "trace",
      requestKey: "short",
      chargeAction: "Extract & Vectorize",
    });

    expect(result).toEqual({ mode: "legacy", status: "missing_request_key" });
    expect(adminSupabase.rpc).not.toHaveBeenCalled();
  });

  it("returns an existing completed attempt for safe replay", async () => {
    adminSupabase.rpc.mockResolvedValue({
      data: [{
        status: "already_claimed",
        attempt_id: "attempt-1",
        attempt_status: "completed",
        result_url: "https://cdn.example/result.png",
        result_mime_type: "image/png",
        credits_remaining: 4,
      }],
      error: null,
    });

    const result = await claimGenerationAttempt({
      userId: "user-1",
      projectId: "project-1",
      operation: "trace",
      requestKey: "12345678-1234-1234-1234-123456789012",
      chargeAction: "Extract & Vectorize",
    });

    expect(result.mode).toBe("idempotent");
    expect(result.status).toBe("already_claimed");
    expect(result.result_url).toBe("https://cdn.example/result.png");
    expect(adminSupabase.rpc).toHaveBeenCalledTimes(1);
  });

  it("falls back safely while the additive migration is not yet available", async () => {
    adminSupabase.rpc.mockResolvedValue({
      data: null,
      error: { code: "PGRST202", message: "function not found" },
    });

    const result = await claimGenerationAttempt({
      userId: "user-1",
      projectId: "project-1",
      operation: "trace",
      requestKey: "12345678-1234-1234-1234-123456789012",
      chargeAction: "Extract & Vectorize",
    });

    expect(result).toEqual({ mode: "legacy", status: "rpc_unavailable" });
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it("refuses a legacy charge when the idempotent claim result is uncertain", async () => {
    adminSupabase.rpc.mockResolvedValue({
      data: null,
      error: { code: "ETIMEDOUT", message: "connection timed out" },
    });

    const result = await claimGenerationAttempt({
      userId: "user-1",
      projectId: "project-1",
      operation: "trace",
      requestKey: "12345678-1234-1234-1234-123456789012",
      chargeAction: "Extract & Vectorize",
    });

    expect(result).toEqual({ mode: "error", status: "claim_uncertain" });
  });

  it("uses the legacy claim only for a deterministic rolled-back SQL error", async () => {
    adminSupabase.rpc.mockResolvedValue({
      data: null,
      error: { code: "42702", message: "column reference is ambiguous" },
    });

    const result = await claimGenerationAttempt({
      userId: "user-1",
      projectId: "project-1",
      operation: "trace",
      requestKey: "12345678-1234-1234-1234-123456789012",
      chargeAction: "Extract & Vectorize",
    });

    expect(result).toEqual({ mode: "legacy", status: "rpc_unavailable" });
  });

  it("uses the legacy claim for a rolled-back RPC return-type mismatch", async () => {
    adminSupabase.rpc.mockResolvedValue({
      data: null,
      error: { code: "42804", message: "structure of query does not match function result type" },
    });

    const result = await claimGenerationAttempt({
      userId: "user-1",
      projectId: "project-1",
      operation: "trace",
      requestKey: "12345678-1234-1234-1234-123456789012",
      chargeAction: "Extract & Vectorize",
    });

    expect(result).toEqual({ mode: "legacy", status: "rpc_unavailable" });
  });
});
