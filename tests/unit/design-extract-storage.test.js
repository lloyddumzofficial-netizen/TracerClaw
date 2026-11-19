import { beforeEach, afterEach, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({ send: vi.fn(), sign: vi.fn(), upload: vi.fn(), remove: vi.fn() }));
vi.mock("@/lib/cloudflare", () => ({ bucketName: "public-bucket", s3Client: { send: mocks.send }, uploadToR2: mocks.upload, deleteR2Prefix: mocks.remove }));
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: mocks.sign }));
import { privateDesignBucket, privateDesignKey, ownsPrivateDesignAsset, uploadDesignAsset, designUploadUrl, readPrivateDesignAsset, designAssetUrl, serializeDesignData, deleteDesignPrefix } from "@/server/designExtract/storage";
import { designResponse } from "@/server/designExtract/response";
const ref = "r2-private://design-extract/users/owner/design-extract/project/source.png";
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("DESIGN_EXTRACT_PRIVATE_BUCKET", "design-extract-private"); mocks.sign.mockResolvedValue("https://signed.invalid/object?expires=300"); });
afterEach(() => vi.unstubAllEnvs());
it("requires a separate configured bucket and rejects path traversal and foreign owners", () => {
  expect(privateDesignBucket()).toBe("design-extract-private");
  expect(privateDesignKey(ref)).toBe("users/owner/design-extract/project/source.png");
  expect(ownsPrivateDesignAsset(ref, "owner")).toBe(true); expect(ownsPrivateDesignAsset(ref, "other")).toBe(false);
  for (const suffix of ["../other/image.png", "%2e%2e/other/image.png", "a//image.png", "a.png?signature=fake"]) expect(() => privateDesignKey("r2-private://design-extract/users/owner/" + suffix)).toThrow();
  vi.stubEnv("DESIGN_EXTRACT_PRIVATE_BUCKET", "public-bucket"); expect(() => privateDesignBucket()).toThrow("separate");
});
it("writes project images only to the private bucket and returns an opaque reference", async () => {
  const key = privateDesignKey(ref);
  expect(await uploadDesignAsset(Buffer.from("image"), key, "image/png")).toBe(ref);
  expect(mocks.send.mock.calls[0][0].input).toMatchObject({ Bucket: "design-extract-private", Key: key, CacheControl: "private, no-store" });
  expect(mocks.upload).not.toHaveBeenCalled();
});
it("uses a create-only R2 write for durable SVG conversion claims", async () => {
  await uploadDesignAsset(Buffer.from('{}'), 'users/owner/design-extract/project/svg/claim.json', 'application/json', { ifAbsent: true });
  expect(mocks.send.mock.calls[0][0].input).toMatchObject({ Bucket: 'design-extract-private', IfNoneMatch: '*' });
});
it("uses owned temporary upload keys and short-lived GET links", async () => {
  const key = "staging/design-extract/owner/unique.png";
  expect((await designUploadUrl(key, "image/png", 123)).publicUrl).toBe("r2-private://design-extract/" + key);
  expect(mocks.sign.mock.calls[0][1].input).toMatchObject({ Bucket: "design-extract-private", Key: key, ContentLength: 123 });
  expect(mocks.sign.mock.calls[0][2]).toEqual({ expiresIn: 300 });
  await designAssetUrl(ref); expect(mocks.sign.mock.calls[1][2]).toEqual({ expiresIn: 300 });
});
it("caps private reads using both metadata and actual streamed bytes", async () => {
  mocks.send.mockResolvedValueOnce({ ContentLength: 9999, Body: [] });
  await expect(readPrivateDesignAsset(ref, 10)).rejects.toThrow("allowed size");
  mocks.send.mockResolvedValueOnce({ Body: [Buffer.alloc(6), Buffer.alloc(6)] });
  await expect(readPrivateDesignAsset(ref, 10)).rejects.toThrow("allowed size");
  mocks.send.mockResolvedValueOnce({ ContentLength: 3, Body: [Buffer.from("abc")] });
  expect((await readPrivateDesignAsset(ref, 10)).toString()).toBe("abc");
});
it("signs repeated private assets once per response and strips provider internals", async () => {
  const response = await designResponse({ project: { source_url: ref }, job: { id: "job", input: { secret: "server-only" }, request_id: "provider-private", model: "internal-model", result: { layers: [{ url: ref }], enhancement: { items: [{ requestId: "enhancement-private", status: "queued" }] } } } });
  const text = await response.text();
  expect(text).not.toContain("server-only"); expect(text).not.toContain("provider-private"); expect(text).not.toContain("enhancement-private"); expect(text).not.toContain("r2-private:");
  expect(JSON.parse(text).job.canRecover).toBe(true);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(mocks.sign).toHaveBeenCalledTimes(1);
  expect(await serializeDesignData({ width: 10, name: "Artwork" })).toEqual({ width: 10, name: "Artwork" });
});
it("rejects unapproved cleanup paths before making a storage mutation", async () => {
  await expect(deleteDesignPrefix("users/other/", { allowedPrefixes: [] })).rejects.toThrow("Unapproved");
  expect(mocks.remove).not.toHaveBeenCalled(); expect(mocks.send).not.toHaveBeenCalled();
});
it("fails closed before any public write or signature when private storage is absent", async () => {
  vi.stubEnv("DESIGN_EXTRACT_PRIVATE_BUCKET", "");
  await expect(uploadDesignAsset(Buffer.from("image"), "users/owner/design-extract/project/a.png", "image/png")).rejects.toMatchObject({status:503});
  await expect(designUploadUrl("staging/design-extract/owner/upload.png", "image/png", 123)).rejects.toMatchObject({status:503});
  expect(mocks.upload).not.toHaveBeenCalled(); expect(mocks.sign).not.toHaveBeenCalled(); expect(mocks.send).not.toHaveBeenCalled();
  expect(await designAssetUrl("https://legacy.test/asset.png")).toBe("https://legacy.test/asset.png");
});
