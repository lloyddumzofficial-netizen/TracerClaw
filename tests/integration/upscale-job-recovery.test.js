import { beforeEach, describe, expect, it, vi } from "vitest";

const uploadToR2 = vi.fn();
const fetchWithSSRFProtection = vi.fn();
vi.mock("@/lib/cloudflare", () => ({ uploadToR2 }));
vi.mock("@/lib/ssrf", () => ({
  fetchWithSSRFProtection, getAllowedProviderHosts: () => ["provider.test"], DEFAULT_MAX_UPSCALED_IMAGE_BYTES: 120_000_000,
}));
const { settleUpscaleJob } = await import("@/server/upscale/jobs");

// Model the conditional write and locked refund RPC with actual row state, so
// races test which operation wins rather than merely checking called methods.
function database(project) {
  const row = { ...project };
  const db = {
    from: vi.fn(() => {
      let update;
      const filters = [];
      const query = {
        select: () => query,
        eq: (key, value) => { filters.push([key, value]); return query; },
        is: (key, value) => { filters.push([key, value]); return query; },
        update: value => { update = value; return query; },
        maybeSingle: async () => {
          if (!filters.every(([key, value]) => row[key] === value)) return { data: null, error: null };
          if (db.failWrite && update) return { data: null, error: new Error("DB unavailable") };
          if (update) Object.assign(row, update);
          return { data: { ...row }, error: null };
        },
      };
      return query;
    }),
    rpc: vi.fn(async () => {
      if (row.refunded || row.generated_image_url) return { data: [{ status: "not_eligible" }] };
      row.refunded = true;
      row.generated_image_url = "REFUNDED";
      return { data: [{ status: "refunded" }] };
    }),
  };
  return { db, row };
}

const project = { id: "project-1", user_id: "user-1", trace_type: "upscale", created_at: new Date(Date.now() - 3600000).toISOString(), ai_prompt: "fal:topaz/upscale/image/precision:job-1", generated_image_url: null, credit_deducted: true, refunded: false };
let fal;
beforeEach(() => {
  vi.resetAllMocks();
  fal = { queue: { status: vi.fn(async () => ({ status: "COMPLETED" })), result: vi.fn(async () => ({ data: { image: { url: "https://provider.test/temporary.png" } } })) } };
  fetchWithSSRFProtection.mockResolvedValue({ response: new Response("", { headers: { "content-type": "image/png" } }), buffer: Buffer.from("png") });
  uploadToR2.mockResolvedValue("https://storage.test/projects/project-1/upscaled_result.png");
});

