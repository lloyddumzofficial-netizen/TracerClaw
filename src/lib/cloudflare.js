import { S3Client, PutObjectCommand, DeleteObjectCommand, DeleteObjectsCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { logger } from "@/lib/logger";

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const accessKeyId = process.env.CLOUDFLARE_ACCESS_KEY_ID;
const secretAccessKey = process.env.CLOUDFLARE_SECRET_ACCESS_KEY;
export const bucketName = process.env.CLOUDFLARE_BUCKET_NAME;
export const publicUrl = process.env.CLOUDFLARE_PUBLIC_URL;

export const s3Client = new S3Client({
  region: "auto",
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId,
    secretAccessKey,
  },
});

export async function getUploadUrl(fileName, contentType, options = {}) {
  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: fileName,
    ContentType: contentType,
    ...(options.fileSize ? { ContentLength: options.fileSize } : {}),
  });

  // URL valid for 5 minutes
  const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 300 });
  
  return {
    uploadUrl: signedUrl,
    publicUrl: `${publicUrl}/${fileName}`,
    ...(options.maxBytes ? { maxBytes: options.maxBytes } : {}),
  };
}

export async function uploadToR2(buffer, fileName, contentType) {
  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: fileName,
    Body: buffer,
    ContentType: contentType,
  });

  await s3Client.send(command);
  
  return `${publicUrl}/${fileName}`;
}

export function getR2KeyFromUrl(fileUrl) {
  if (!fileUrl) return;
  try {
    const parsedUrl = new URL(fileUrl);
    const parsedPublicUrl = new URL(publicUrl);
    if (parsedUrl.origin !== parsedPublicUrl.origin) {
      return null;
    }
    const publicPath = parsedPublicUrl.pathname.replace(/\/$/, '');
    if (publicPath && !parsedUrl.pathname.startsWith(`${publicPath}/`)) {
      return null;
    }
    const key = decodeURIComponent(parsedUrl.pathname.slice(publicPath.length).replace(/^\//, ''));
    return key && !key.includes('..') ? key : null;
  } catch {
    return null;
  }
}

export async function deleteFromR2(fileUrl, options = {}) {
  const fileKey = getR2KeyFromUrl(fileUrl);
  if (!fileKey) {
    console.error(`[R2 Delete] Refusing to delete URL outside configured R2 public URL: ${fileUrl}`);
    return;
  }

  if (options.allowedPrefixes?.length && !options.allowedPrefixes.some((prefix) => fileKey.startsWith(prefix))) {
    console.error(`[R2 Delete] Refusing to delete key outside allowed prefixes: ${fileKey}`);
    return;
  }

  logger.debug("[R2 Delete] Deleting key", { fileKey });
  const command = new DeleteObjectCommand({
    Bucket: bucketName,
    Key: fileKey,
  });
  await s3Client.send(command); // Let errors propagate so callers can handle them
  logger.info("[R2 Delete] Deleted key", { fileKey });
}

export async function deleteR2Prefix(prefix, options = {}) {
  const normalized = String(prefix || "").replace(/^\/+/, "");
  const allowedPrefixes = options.allowedPrefixes || [];
  if (!normalized || normalized.length < 24 || normalized.includes("..") || !normalized.endsWith("/")) {
    throw new Error("Refusing to delete an invalid R2 prefix.");
  }
  if (!allowedPrefixes.some(allowed => normalized.startsWith(allowed))) {
    throw new Error("Refusing to delete an R2 prefix outside the approved project path.");
  }

  let continuationToken;
  let deleted = 0;
  do {
    const listed = await s3Client.send(new ListObjectsV2Command({
      Bucket: bucketName,
      Prefix: normalized,
      ContinuationToken: continuationToken,
      MaxKeys: 500,
    }));
    const objects = (listed.Contents || []).map(item => ({ Key: item.Key })).filter(item => item.Key);
    if (objects.length) {
      const result = await s3Client.send(new DeleteObjectsCommand({
        Bucket: bucketName,
        Delete: { Objects: objects, Quiet: true },
      }));
      if (result.Errors?.length) throw new Error(`R2 could not delete ${result.Errors.length} project objects.`);
      deleted += objects.length;
    }
    continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
  } while (continuationToken);
  return deleted;
}
