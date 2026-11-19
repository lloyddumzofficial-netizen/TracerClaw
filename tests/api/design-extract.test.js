import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import sharp from "sharp";
import { randomFillSync } from "node:crypto";
import { jsonRequest } from "../helpers/routeTestUtils";
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), from: vi.fn(), rpc: vi.fn(), status: vi.fn(), result: vi.fn(), submit: vi.fn(), fetch: vi.fn(), upload: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ adminSupabase: { auth: { getUser: mocks.getUser }, from: mocks.from, rpc: mocks.rpc } }));
vi.mock("@/lib/rateLimit", () => ({ enforceRateLimit: async () => ({ success: true }) }));
vi.mock("@fal-ai/client", () => ({ fal: { queue: { status: mocks.status, result: mocks.result, submit: mocks.submit } } }));
vi.mock("@/server/designExtract/storage", async () => ({ ...(await vi.importActual("@/server/designExtract/storage")), uploadDesignAsset: mocks.upload }));
vi.mock("@/server/designExtract/processing/launcher",()=>({maintainDesignWorkflows:async()=>{},wakeDesignWorkflow:async()=>{}}));
vi.mock("@/server/designExtract/submission", () => ({ submitDesignOperation: mocks.submit }));
vi.mock("@/lib/cloudflare", () => ({ bucketName: "public-bucket", s3Client: { send: vi.fn(async () => ({ Contents: [] })) }, uploadToR2: mocks.upload, deleteR2Prefix: vi.fn() }));
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: async () => "https://private-signed.test/source.png" }));
vi.mock("@/lib/ssrf", () => ({ fetchWithSSRFProtection: mocks.fetch, getAllowedProviderHosts: () => ["fal.media"], getAllowedStorageHosts: () => ["r2.test"], isOwnedStorageUrl: (url, { userId }) => url?.startsWith(`https://r2.test/users/${userId}/`) }));
import { GET, POST } from "@/app/api/design-extract/route";
import { GET as getDocument } from "@/app/api/design-extract/[id]/route";
import { POST as syncDocument } from "@/app/api/design-extract/[id]/sync/route";
import { readAsset, ownedProject, createProject, startOperation, settleOperation, reviewOperation, recoverOperation, snapshot, editLayerAsset } from "@/server/designExtract/service";
import { renameDesignProject, deleteDesignProject } from "@/server/designExtract/service";
import { maintainDesignExtract } from "@/server/designExtract/maintenance";
import { deleteR2Prefix } from "@/lib/cloudflare";
import { designError } from "@/server/designExtract/access";
function query(data, error = null) {
  const q = {};
  for (const key of ["select", "eq", "is", "gt", "lt", "in", "order", "limit", "insert", "update", "delete"]) q[key] = vi.fn(() => q);
  q.single = q.maybeSingle = vi.fn(async () => ({ data, error }));
  q.then = (resolve, reject) => Promise.resolve({ data, error }).then(resolve, reject);
  return q;
}
const project = { id: "project-1", user_id: "admin-1", revision: 0, source_url: "https://r2.test/users/admin-1/source.png", manifest: { version: 1, width: 100, height: 100, layers: [] }, expires_at: "2099-01-01" };
beforeEach(async () => {
  vi.resetAllMocks(); vi.stubEnv("DESIGN_EXTRACT_PRIVATE_BUCKET", "design-extract-private"); vi.stubEnv("DESIGN_EXTRACT_BILLING_MODE", "beta"); vi.stubEnv("ADMIN_EMAIL", "admin@test.com"); vi.stubEnv("DESIGN_EXTRACT_ENABLED", "true");
  vi.stubEnv("FAL_KEY", "mock-key");
  mocks.fetch.mockResolvedValue({buffer:await sharp({create:{width:100,height:100,channels:4,background:"#fff"}}).png().toBuffer()});
  mocks.upload.mockImplementation(async (_bytes,key)=>"r2-private://design-extract/"+key);
  mocks.getUser.mockResolvedValue({ data: { user: { id: "admin-1", email: "admin@test.com" } } });
});
afterEach(() => vi.unstubAllEnvs());
describe("Design Extract admin gate", () => {
  it("never exposes untrusted upstream error messages or credentials", async () => {
    const response = designError(Object.assign(new Error("Provider rejected Key secret-token at https://private.test/image.png"), { status: 403 }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Design Extract request failed. Please retry." });
  });
  it("returns manager cards with thumbnails, names, and the correct workspace type", async () => {
    mocks.from.mockReturnValue(query([{ id: "layers-1", created_at: "2026-11-17", source_url: "https://r2.test/artwork.png", manifest: { name: "Jersey elements", layers: [] } }]));
    const response = await GET(jsonRequest({}));
    expect(response.status).toBe(200);
    expect((await response.json()).projects).toEqual([{ id: "layers-1", created_at: "2026-11-17", original_image_url: "https://r2.test/artwork.png", name: "Jersey elements", trace_type: "design_extract" }]);
  });
  it("reports unavailable auth service instead of incorrectly signing the user out", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: { name: "AuthRetryableFetchError", status: 0 } });
    const response = await GET(jsonRequest({}));
    expect(response.status).toBe(503);
    expect((await response.json()).error).toContain("Cannot reach the sign-in service");
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("rejects unauthenticated and non-admin callers before database access", async () => {
    expect((await GET(jsonRequest({}, { token: null }))).status).toBe(401);
    mocks.getUser.mockResolvedValue({ data: { user: { id: "other", email: "other@test.com" } } });
    expect((await POST(jsonRequest({}))).status).toBe(403); expect(mocks.from).not.toHaveBeenCalled();
  });
  it("fails closed when flag or admin configuration is absent", async () => {
    vi.stubEnv("DESIGN_EXTRACT_ENABLED", "false"); expect((await GET(jsonRequest({}))).status).toBe(404);
    expect((await POST(jsonRequest({ imageUrl: "https://r2.test/users/admin-1/source.png" }))).status).toBe(404);
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
    vi.stubEnv("ADMIN_EMAIL", ""); expect((await GET(jsonRequest({}))).status).toBe(403);
  });
  it("checks project ownership and expiry", async () => {
    const q = query(null); mocks.from.mockReturnValue(q);
    await expect(ownedProject("other-project", "admin-1")).rejects.toMatchObject({ status: 404 });
    expect(q.eq).toHaveBeenCalledWith("user_id", "admin-1");
    mocks.from.mockReturnValue(query({ ...project, expires_at: "2000-01-01" }));
    await expect(ownedProject(project.id, project.user_id)).rejects.toMatchObject({ status: 404 });
  });
  it("rejects unauthorized sources and corrupt files before creating projects", async () => {
    await expect(createProject("admin-1", "https://evil.test/image.png")).rejects.toMatchObject({ status: 400 });
    expect(mocks.fetch).not.toHaveBeenCalled();
    mocks.fetch.mockResolvedValue({ buffer: Buffer.from("not an image") });
    await expect(createProject("admin-1", project.source_url)).rejects.toThrow();
    expect(mocks.upload).not.toHaveBeenCalled();
  });
});
describe("durable operations", () => {
  it("rejects project creation without private storage before reading or reserving anything", async () => {
    vi.stubEnv("DESIGN_EXTRACT_PRIVATE_BUCKET", "");
    await expect(createProject(project.user_id, project.source_url)).rejects.toMatchObject({status:503});
    expect(mocks.fetch).not.toHaveBeenCalled(); expect(mocks.upload).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("accepts a sub-20MiB JPEG whose normalized PNG exceeds 20MiB and reads it under the internal cap", async () => {
    const jpg = await sharp(randomFillSync(Buffer.alloc(3000*3000*3)), {raw:{width:3000,height:3000,channels:3}}).jpeg({quality:88}).toBuffer();
    expect(jpg.length).toBeLessThan(20*1024*1024);
    mocks.fetch.mockResolvedValueOnce({buffer:jpg});
    mocks.from.mockReturnValue(query(project));
    mocks.upload.mockResolvedValue("r2-private://design-extract/users/admin-1/design-extract/project-1/source.png");
    await createProject(project.user_id, project.source_url);
    const normalized = mocks.upload.mock.calls[0][0];
    expect(normalized.length).toBeGreaterThan(20*1024*1024);
    expect(normalized.length).toBeLessThanOrEqual(100*1024*1024);
    expect(mocks.fetch.mock.calls[0][1].maxBytes).toBe(20*1024*1024);
    mocks.fetch.mockResolvedValueOnce({buffer:normalized});
    expect(await readAsset(project.source_url)).toBe(normalized);
    expect(mocks.fetch.mock.calls[1][1].maxBytes).toBe(100*1024*1024);
    expect((await sharp(normalized).metadata()).width).toBe(3000);
    expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.submit).not.toHaveBeenCalled();
  }, 15000);
  it("checks the acknowledged paid price before reserving credits", async () => {
    vi.stubEnv("DESIGN_EXTRACT_BILLING_MODE", "paid"); mocks.from.mockReturnValue(query(null));
    await expect(startOperation(project, { kind: "extract", idempotencyKey: "paid-request-key", priceVersion: "design-extract-v1", acknowledgedClaws: 0 })).rejects.toMatchObject({ status: 409 });
    expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("requires private source storage for paid generation", async () => {
    vi.stubEnv("DESIGN_EXTRACT_BILLING_MODE", "paid"); vi.stubEnv("DESIGN_EXTRACT_PRIVATE_BUCKET", ""); mocks.from.mockReturnValue(query(null));
    await expect(startOperation(project, { kind: "extract", idempotencyKey: "paid-request-key", priceVersion: "design-extract-v1", acknowledgedClaws: 2 })).rejects.toMatchObject({ status: 503 });
    expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("reserves a paid job once and sends only a temporary source link to the provider", async () => {
    vi.stubEnv("DESIGN_EXTRACT_BILLING_MODE", "paid"); vi.stubEnv("DESIGN_EXTRACT_PRIVATE_BUCKET", "design-extract-private");
    const privateProject = { ...project, source_url: "r2-private://design-extract/users/admin-1/design-extract/project-1/source.png" };
    const job = { id: "paid-job", project_id: project.id, user_id: project.user_id, base_revision: 0, status: "submitting", model: "fal-ai/qwen-image-layered", input: { image_url: privateProject.source_url }, kind: "extract", billing_state: "held", charge_amount: 2 };
    mocks.from.mockReturnValueOnce(query(null)).mockReturnValueOnce(query({ ...job, dispatch_started_at: "2026-11-18T00:00:00Z" })).mockReturnValueOnce(query({ ...job, status: "queued" }));
    mocks.rpc.mockResolvedValueOnce({ data: { status: "charged", job, credits_remaining: 3 } });
    mocks.submit.mockResolvedValueOnce({ request_id: "paid-provider-receipt" });
    const result = await startOperation(privateProject, { kind: "extract", idempotencyKey: "paid-request-key", priceVersion: "design-extract-v1", acknowledgedClaws: 2 });
    expect(result.creditsRemaining).toBe(3);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.submit).toHaveBeenCalledExactlyOnceWith("fal-ai/qwen-image-layered", expect.objectContaining({ input: expect.objectContaining({ image_url: "https://private-signed.test/source.png" }) }));
  });
  it("resumes a paid reservation after a lost claim receipt without reserving again", async () => {
    const privateProject = { ...project, source_url: "r2-private://design-extract/users/admin-1/design-extract/project-1/source.png" };
    const job = { id: "lost-claim", project_id: project.id, user_id: project.user_id, base_revision: 0, status: "submitting", model: "fal-ai/qwen-image-layered", input: { image_url: privateProject.source_url, _desaynclaw: { enhanceLayers: 1 } }, billing_state: "held", charge_amount: 2 };
    vi.stubEnv("DESIGN_EXTRACT_PRIVATE_BUCKET", "design-extract-private");
    const claim = query({ ...job, dispatch_started_at: "2026-11-18T00:00:00Z" });
    mocks.from.mockReturnValueOnce(claim).mockReturnValueOnce(query({ ...job, status: "queued" }));
    mocks.submit.mockResolvedValue({ request_id: "existing-reservation-receipt" });
    mocks.rpc.mockResolvedValue({ data: { status: "held" } });
    expect((await settleOperation(privateProject, job)).status).toBe("queued");
    expect(claim.is).toHaveBeenCalledWith("dispatch_started_at", null);
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    expect(mocks.submit.mock.calls[0][1].input).not.toHaveProperty("_desaynclaw");
    expect(mocks.rpc.mock.calls.every(([name]) => name === "settle_design_extract_billing")).toBe(true);
  });
  it("does not repeat dispatch after another poller wins the marker or a provider receipt is lost", async () => {
    const privateProject = { ...project, source_url: "r2-private://design-extract/users/admin-1/design-extract/project-1/source.png" };
    const job = { id: "dispatch-race", project_id: project.id, user_id: project.user_id, base_revision: 0, status: "submitting", model: "fal-ai/qwen-image-layered", input: { image_url: privateProject.source_url }, billing_state: "held", charge_amount: 2 };
    const started = { ...job, dispatch_started_at: "2026-11-18T00:00:00Z" };
    vi.stubEnv("DESIGN_EXTRACT_PRIVATE_BUCKET", "design-extract-private");
    mocks.from.mockReturnValueOnce(query(null)).mockReturnValueOnce(query(started));
    mocks.rpc.mockResolvedValue({ data: { status: "held" } });
    await settleOperation(privateProject, job);
    await settleOperation(privateProject, started);
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("automatically settles initial layers through the atomic review RPC on sync only", async () => {
    const layer = { id: "layer", width: 20, height: 30, url: project.source_url, composition: { x: 0, y: 0, scale: 1 } };
    const job = { id: "initial", kind: "extract", status: "ready", base_revision: 0, result: { layers: [layer] } };
    const saved = { ...project, revision: 1, manifest: { ...project.manifest, layers: [layer] } };
    mocks.from.mockReturnValueOnce(query([job])).mockReturnValueOnce(query(job)).mockReturnValueOnce(query(saved)).mockReturnValueOnce(query([{ ...job, status: "accepted" }])).mockReturnValueOnce(query({credits:4}));
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    const result = await snapshot(project, true);
    expect(result.project.revision).toBe(1);
    expect(result.job.status).toBe("accepted");
    expect(mocks.rpc).toHaveBeenCalledWith("review_design_extract", expect.objectContaining({ target_job: "initial", expected_revision: 0, accepted: true }));
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("opens a read-only snapshot without touching the provider", async () => {
    mocks.from.mockReturnValue(query([{ id: "pending", status: "queued", request_id: "recorded" }]));
    expect((await snapshot(project)).job.request_id).toBe("recorded");
    expect(mocks.status).not.toHaveBeenCalled(); expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("checks access on sync and advances only the recorded request", async () => {
    const context = { params: Promise.resolve({ id: project.id }) };
    expect((await syncDocument(jsonRequest({}, { token: null }), context)).status).toBe(401);
    const job = { id: "existing", status: "queued", model: "model", request_id: "recorded" };
    mocks.from.mockReturnValueOnce(query(project)).mockReturnValueOnce(query([job])).mockReturnValue(query([]));
    mocks.status.mockResolvedValue({ status: "IN_PROGRESS" });
    const synced = await syncDocument(jsonRequest({}), context);
    expect(synced.status).toBe(200);
    expect((await synced.json()).job.status).toBe("processing");
    expect(mocks.status).toHaveBeenCalledWith("model", { requestId: "recorded", logs: false });
    expect(mocks.submit).not.toHaveBeenCalled();
    mocks.status.mockClear();
    mocks.from.mockReturnValueOnce(query(project)).mockReturnValueOnce(query([job]));
    const opened = await getDocument(jsonRequest({}), context);
    expect(opened.status).toBe(200); expect(opened.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.status).not.toHaveBeenCalled();
  });
  it("requires the current revision and an owned mask before reading assets", async () => {
    await expect(editLayerAsset(project, { revision: 99 })).rejects.toMatchObject({ status: 409 });
    const layer = { id: "layer", url: project.source_url };
    mocks.from.mockReturnValue(query([]));
    await expect(editLayerAsset({ ...project, manifest: { ...project.manifest, layers: [layer] } }, { revision: 0, layerId: "layer", maskUrl: "https://evil.test/mask.png" })).rejects.toMatchObject({ status: 403 });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("saves native mask pixels under the project prefix and commits using revision protection", async () => {
    const source = await sharp({ create: { width: 4, height: 1, channels: 4, background: { r: 21, g: 117, b: 203, alpha: 1 } } }).png().toBuffer();
    const mask = await sharp(Buffer.from([0, 255, 128, 0]), { raw: { width: 4, height: 1, channels: 1 } }).png().toBuffer();
    const item = { id: "layer", url: project.source_url, width: 4, height: 1, composition: { x: 20, y: 30, scale: 2 }, layout: { x: 300, y: 0, scale: 1 } };
    const stored = query({ ...project, revision: 1 });
    mocks.from.mockReturnValueOnce(query([])).mockReturnValueOnce(stored);
    mocks.fetch.mockImplementation(url => Promise.resolve({ buffer: url.endsWith("mask.png") ? mask : source }));
    mocks.upload.mockImplementation((_, key) => Promise.resolve(`https://r2.test/${key}`));
    await editLayerAsset({ ...project, manifest: { ...project.manifest, layers: [item] } }, { action: "mask", layerId: "layer", revision: 0, maskUrl: "https://r2.test/users/admin-1/mask.png" });
    const saved = stored.update.mock.calls[0][0].manifest.layers[0];
    expect(saved).toMatchObject({ width: 2, height: 1, composition: { x: 22, y: 30, scale: 2 }, layout: { x: 301, y: 0, scale: 1 }, acceptedVersion: "mask" });
    expect(saved.url).toContain("users/admin-1/design-extract/project-1/masks/");
    expect(saved.baseVariant.url).toBe(item.url);
    expect(saved.edgeCleanup).toEqual({ defringe: 0, specks: 0 });
    expect(saved.maskedVariant.edgeCleanup).toEqual(saved.edgeCleanup);
    expect(stored.eq).toHaveBeenCalledWith("revision", 0);
    const rgba = await sharp(mocks.upload.mock.calls[0][0]).raw().toBuffer();
    expect([...rgba]).toEqual([21, 117, 203, 255, 21, 117, 203, 128]);
  });
  it("persists optional cleanup and preserves the reversible mask base", async () => {
    const pixels = Buffer.alloc(8 * 8 * 4);
    pixels.set([255, 255, 255, 255], 0);
    for (let y = 3; y < 6; y++) for (let x = 3; x < 6; x++) pixels.set([20, 80, 130, 255], (y * 8 + x) * 4);
    const source = await sharp(pixels, { raw: { width: 8, height: 8, channels: 4 } }).png().toBuffer();
    const mask = await sharp({ create: { width: 8, height: 8, channels: 3, background: "white" } }).png().toBuffer();
    const item = { id: "layer", url: project.source_url, width: 8, height: 8, composition: { x: 20, y: 30, scale: 2 }, layout: { x: 300, y: 0, scale: 1 } };
    const stored = query({ ...project, revision: 1 });
    mocks.from.mockReturnValueOnce(query([])).mockReturnValueOnce(stored);
    mocks.fetch.mockImplementation(url => Promise.resolve({ buffer: url.endsWith("mask.png") ? mask : source }));
    mocks.upload.mockImplementation((_, key) => Promise.resolve(`https://r2.test/${key}`));
    await editLayerAsset({ ...project, manifest: { ...project.manifest, layers: [item] } }, { action: "mask", layerId: "layer", revision: 0, maskUrl: "https://r2.test/users/admin-1/mask.png", edgeCleanup: { defringe: 0, specks: 4 } });
    const saved = stored.update.mock.calls[0][0].manifest.layers[0];
    expect(saved).toMatchObject({ width: 3, height: 3, edgeCleanup: { defringe: 0, specks: 4 }, composition: { x: 26, y: 36, scale: 2 } });
    expect(saved.maskedVariant.edgeCleanup).toEqual(saved.edgeCleanup);
    expect((await sharp(mocks.upload.mock.calls[1][0]).raw().toBuffer())[3]).toBe(255);
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("sends multiple numeric Include/Exclude prompts and rejects invalid points", async () => {
    const points = [{ x: 10, y: 20, label: 1 }, { x: 90, y: 30, label: 0 }];
    mocks.from.mockReturnValueOnce(query(null)).mockReturnValueOnce(query({ id: "segment" })).mockReturnValue(query({ id: "segment", status: "queued" }));
    mocks.submit.mockResolvedValue({ request_id: "recorded-request" });
    await startOperation(project, { kind: "segment", points, idempotencyKey: "selection-1234" });
    expect(mocks.submit.mock.calls[0][0]).toBe("fal-ai/sam2/image");
    expect(mocks.submit.mock.calls[0][1].input.prompts).toEqual(points);
    mocks.from.mockReturnValue(query(null));
    await expect(startOperation(project, { kind: "segment", points: [{ x: 10, y: 10, label: 0 }], idempotencyKey: "invalid-1234" })).rejects.toMatchObject({ status: 400 });
  });
  it.each(["extract", "split"])("uses automatic SAM 2 for %s without manual points or generative prompts", async kind => {
    const layer = { id: "selected", url: "https://r2.test/users/admin-1/layer.png", width: 20, height: 30 };
    const source = kind === "split" ? { ...project, manifest: { ...project.manifest, layers: [layer] } } : project;
    const claim = query({ id: "prompt-job" });
    mocks.from.mockReturnValueOnce(query(null)).mockReturnValueOnce(claim).mockReturnValue(query({ id: "prompt-job", status: "queued" }));
    mocks.submit.mockResolvedValueOnce({ request_id: "provider-request" });
    await startOperation(source, { kind, layerId: kind === "split" ? layer.id : undefined, idempotencyKey: "request-12345", prompt: "Ignore the source and draw a different logo" });
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    const [model, { input }] = mocks.submit.mock.calls[0];
    expect(model).toBe("fal-ai/sam2/auto-segment");
    expect(input).toMatchObject({ image_url: expect.stringContaining("private-signed.test"), output_format: "png", points_per_side: 32, pred_iou_thresh: .88, stability_score_thresh: .95, min_mask_region_area: 100 });
    expect(input).not.toHaveProperty("prompts");
    expect(input).not.toHaveProperty("point_prompts");
    expect(input).not.toHaveProperty("prompt");
    expect(claim.insert).toHaveBeenCalledWith(expect.objectContaining({ input: { ...input, image_url: expect.stringContaining("r2-private://design-extract/"), _desaynclaw: { enhanceLayers: 0, maskExtraction: 1 } }, model }));
    expect(input).not.toHaveProperty("_desaynclaw");
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it("keeps point-guided source-pixel cutouts independent of reconstruction conditioning", async () => {
    mocks.from.mockReturnValueOnce(query(null)).mockReturnValueOnce(query({ id: "cutout-job" })).mockReturnValue(query({ id: "cutout-job", status: "queued" }));
    mocks.submit.mockResolvedValueOnce({ request_id: "provider-request" });
    await startOperation(project, { kind: "segment", point: { x: 12, y: 18 }, idempotencyKey: "request-12345" });
    expect(mocks.submit).toHaveBeenCalledExactlyOnceWith("fal-ai/sam2/image", { input: {
      image_url: "https://private-signed.test/source.png", apply_mask: false, output_format: "png",
      prompts: [{ x: 12, y: 18, label: 1 }],
    } });
  });
  it("returns existing idempotent job without charging or dispatching", async () => {
    const job = { id: "existing", kind: "extract", status: "queued" }; mocks.from.mockReturnValue(query(job));
    expect(await startOperation(project, { kind: "extract", idempotencyKey: "request-12345" })).toEqual(job);
    expect(mocks.submit).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("refuses to reuse an idempotency key for another operation", async () => {
    mocks.from.mockReturnValue(query({ id: "existing", kind: "extract", status: "queued" }));
    await expect(startOperation(project, { kind: "split", layerId: "other", idempotencyKey: "request-12345" })).rejects.toMatchObject({ status: 409 });
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("retains claim on uncertain submission rather than automatically submitting twice", async () => {
    mocks.from.mockReturnValueOnce(query(null)).mockReturnValueOnce(query({ id: "job-1" }));
    mocks.submit.mockRejectedValue(new Error("Network interrupted"));
    await expect(startOperation(project, { kind: "extract", idempotencyKey: "request-12345" })).rejects.toMatchObject({ status: 503 });
    expect(mocks.submit).toHaveBeenCalledTimes(1);
  });
  it("rejects concurrent operation claims", async () => {
    mocks.from.mockReturnValueOnce(query(null)).mockReturnValueOnce(query(null, { code: "23505" }));
    await expect(startOperation(project, { kind: "extract", idempotencyKey: "request-12345" })).rejects.toMatchObject({ status: 409 });
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("persists trimmed RGBA layers before making results ready", async () => {
    const pixels = Buffer.alloc(4 * 4 * 4); pixels.set([255, 0, 0, 255], (1 * 4 + 2) * 4);
    const png = await sharp(pixels, { raw: { width: 4, height: 4, channels: 4 } }).png().toBuffer();
    mocks.status.mockResolvedValue({ status: "COMPLETED" });
    mocks.result.mockResolvedValue({ data: { images: [{ url: "https://fal.media/layer.png", width: 4, height: 4 }] } });
    mocks.fetch.mockResolvedValue({ buffer: png }); mocks.upload.mockResolvedValue("https://r2.test/output.png");
    const q = query({ id: "job-1", status: "ready" }); mocks.from.mockReturnValue(q);
    await settleOperation(project, { id: "job-1", kind: "extract", status: "saving", request_id: "req", model: "model", input: { _desaynclaw: { enhanceLayers: 0 } }, created_at: new Date().toISOString() });
    const ready = q.update.mock.calls.find(([value]) => value.status === "ready")[0];
    expect(ready.result.enhancement).toBeUndefined();
    expect(ready.result.layers[0]).toMatchObject({ width: 1, height: 1, composition: { x: 50, y: 25, scale: 25 } });
    const meta = await sharp(mocks.upload.mock.calls[0][0]).metadata(); expect(meta.hasAlpha).toBe(true);
    expect(mocks.upload.mock.invocationCallOrder[0]).toBeLessThan(q.update.mock.invocationCallOrder.find(order => order > mocks.upload.mock.invocationCallOrder[0]));
  });
  it("saves SAM cutouts using native source RGB with no automatic enhancement", async () => {
    const source = await sharp({ create: { width: 4, height: 4, channels: 4, background: { r: 21, g: 117, b: 203, alpha: 1 } } }).png().toBuffer();
    const maskPixels = Buffer.alloc(16); maskPixels[6] = 128;
    const mask = await sharp(maskPixels, { raw: { width: 4, height: 4, channels: 1 } }).png().toBuffer();
    mocks.status.mockResolvedValue({ status: "COMPLETED" });
    mocks.result.mockResolvedValue({ data: { masks: [{ url: "https://fal.media/mask.png" }] } });
    mocks.fetch.mockImplementation(url => Promise.resolve({ buffer: url.includes("fal.media") ? mask : source }));
    mocks.upload.mockResolvedValue("https://r2.test/cutout.png");
    const q = query({ id: "cutout-job", status: "ready" }); mocks.from.mockReturnValue(q);
    await settleOperation({ ...project, manifest: { ...project.manifest, width: 4, height: 4 } }, { id: "cutout-job", kind: "segment", model: "fal-ai/sam-3/image", status: "saving", request_id: "sam-request", input: { image_url: project.source_url, apply_mask: false }, created_at: new Date().toISOString() });
    const ready = q.update.mock.calls.find(([value]) => value.status === "ready")[0];
    expect(ready.result.enhancement).toBeUndefined();
    expect(ready.result.layers[0]).toMatchObject({ width: 1, height: 1, extractionMethod: "source-pixels", composition: { x: 2, y: 1, scale: 1 } });
    expect([...await sharp(mocks.upload.mock.calls[0][0]).raw().toBuffer()]).toEqual([21, 117, 203, 128]);
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("automatically separates disconnected model elements with aligned PNGs and isolated native masks", async () => {
    const pixels = Buffer.alloc(100 * 80 * 4);
    for (const [left, top] of [[4, 4], [70, 50]]) for (let y = top; y < top + 8; y++) for (let x = left; x < left + 8; x++) pixels.set([180, 40, 210, 128], (y * 100 + x) * 4);
    const png = await sharp(pixels, { raw: { width: 100, height: 80, channels: 4 } }).png().toBuffer();
    mocks.status.mockResolvedValue({ status: "COMPLETED" });
    mocks.result.mockResolvedValue({ data: { images: [{ url: "https://fal.media/elements.png" }] } });
    mocks.fetch.mockResolvedValue({ buffer: png });
    mocks.upload.mockImplementation((_, key) => Promise.resolve(`https://r2.test/${key}`));
    const q = query({ id: "elements-job", status: "ready" }); mocks.from.mockReturnValue(q);
    await settleOperation({ ...project, manifest: { ...project.manifest, width: 100, height: 80 } }, { id: "elements-job", kind: "extract", status: "saving", request_id: "qwen-request", model: "fal-ai/qwen-image-layered", input: { _desaynclaw: { enhanceLayers: 0, separateElements: 1 } }, created_at: new Date().toISOString() });
    const ready = q.update.mock.calls.find(([value]) => value.status === "ready")[0];
    expect(ready.result.layers).toHaveLength(2);
    expect(ready.result.layers[0]).toMatchObject({ name: "Element 1", width: 8, height: 8, nativeFrame: { width: 100, height: 80, left: 4, top: 4 }, composition: { x: 4, y: 4, scale: 1 } });
    expect(ready.result.layers[1]).toMatchObject({ composition: { x: 70, y: 50, scale: 1 } });
    expect(new Set(ready.result.layers.map(item => item.id)).size).toBe(2);
    const nativeBase = await sharp(mocks.upload.mock.calls[1][0]).raw().toBuffer();
    expect(nativeBase[(4 * 100 + 4) * 4 + 3]).toBe(128);
    expect(nativeBase[(50 * 100 + 70) * 4 + 3]).toBe(0);
    expect(ready.result.enhancement).toBeUndefined();
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("saves more than four automatic SAM masks as native aligned layers without another AI request", async () => {
    const source = await sharp({ create: { width: 10, height: 10, channels: 4, background: { r: 21, g: 117, b: 203, alpha: 1 } } }).png().toBuffer();
    const masks = [];
    for (let index = 0; index < 5; index++) {
      const mask = Buffer.alloc(100); mask[index * 20 + index] = 255;
      masks.push(await sharp(mask, { raw: { width: 10, height: 10, channels: 1 } }).png().toBuffer());
    }
    mocks.status.mockResolvedValue({ status: "COMPLETED" });
    mocks.result.mockResolvedValue({ data: { individual_masks: masks.map((_, index) => ({ url: `https://fal.media/mask-${index}.png` })) } });
    mocks.fetch.mockImplementation(url => { const match = /mask-(\d+)\.png/.exec(url); return Promise.resolve({ buffer: match ? masks[Number(match[1])] : source }); });
    mocks.upload.mockImplementation((_, key) => Promise.resolve(`https://r2.test/${key}`));
    const q = query({ id: "automatic-job", status: "ready" }); mocks.from.mockReturnValue(q);
    await settleOperation({ ...project, manifest: { ...project.manifest, width: 10, height: 10 } }, { id: "automatic-job", kind: "extract", status: "saving", request_id: "sam-request", model: "fal-ai/sam2/auto-segment", input: { image_url: project.source_url, _desaynclaw: { enhanceLayers: 0, maskExtraction: 1 } }, created_at: new Date().toISOString() });
    const ready = q.update.mock.calls.find(([value]) => value.status === "ready")[0];
    expect(ready.result.layers).toHaveLength(6);
    expect(ready.result.layers.every(item => item.extractionMethod === "source-pixels")).toBe(true);
    expect(ready.result.layers.at(-1).name).toBe("Remaining artwork");
    expect(ready.result.layers[0]).toMatchObject({ composition: { x: 0, y: 0, scale: 1 }, nativeFrame: { width: 10, height: 10 } });
    expect(ready.result.layers[0].maskSourceUrl).toBe(ready.result.layers[0].maskBaseUrl);
    expect([...await sharp(mocks.upload.mock.calls[0][0]).raw().toBuffer()]).toEqual([21, 117, 203, 255]);
    expect(ready.result.enhancement).toBeUndefined();
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("checkpoints extracted candidates for enhancement before issuing any upscale request", async () => {
    const png = await sharp({ create: { width: 4, height: 4, channels: 4, background: { r: 20, g: 180, b: 80, alpha: .5 } } }).png().toBuffer();
    mocks.status.mockResolvedValue({ status: "COMPLETED" });
    mocks.result.mockResolvedValue({ data: { images: [{ url: "https://fal.media/layer.png" }] } });
    mocks.fetch.mockResolvedValue({ buffer: png }); mocks.upload.mockResolvedValue("https://r2.test/base-layer.png");
    const q = query({ id: "enhance-job", status: "saving" }); mocks.from.mockReturnValue(q);
    await settleOperation(project, { id: "enhance-job", project_id: project.id, kind: "extract", status: "saving", request_id: "qwen-request", model: "model", input: { _desaynclaw: { enhanceLayers: 1 } } });
    const persisted = q.update.mock.calls[0][0];
    expect(persisted).not.toHaveProperty("status", "ready");
    expect(persisted.result).toMatchObject({ layers: [{ width: 4, height: 4 }], enhancement: { version: 1, revision: 0, items: [{ status: "skipped", plan: null }] } });
    expect(q.is).toHaveBeenCalledWith("result", null);
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(mocks.upload.mock.invocationCallOrder[0]).toBeLessThan(q.update.mock.invocationCallOrder[0]);
  });
  it("resumes an enhancement checkpoint without polling or regenerating Qwen", async () => {
    const job = { id: "enhance-job", project_id: project.id, status: "saving", request_id: "qwen-request", result: { layers: [], warnings: [], enhancement: { version: 1, model: "fal-ai/esrgan", revision: 2, items: [] } } };
    const q = query({ ...job, status: "ready" }); mocks.from.mockReturnValue(q);
    expect(await settleOperation(project, job)).toMatchObject({ status: "ready" });
    expect(q.eq).toHaveBeenCalledWith("result->enhancement->>revision", "2");
    expect(mocks.status).not.toHaveBeenCalled();expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("keeps real model size rounding as a review warning instead of discarding valid layers", async () => {
    const png = await sharp({ create: { width: 480, height: 832, channels: 4, background: { r: 20, g: 180, b: 80, alpha: .5 } } }).png().toBuffer();
    mocks.status.mockResolvedValue({ status: "COMPLETED" });
    mocks.result.mockResolvedValue({ data: { images: [{ url: "https://fal.media/layer.png" }] } });
    mocks.fetch.mockResolvedValue({ buffer: png }); mocks.upload.mockResolvedValue("https://r2.test/output.png");
    const q = query({ id: "rounded-job", status: "ready" }); mocks.from.mockReturnValue(q);
    await settleOperation({ ...project, manifest: { ...project.manifest, width: 796, height: 1327 } }, { id: "rounded-job", kind: "extract", status: "saving", request_id: "req", model: "model", created_at: new Date().toISOString() });
    const ready = q.update.mock.calls.find(([value]) => value.status === "ready")[0];
    expect(ready.result).toMatchObject({ nativeWidth: 480, nativeHeight: 832 });
    expect(ready.result.layers[0]).toMatchObject({ width: 480, height: 832, composition: { y: 0, scale: 1327 / 832 } });
    expect(ready.result.layers[0].composition.x).toBeCloseTo((796 - 480 * (1327 / 832)) / 2);
    expect(ready.result.warnings).toEqual([expect.stringContaining("without stretching")]);
    expect(q.update.mock.calls.some(([value]) => value.status === "failed")).toBe(false);
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("recovers a completed failed result without submitting another generation", async () => {
    const png = await sharp({ create: { width: 4, height: 4, channels: 4, background: { r: 10, g: 20, b: 30, alpha: .5 } } }).png().toBuffer();
    const failed = { id: "failed-job", project_id: project.id, user_id: project.user_id, status: "failed", kind: "extract", base_revision: 0, request_id: "existing-request", model: "model", created_at: new Date().toISOString() };
    const lookup = query(failed);
    mocks.from.mockReturnValueOnce(lookup).mockReturnValueOnce(query({ ...failed, status: "saving" })).mockReturnValue(query({ id: failed.id, status: "ready" }));
    mocks.status.mockResolvedValue({ status: "COMPLETED" }); mocks.result.mockResolvedValue({ data: { images: [{ url: "https://fal.media/layer.png" }] } });
    mocks.fetch.mockResolvedValue({ buffer: png }); mocks.upload.mockResolvedValue("https://r2.test/recovered.png");
    expect(await recoverOperation(project, failed.id)).toMatchObject({ status: "ready" });
    expect(lookup.eq).toHaveBeenCalledWith("user_id", project.user_id);
    expect(mocks.result).toHaveBeenCalledWith("model", { requestId: "existing-request" });
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("does not recover output into a project changed since the request", async () => {
    mocks.from.mockReturnValue(query({ id: "failed", request_id: "req", base_revision: 0 }));
    await expect(recoverOperation({ ...project, revision: 1 }, "failed")).rejects.toMatchObject({ status: 409 });
    expect(mocks.status).not.toHaveBeenCalled(); expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("keeps incomplete provider results failed instead of submitting again", async () => {
    mocks.from.mockReturnValue(query({ id: "failed", request_id: "req", base_revision: 0, model: "model" }));
    mocks.status.mockResolvedValue({ status: "IN_PROGRESS" });
    await expect(recoverOperation(project, "failed")).rejects.toMatchObject({ status: 409 });
    expect(mocks.result).not.toHaveBeenCalled(); expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("retains the specific transparency failure instead of a generic output error", async () => {
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: "white" } }).png().toBuffer();
    mocks.status.mockResolvedValue({ status: "COMPLETED" }); mocks.result.mockResolvedValue({ data: { images: [{ url: "https://fal.media/layer.png" }] } });
    mocks.fetch.mockResolvedValue({ buffer: png });
    const q = query({ status: "failed" }); mocks.from.mockReturnValue(q);
    await settleOperation(project, { id: "opaque", status: "saving", request_id: "req", model: "model" });
    expect(q.update).toHaveBeenCalledWith(expect.objectContaining({ status: "failed", error: expect.stringContaining("without transparency") }));
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it("keeps existing layers on transient provider errors", async () => {
    mocks.status.mockRejectedValue(new Error("Temporary outage"));
    await expect(settleOperation(project, { id: "job", status: "queued", request_id: "req" })).rejects.toThrow("Temporary outage");
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("exposes saving before downloading provider assets", async () => {
    mocks.status.mockResolvedValue({ status: "COMPLETED" }); mocks.from.mockReturnValue(query(null));
    expect((await settleOperation(project, { id: "job", status: "queued", request_id: "request" })).status).toBe("saving");
    expect(mocks.result).not.toHaveBeenCalled(); expect(mocks.upload).not.toHaveBeenCalled();
  });
  it("does not dispatch an out-of-bounds segmentation point", async () => {
    mocks.from.mockReturnValue(query(null));
    const layer = { id: "selected", width: 20, height: 30, url: "https://r2.test/layer.png" };
    await expect(startOperation({ ...project, manifest: { ...project.manifest, layers: [layer] } }, { kind: "segment", layerId: "selected", point: { x: 20, y: 0 }, idempotencyKey: "request-12345" })).rejects.toMatchObject({ status: 400 });
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("accepts through an atomic revision-checked RPC", async () => {
    mocks.from.mockReturnValue(query({ id: "job", status: "ready", kind: "extract", result: { layers: [] } })); mocks.rpc.mockResolvedValue({ data: null });
    await reviewOperation(project, "job", true);
    expect(mocks.rpc).toHaveBeenCalledWith("review_design_extract", expect.objectContaining({ target_user: "admin-1", expected_revision: 0, accepted: true }));
  });
});
describe("retention", () => {
  it("renames manager cards without changing layer content", async () => {
    const q = query(project); mocks.from.mockReturnValue(q);
    await renameDesignProject(project, "  Jersey layers  ");
    expect(q.update).toHaveBeenCalledWith(expect.objectContaining({ manifest: { ...project.manifest, name: "Jersey layers" }, revision: 1 }));
    await expect(renameDesignProject(project, " ")).rejects.toMatchObject({ status: 400 });
  });
  it("blocks deletion during processing and restores the original expiry", async () => {
    const restore = query(null);
    mocks.from.mockReturnValueOnce(query(project)).mockReturnValueOnce(query([{ id: "active-job" }])).mockReturnValueOnce(restore);
    await expect(deleteDesignProject(project)).rejects.toMatchObject({ status: 409 });
    expect(deleteR2Prefix).not.toHaveBeenCalled();
    expect(restore.update).toHaveBeenCalledWith({ expires_at: project.expires_at });
  });
  it("deletes the full owned prefix before deleting an expired project record", async () => {
    const deleted = query(null);
    mocks.from.mockReturnValueOnce(query([project])).mockReturnValueOnce(query([])).mockReturnValueOnce(query([])).mockReturnValueOnce(deleted).mockReturnValueOnce(query([])).mockReturnValueOnce(query([]));
    await maintainDesignExtract();
    expect(deleteR2Prefix).toHaveBeenCalledWith("users/admin-1/design-extract/project-1/", { allowedPrefixes: ["users/admin-1/design-extract/project-1/"] });
    expect(deleteR2Prefix.mock.invocationCallOrder[0]).toBeLessThan(deleted.delete.mock.invocationCallOrder[0]);
  });
  it("retains the project row if storage deletion fails so cleanup can retry", async () => {
    mocks.from.mockReturnValue(query([project])); deleteR2Prefix.mockRejectedValueOnce(new Error("Storage unavailable"));
    await expect(maintainDesignExtract()).rejects.toThrow("Storage unavailable"); expect(mocks.from).toHaveBeenCalledTimes(1);
  });
  it("refunds a failed paid job before deleting its expired project", async () => {
    const job = { id: "paid-failed", user_id: project.user_id, billing_state: "held", status: "failed" };
    const deleted = query(null);
    mocks.from.mockReturnValueOnce(query([project])).mockReturnValueOnce(query([job])).mockReturnValueOnce(query([])).mockReturnValueOnce(deleted).mockReturnValueOnce(query([])).mockReturnValueOnce(query([]));
    mocks.rpc.mockResolvedValue({ data: { status: "refunded" } });
    await maintainDesignExtract();
    expect(mocks.rpc).toHaveBeenCalledWith("settle_design_extract_billing", { target_user: project.user_id, target_job: job.id });
    expect(mocks.rpc.mock.invocationCallOrder[0]).toBeLessThan(deleted.delete.mock.invocationCallOrder[0]);
  });
  it("retains financial evidence if refund confirmation is interrupted", async () => {
    const job = { id: "paid-failed", user_id: project.user_id, billing_state: "held", status: "failed" };
    const jobs = query([job]);
    mocks.from.mockReturnValueOnce(query([project])).mockReturnValueOnce(jobs);
    mocks.rpc.mockResolvedValue({ error: { code: "timeout" } });
    await expect(maintainDesignExtract()).rejects.toMatchObject({ status: 503 });
    expect(jobs.delete).not.toHaveBeenCalled();
  });
});

it.each([false,true])('bounds legacy job lifetime and keeps available output: %s',async usable=>{
 const job={id:'deadline',project_id:project.id,user_id:project.user_id,status:'processing',processor:'legacy',created_at:new Date(Date.now()-46*60000).toISOString(),request_id:'recorded',billing_state:'held',...(usable&&{result:{layers:[{id:'saved'}]}})};
 const updated={...job,status:usable?'ready':'failed'};const writes=query(updated);mocks.from.mockReturnValue(writes);mocks.rpc.mockResolvedValue({data:{status:usable?'settled':'refunded'}});
 expect(await settleOperation(project,job)).toMatchObject({status:updated.status,billing_state:usable?'settled':'refunded'});
 expect(writes.update).toHaveBeenCalledWith(expect.objectContaining({status:updated.status}));expect(mocks.status).not.toHaveBeenCalled();expect(mocks.submit).not.toHaveBeenCalled();
});
it('never resubmits an old uncertain provider claim when the deadline expires',async()=>{
 const job={id:'uncertain',status:'submitting',processor:'legacy',created_at:new Date(Date.now()-46*60000).toISOString(),dispatch_started_at:new Date().toISOString(),billing_state:'held'};mocks.rpc.mockResolvedValue({data:{status:'held'}});
 expect(await settleOperation(project,job)).toMatchObject({status:'submitting',billing_state:'held'});expect(mocks.from).not.toHaveBeenCalled();expect(mocks.submit).not.toHaveBeenCalled();
});

it.each(['segment','split'])('keeps %s output aligned with a moved and scaled parent',async kind=>{
 const source=await sharp({create:{width:4,height:4,channels:4,background:{r:21,g:117,b:203,alpha:1}}}).png().toBuffer();
 const coverage=Buffer.alloc(16);coverage[6]=255;const mask=await sharp(coverage,{raw:{width:4,height:4,channels:1}}).png().toBuffer();
 const parent={id:'parent',url:project.source_url,width:4,height:4,composition:{x:70,y:90,scale:2},layout:{x:300,y:0,scale:1}};
 mocks.status.mockResolvedValue({status:'COMPLETED'});mocks.result.mockResolvedValue({data:{masks:[{url:'https://fal.media/mask.png'}],individual_masks:[{url:'https://fal.media/mask.png'}]}});
 mocks.fetch.mockImplementation(url=>Promise.resolve({buffer:url.includes('fal.media')?mask:source}));mocks.upload.mockResolvedValue('https://r2.test/element.png');const q=query({id:'parent-cut',status:'ready'});mocks.from.mockReturnValue(q);
 await settleOperation({...project,manifest:{...project.manifest,layers:[parent]}},{id:'parent-cut',kind,layer_id:'parent',model:kind==='segment'?'fal-ai/sam2/image':'fal-ai/sam2/auto-segment',status:'saving',request_id:'existing-request',input:{image_url:project.source_url,apply_mask:false},created_at:new Date().toISOString()});
 const saved=q.update.mock.calls.find(([value])=>value.status==='ready')[0];
 expect(saved.result.layers[0]).toMatchObject({width:1,height:1,composition:{x:74,y:92,scale:2}});
 expect(mocks.submit).not.toHaveBeenCalled();
});
