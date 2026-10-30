import { beforeEach, expect, it, vi } from "vitest";

const db = { from: vi.fn(), rpc: vi.fn() };
const uploadToR2 = vi.fn();
const fal = { queue: { status: vi.fn(), result: vi.fn() } };
vi.mock("@supabase/supabase-js", () => ({ createClient: () => db }));
vi.mock("@/lib/cloudflare", () => ({
  uploadToR2, deleteFromR2: vi.fn(), deleteR2Prefix: vi.fn(), bucketName: "test", s3Client: { send: async () => ({ Contents: [] }) },
}));
vi.mock("@fal-ai/client", () => ({ fal }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock("@/server/billing/recoverAttemptOutput", () => ({ getRecoverableAttemptOutput: vi.fn() }));
vi.mock("@/lib/ssrf", () => ({
  DEFAULT_MAX_UPSCALED_IMAGE_BYTES: 120000000, getAllowedProviderHosts: () => ["provider.test"],
  fetchWithSSRFProtection: async () => ({ response: new Response("", { headers: { "content-type": "image/png" } }), buffer: Buffer.from("png") }),
}));
let row;
beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "test-cron";
  process.env.FAL_KEY = "test-provider";
  row = { id: "project-1", user_id: "user-1", trace_type: "upscale", ai_prompt: "fal:topaz/upscale/image/precision:job-1", credit_deducted: true, refunded: false, generated_image_url: null };
  db.from.mockImplementation(table => {
    let fields = "";
    let update;
    const filters = [];
    const data = () => table === "projects" && fields.includes("ai_prompt") && filters.every(([key, value]) => row[key] === value) ? [{ ...row }] : [];
    const query = {
      select: value => { fields = value; return query; },
      eq: (key, value) => { filters.push([key, value]); return query; },
      is: (key, value) => { filters.push([key, value]); return query; },
      lt: () => query, not: () => query, order: () => query, limit: () => query,
      update: value => { update = value; return query; },
      upsert: async () => ({ error: null }),
      maybeSingle: async () => {
        if (!data().length) return { data: null, error: null };
        if (update) Object.assign(row, update);
        return { data: { ...row }, error: null };
      },
      then: resolve => resolve({ data: data(), error: null }),
    };
    return query;
  });
  db.rpc.mockImplementation(async () => {
    row.refunded = true;
    row.generated_image_url = "REFUNDED";
    return { data: [{ status: "refunded" }] };
  });
  fal.queue.status.mockResolvedValue({ status: "COMPLETED" });
  fal.queue.result.mockResolvedValue({ data: { image: { url: "https://provider.test/result.png" } } });
  uploadToR2.mockResolvedValue("https://storage.test/result.png");
});
async function runCleanup() {
  const { GET } = await import("@/app/api/cron/cleanup/route.js");
  const response = await GET(new Request("http://localhost/api/cron/cleanup", { headers: { authorization: "Bearer test-cron" } }));
  expect(response.status).toBe(200);
  return response.json();
}

it("the cleanup route recovers slash-containing Topaz jobs and repeat runs do not deliver twice", async () => {
  expect(await runCleanup()).toMatchObject({ upscalesRecovered: 1, upscalesRefunded: 0 });
  expect(fal.queue.status).toHaveBeenCalledWith("topaz/upscale/image/precision", { requestId: "job-1", logs: true });
  expect(await runCleanup()).toMatchObject({ upscalesRecovered: 0, upscalesRefunded: 0 });
  expect(uploadToR2).toHaveBeenCalledTimes(1);
});

it.each(["IN_QUEUE", "IN_PROGRESS"])("cleanup retains %s jobs instead of refunding active processing", async status => {
  fal.queue.status.mockResolvedValue({ status });
  expect(await runCleanup()).toMatchObject({ upscalesRecovered: 0, upscalesRefunded: 0 });
  expect(db.rpc).not.toHaveBeenCalled();
  expect(row.generated_image_url).toBeNull();
});

it.each(["FAILED", "missing marker", "unknown marker"])("cleanup refunds %s jobs exactly once", async state => {
  if (state === "FAILED") fal.queue.status.mockResolvedValue({ status: "FAILED" });
  else row.ai_prompt = state === "missing marker" ? null : "fal:unapproved-model:job-1";
  expect(await runCleanup()).toMatchObject({ upscalesRecovered: 0, upscalesRefunded: 1 });
  expect(await runCleanup()).toMatchObject({ upscalesRefunded: 0 });
  expect(db.rpc).toHaveBeenCalledTimes(1);
});