describe("durable upscale delivery shared by polling and cron", () => {
  it.each([
    ["fal:topaz/upscale/image/precision:job-1", "topaz/upscale/image/precision"],
    ["fal:esrgan:job-1", "fal-ai/esrgan"], ["fal:aura-sr:job-1", "fal-ai/aura-sr"],
  ])("recovers abandoned %s jobs and repeated settlement is harmless", async (marker, endpoint) => {
    const { db, row } = database({ ...project, ai_prompt: marker });
    const result = await settleUpscaleJob({ db, fal, project: { ...row } });
    expect(result).toMatchObject({ status: "COMPLETED", upscaledUrl: row.generated_image_url });
    expect(fal.queue.status).toHaveBeenCalledWith(endpoint, { requestId: "job-1", logs: true });
    expect(uploadToR2).toHaveBeenCalledWith(Buffer.from("png"), "projects/project-1/upscaled_result.png", "image/png");
    await settleUpscaleJob({ db, fal, project: { ...row } });
    expect(uploadToR2).toHaveBeenCalledTimes(1);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it.each(["IN_QUEUE", "IN_PROGRESS"])("keeps %s jobs pending without refunding them", async status => {
    const { db, row } = database(project);
    fal.queue.status.mockResolvedValue({ status });
    expect(await settleUpscaleJob({ db, fal, project: row })).toMatchObject({ status });
    expect(db.rpc).not.toHaveBeenCalled();
    expect(uploadToR2).not.toHaveBeenCalled();
  });

  it("keeps transient provider and storage failures recoverable", async () => {
    const { db, row } = database(project);
    fal.queue.status.mockRejectedValueOnce(new Error("Provider timeout"));
    await expect(settleUpscaleJob({ db, fal, project: { ...row } })).rejects.toThrow("Provider timeout");
    uploadToR2.mockRejectedValueOnce(new Error("R2 unavailable"));
    await expect(settleUpscaleJob({ db, fal, project: { ...row } })).rejects.toThrow("R2 unavailable");
    expect(row.generated_image_url).toBeNull();
    expect(db.rpc).not.toHaveBeenCalled();
    expect(await settleUpscaleJob({ db, fal, project: { ...row } })).toMatchObject({ status: "COMPLETED" });
    expect(row.generated_image_url).not.toContain("provider.test");
  });

  it("does not report delivery when the database cannot record it", async () => {
    const { db, row } = database(project);
    db.failWrite = true;
    await expect(settleUpscaleJob({ db, fal, project: { ...row } })).rejects.toThrow("DB unavailable");
    expect(row.generated_image_url).toBeNull();
    db.failWrite = false;
    expect(await settleUpscaleJob({ db, fal, project: { ...row } })).toMatchObject({ status: "COMPLETED" });
    expect(new Set(uploadToR2.mock.calls.map(call => call[1])).size).toBe(1);
  });

  it("refunds an expired provider asset after an earlier storage outage", async () => {
    const { db, row } = database(project);
    uploadToR2.mockRejectedValueOnce(new Error("R2 unavailable"));
    await expect(settleUpscaleJob({ db, fal, project: { ...row } })).rejects.toThrow("R2 unavailable");
    fetchWithSSRFProtection.mockResolvedValueOnce({ response: new Response("Expired", { status: 404 }), buffer: Buffer.from("Expired") });
    expect(await settleUpscaleJob({ db, fal, project: { ...row } })).toEqual({ status: "FAILED", refunded: true });
    expect(row.generated_image_url).toBe("REFUNDED");
    expect(db.rpc).toHaveBeenCalledTimes(1);
  });

  it("retries a fresh 404 result without prematurely refunding", async () => {
    const { db, row } = database({ ...project, created_at: new Date().toISOString() });
    fetchWithSSRFProtection.mockResolvedValueOnce({ response: new Response("Not ready", { status: 404 }), buffer: Buffer.from("Not ready") });
    await expect(settleUpscaleJob({ db, fal, project: { ...row } })).rejects.toThrow("404");
    expect(db.rpc).not.toHaveBeenCalled();
    expect(await settleUpscaleJob({ db, fal, project: { ...row } })).toMatchObject({ status: "COMPLETED" });
  });

  it.each(["failed", "expired", "empty"])("refunds a %s result once", async failure => {
    const { db, row } = database(project);
    if (failure === "failed") fal.queue.status.mockResolvedValue({ status: "FAILED" });
    if (failure === "expired") fal.queue.result.mockRejectedValue(Object.assign(new Error("Expired"), { status: 404 }));
    if (failure === "empty") fal.queue.result.mockResolvedValue({ data: {} });
    const stale = { ...row };
    expect(await settleUpscaleJob({ db, fal, project: stale })).toEqual({ status: "FAILED", refunded: true });
    expect(await settleUpscaleJob({ db, fal, project: { ...row } })).toEqual({ status: "FAILED", refunded: true });
    expect(db.rpc).toHaveBeenCalledTimes(1);
    expect(uploadToR2).not.toHaveBeenCalled();
  });

  it("does not overwrite a refund that wins during the storage copy", async () => {
    const { db, row } = database(project);
    uploadToR2.mockImplementationOnce(async () => {
      await db.rpc("refund_project_credit");
      return "https://storage.test/result.png";
    });
    expect(await settleUpscaleJob({ db, fal, project: { ...row } })).toEqual({ status: "FAILED", refunded: true });
    expect(row.generated_image_url).toBe("REFUNDED");
  });

  it("concurrent browser and cron completions converge on the same durable result", async () => {
    const { db, row } = database(project);
    const original = { ...row };
    const results = await Promise.all([
      settleUpscaleJob({ db, fal, project: original }),
      settleUpscaleJob({ db, fal, project: original }),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(results[0]).toMatchObject({ status: "COMPLETED", upscaledUrl: row.generated_image_url });
    expect(new Set(uploadToR2.mock.calls.map(call => call[1])).size).toBe(1);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("does not refund a completion that wins during provider lookup", async () => {
    const { db, row } = database(project);
    fal.queue.status.mockImplementationOnce(async () => { row.generated_image_url = "https://storage.test/result.png"; return { status: "FAILED" }; });
    expect(await settleUpscaleJob({ db, fal, project: { ...row } })).toEqual({ status: "COMPLETED", upscaledUrl: row.generated_image_url });
    expect(row.refunded).toBe(false);
  });
});
