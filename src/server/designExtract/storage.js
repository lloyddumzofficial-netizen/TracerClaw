import { GetObjectCommand, PutObjectCommand, DeleteObjectsCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { validDesignPrivateBucket } from "@/lib/designExtractReadiness";
import * as cloudflare from "@/lib/cloudflare";
import { DESIGN_ASSET_MAX_BYTES } from "@/lib/designExtractImagePolicy";

const scheme = "r2-private://design-extract/";
export function privateDesignBucket() {
  const bucket = process.env.DESIGN_EXTRACT_PRIVATE_BUCKET;
  if (!bucket) return null;
  if (!validDesignPrivateBucket(bucket, cloudflare.bucketName)) throw Object.assign(new Error("Design Extract requires a separate private bucket"), { status: 503, designExtractError: true });
  return bucket;
}
export function privateDesignKey(url) {
  if (typeof url !== "string" || !url.startsWith(scheme)) return null;
  const key = url.slice(scheme.length);
  if (!key || !/^[a-zA-Z0-9_./-]+$/.test(key) || key.split("/").some(part => !part || part === "." || part === "..")) throw new Error("Invalid private asset reference");
  if (!key.startsWith("users/") && !key.startsWith("staging/design-extract/")) throw new Error("Invalid private asset prefix");
  return key;
}
export function ownsPrivateDesignAsset(url, userId) {
  try {
    const key = privateDesignKey(url);
    return Boolean(key && (key.startsWith(`users/${userId}/design-extract/`) || key.startsWith(`staging/design-extract/${userId}/`)));
  } catch { return false; }
}
export function requirePrivateDesignStorage() {
  const bucket = privateDesignBucket();
  if (!bucket) throw Object.assign(new Error("Private Design Extract storage is not configured. Please try again after storage setup."), { status: 503, designExtractError: true });
  return bucket;
}
const bucketRequired = requirePrivateDesignStorage;
export async function uploadDesignAsset(bytes, key, contentType, { ifAbsent = false } = {}) {
  const bucket = bucketRequired();
  privateDesignKey(scheme + key);
  if (!bytes?.byteLength || bytes.byteLength > DESIGN_ASSET_MAX_BYTES) throw Object.assign(new Error("Design asset exceeds safe processing limits"), { status: 413, designExtractError: true });
  await cloudflare.s3Client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: contentType, CacheControl: "private, no-store", ...(ifAbsent && { IfNoneMatch: "*" }) }));
  return scheme + key;
}
export async function designUploadUrl(key, contentType, fileSize) {
  privateDesignKey(scheme + key);
  const uploadUrl = await getSignedUrl(cloudflare.s3Client, new PutObjectCommand({ Bucket: bucketRequired(), Key: key, ContentType: contentType, ContentLength: fileSize }), { expiresIn: 300 });
  return { uploadUrl, publicUrl: scheme + key };
}
export async function readPrivateDesignAsset(url, maxBytes) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > DESIGN_ASSET_MAX_BYTES) throw new Error("Invalid private asset read limit");
  const key = privateDesignKey(url);
  if (!key) throw new Error("Expected a private asset");
  const response = await cloudflare.s3Client.send(new GetObjectCommand({ Bucket: bucketRequired(), Key: key }));
  if (!response.Body || response.ContentLength > maxBytes) {
    response.Body?.destroy?.();
    throw new Error("Private asset exceeds the allowed size");
  }
  const chunks = []; let length = 0;
  try {
    for await (const chunk of response.Body) {
      length += chunk.length;
      if (length > maxBytes) throw new Error("Private asset exceeds the allowed size");
      chunks.push(chunk);
    }
  } finally { response.Body.destroy?.(); }
  return Buffer.concat(chunks);
}
export async function designAssetUrl(url, expiresIn = 300) {
  const key = privateDesignKey(url);
  if (!key) return url;
  return getSignedUrl(cloudflare.s3Client, new GetObjectCommand({ Bucket: bucketRequired(), Key: key }), { expiresIn });
}
export async function designProviderInput(input) {
  return { ...input, image_url: await designAssetUrl(input.image_url, 3600) };
}
export async function serializeDesignData(value, memo = new Map()) {
  if (typeof value === "string" && value.startsWith(scheme)) {
    if (!memo.has(value)) memo.set(value, designAssetUrl(value));
    return memo.get(value);
  }
  if (Array.isArray(value)) return Promise.all(value.map(item => serializeDesignData(item, memo)));
  if (value && typeof value === "object") return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, item]) => [key, await serializeDesignData(item, memo)])));
  return value;
}
export async function deleteDesignPrefix(prefix, options) {
  if (!prefix.endsWith("/") || prefix.includes("..") || !options?.allowedPrefixes?.includes(prefix) || !/^users\/[^/]+\/design-extract\/[^/]+\/$/.test(prefix)) throw new Error("Unapproved private project prefix");
  await cloudflare.deleteR2Prefix(prefix, options);
  if (!privateDesignBucket()) return;
  let token;
  do {
    const page = await cloudflare.s3Client.send(new ListObjectsV2Command({ Bucket: bucketRequired(), Prefix: prefix, ContinuationToken: token, MaxKeys: 500 }));
    const objects = (page.Contents || []).filter(item => item.Key?.startsWith(prefix)).map(item => ({ Key: item.Key }));
    if (objects.length) {
      const result = await cloudflare.s3Client.send(new DeleteObjectsCommand({ Bucket: bucketRequired(), Delete: { Objects: objects, Quiet: true } }));
      if (result.Errors?.length) throw new Error("Private project cleanup failed");
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
}
