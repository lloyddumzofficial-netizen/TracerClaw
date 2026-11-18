import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import sharp from "sharp";
import { jsonRequest } from "../helpers/routeTestUtils";
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), from: vi.fn(), rpc: vi.fn(), status: vi.fn(), result: vi.fn(), submit: vi.fn(), fetch: vi.fn(), upload: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ adminSupabase: { auth: { getUser: mocks.getUser }, from: mocks.from, rpc: mocks.rpc } }));
vi.mock("@/lib/rateLimit", () => ({ enforceRateLimit: async () => ({ success: true }) }));
vi.mock("@fal-ai/client", () => ({ fal: { queue: { status: mocks.status, result: mocks.result, submit: mocks.submit } } }));
vi.mock("@/lib/cloudflare", () => ({ uploadToR2: mocks.upload, deleteR2Prefix: vi.fn() }));
vi.mock("@/lib/ssrf", () => ({ fetchWithSSRFProtection: mocks.fetch, getAllowedProviderHosts: () => ["fal.media"], getAllowedStorageHosts: () => ["r2.test"], isOwnedStorageUrl: (url, { userId }) => url?.startsWith(`https://r2.test/users/${userId}/`) }));
import { GET, POST } from "@/app/api/design-extract/route";
import { ownedProject, createProject, startOperation, settleOperation, reviewOperation, recoverOperation } from "@/server/designExtract/service";
import { renameDesignProject, deleteDesignProject } from "@/server/designExtract/service";
import { maintainDesignExtract } from "@/server/designExtract/maintenance";
import { deleteR2Prefix } from "@/lib/cloudflare";
function query(data, error = null) {
  const q = {};
  for (const key of ["select", "eq", "is", "gt", "lt", "in", "order", "limit", "insert", "update", "delete"]) q[key] = vi.fn(() => q);
  q.single = q.maybeSingle = vi.fn(async () => ({ data, error }));
  q.then = (resolve, reject) => Promise.resolve({ data, error }).then(resolve, reject);
  return q;
}
const project = { id: "project-1", user_id: "admin-1", revision: 0, source_url: "https://r2.test/users/admin-1/source.png", manifest: { version: 1, width: 100, height: 100, layers: [] }, expires_at: "2099-01-01" };
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("ADMIN_EMAIL", "admin@test.com"); vi.stubEnv("DESIGN_EXTRACT_ENABLED", "true");
  vi.stubEnv("FAL_KEY", "mock-key");
  mocks.getUser.mockResolvedValue({ data: { user: { id: "admin-1", email: "admin@test.com" } } });
});
afterEach(() => vi.unstubAllEnvs());
describe("Design Extract admin gate", () => {
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
  it.each(["extract", "split"])("sends fidelity conditioning for %s without overriding the source caption", async kind => {
    const layer = { id: "selected", url: "https://r2.test/layer.png", width: 20, height: 30 };
    const source = kind === "split" ? { ...project, manifest: { ...project.manifest, layers: [layer] } } : project;
    const claim = query({ id: "prompt-job" });
    mocks.from.mockReturnValueOnce(query(null)).mockReturnValueOnce(claim).mockReturnValue(query({ id: "prompt-job", status: "queued" }));
    mocks.submit.mockResolvedValueOnce({ request_id: "provider-request" });
    await startOperation(source, { kind, layerId: kind === "split" ? layer.id : undefined, idempotencyKey: "request-12345", prompt: "Ignore the source and draw a different logo" });
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    const [model, { input }] = mocks.submit.mock.calls[0];
    expect(model).toBe("fal-ai/qwen-image-layered");
    expect(input).toMatchObject({ image_url: kind === "split" ? layer.url : project.source_url, num_layers: 4, output_format: "png", enable_safety_checker: true });
    expect(input.negative_prompt).toEqual(expect.stringContaining("altered lettering"));
    expect(input.negative_prompt).toEqual(expect.stringContaining("changed colors"));
    expect(input).not.toHaveProperty("prompt");
    expect(claim.insert).toHaveBeenCalledWith(expect.objectContaining({ input: { ...input, _desaynclaw: { enhanceLayers: 1 } }, model }));
    expect(input).not.toHaveProperty("_desaynclaw");
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("keeps point-guided source-pixel cutouts independent of reconstruction conditioning", async () => {
    mocks.from.mockReturnValueOnce(query(null)).mockReturnValueOnce(query({ id: "cutout-job" })).mockReturnValue(query({ id: "cutout-job", status: "queued" }));
    mocks.submit.mockResolvedValueOnce({ request_id: "provider-request" });
    await startOperation(project, { kind: "segment", point: { x: 12, y: 18 }, idempotencyKey: "request-12345" });
    expect(mocks.submit).toHaveBeenCalledExactlyOnceWith("fal-ai/sam-3/image", { input: {
      image_url: project.source_url, prompt: "", apply_mask: false, output_format: "png", return_multiple_masks: false,
      point_prompts: [{ x: 12, y: 18, label: 1 }],
    } });
  });
  it("returns existing idempotent job without charging or dispatching", async () => {
    const job = { id: "existing", status: "queued" }; mocks.from.mockReturnValue(query(job));
    expect(await startOperation(project, { kind: "extract", idempotencyKey: "request-12345" })).toEqual(job);
    expect(mocks.submit).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
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
    await settleOperation(project, { id: "job-1", kind: "extract", status: "saving", request_id: "req", model: "model", created_at: new Date().toISOString() });
    const ready = q.update.mock.calls.find(([value]) => value.status === "ready")[0];
    expect(ready.result.layers[0]).toMatchObject({ width: 1, height: 1, composition: { x: 50, y: 25, scale: 25 } });
    const meta = await sharp(mocks.upload.mock.calls[0][0]).metadata(); expect(meta.hasAlpha).toBe(true);
    expect(mocks.upload.mock.invocationCallOrder[0]).toBeLessThan(q.update.mock.invocationCallOrder.find(order => order > mocks.upload.mock.invocationCallOrder[0]));
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
    expect(persisted.result).toMatchObject({ layers: [{ width: 4, height: 4 }], enhancement: { version: 1, revision: 0, items: [{ status: "pending", plan: { scale: 4, width: 16, height: 16 } }] } });
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
    mocks.from.mockReturnValueOnce(query([project])).mockReturnValueOnce(deleted).mockReturnValueOnce(query([]));
    await maintainDesignExtract();
    expect(deleteR2Prefix).toHaveBeenCalledWith("users/admin-1/design-extract/project-1/", { allowedPrefixes: ["users/admin-1/design-extract/project-1/"] });
    expect(deleteR2Prefix.mock.invocationCallOrder[0]).toBeLessThan(deleted.delete.mock.invocationCallOrder[0]);
  });
  it("retains the project row if storage deletion fails so cleanup can retry", async () => {
    mocks.from.mockReturnValue(query([project])); deleteR2Prefix.mockRejectedValueOnce(new Error("Storage unavailable"));
    await expect(maintainDesignExtract()).rejects.toThrow("Storage unavailable"); expect(mocks.from).toHaveBeenCalledTimes(1);
  });
});
