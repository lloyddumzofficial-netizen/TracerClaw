import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

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

export async function getUploadUrl(fileName, contentType) {
  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: fileName,
    ContentType: contentType,
  });

  // URL valid for 5 minutes
  const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 300 });
  
  return {
    uploadUrl: signedUrl,
    publicUrl: `${publicUrl}/${fileName}`,
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

export async function deleteFromR2(fileUrl) {
  if (!fileUrl) return;
  // Extract the file key from the URL (everything after the publicUrl prefix)
  const fileKey = fileUrl.replace(`${publicUrl}/`, '');
  
  // Guard: if key still looks like a full URL, extraction failed
  if (fileKey.startsWith('http')) {
    console.error(`[R2 Delete] Key extraction failed for URL: ${fileUrl}. publicUrl env may be missing or mismatched.`);
    return;
  }

  console.log(`[R2 Delete] Deleting key: ${fileKey}`);
  const command = new DeleteObjectCommand({
    Bucket: bucketName,
    Key: fileKey,
  });
  await s3Client.send(command); // Let errors propagate so callers can handle them
  console.log(`[R2 Delete] ✅ Deleted: ${fileKey}`);
}
