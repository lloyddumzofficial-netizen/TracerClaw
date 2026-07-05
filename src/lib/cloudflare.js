import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

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
  try {
    // Extract the file key from the URL (everything after the publicUrl)
    const fileKey = fileUrl.replace(`${publicUrl}/`, '');
    
    const { DeleteObjectCommand } = require("@aws-sdk/client-s3");
    const command = new DeleteObjectCommand({
      Bucket: bucketName,
      Key: fileKey,
    });
    
    await s3Client.send(command);
    console.log(`Deleted ${fileKey} from R2`);
  } catch (error) {
    console.error("Error deleting from R2:", error);
  }
}
