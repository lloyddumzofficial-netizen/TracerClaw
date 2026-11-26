import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), read: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ adminSupabase: { from: mocks.from, rpc: mocks.rpc } }));
vi.mock("@/server/designExtract/storage", () => ({ readPrivateDesignAsset: mocks.read, uploadDesignAsset: vi.fn() }));
import { recoverDesignFinishing } from "@/server/designExtract/finishRecovery";

const now = Date.parse("2026-11-26T10:00:00Z");
const action = { id: "action", batch_id: "batch", action: "svg", created_at: "2026-11-26T09:50:00Z", design_extract_finish_bundles: { user_id: "owner" } };
const filename = "users/owner/design-extract/project/svg/receipt.json";
function pendingRows(data) {
  const query = { select: () => query, eq: () => query, lt: () => query, gte: () => query, order: () => query, limit: async () => ({ data }) };
  return query;
}
function batchProject() {
  const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { project_id: "project" } }) };
  return query;
}
const json = value => Buffer.from(JSON.stringify(value));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.from.mockReturnValueOnce(pendingRows([])).mockReturnValueOnce(pendingRows([action])).mockReturnValueOnce(batchProject());
  mocks.read.mockResolvedValueOnce(json({ recordKey: filename }));
  mocks.rpc.mockResolvedValue({ error: null });
});

it.each([["done", true], ["failed", false], ["submitting", false]])("settles a stale %s receipt without contacting Recraft", async (state, usable) => {
  mocks.read.mockResolvedValueOnce(json({ finishActionId: action.id, state }));
  await recoverDesignFinishing(now);
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("settle_design_extract_finish", { target_user: "owner", target_action: action.id, usable });
});

it("preserves a resumable provider receipt", async () => {
  mocks.read.mockResolvedValueOnce(json({ finishActionId: action.id, state: "generated" }));
  await recoverDesignFinishing(now);
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it("does not refund when R2 cannot confirm the receipt state", async () => {
  mocks.read.mockRejectedValueOnce(new Error("R2 unavailable"));
  await expect(recoverDesignFinishing(now)).rejects.toThrow("R2 unavailable");
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it("settles an expired receipt even if a more recent action cannot be read", async () => {
  const expired = { ...action, id: "expired", created_at: "2026-11-25T08:00:00Z" };
  mocks.from.mockReset().mockReturnValueOnce(pendingRows([expired])).mockReturnValueOnce(pendingRows([action])).mockReturnValue(batchProject());
  mocks.read.mockResolvedValueOnce(json({ finishActionId: expired.id, state: "generated" })).mockRejectedValueOnce(new Error("R2 unavailable"));
  await expect(recoverDesignFinishing(now)).rejects.toThrow("R2 unavailable");
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("settle_design_extract_finish", { target_user: "owner", target_action: expired.id, usable: false });
});
