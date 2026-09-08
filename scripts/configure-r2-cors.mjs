import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { S3Client, PutBucketCorsCommand } from "@aws-sdk/client-s3";

const DEFAULT_ALLOWED_ORIGINS = [
  "https://desaynclaw.com",
  "https://www.desaynclaw.com",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;

  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;

    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    const rawValue = trimmed.slice(index + 1).trim();
    const value = rawValue.replace(/^['"]|['"]$/g, "");

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function resolveAllowedOrigins() {
  const configured = process.env.R2_CORS_ALLOWED_ORIGINS;
  if (!configured) return DEFAULT_ALLOWED_ORIGINS;

  const origins = configured
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return origins.length ? origins : DEFAULT_ALLOWED_ORIGINS;
}

loadEnvFile(resolve(process.cwd(), ".env.local"));

const accountId = requiredEnv("CLOUDFLARE_ACCOUNT_ID");
const accessKeyId = requiredEnv("CLOUDFLARE_ACCESS_KEY_ID");
const secretAccessKey = requiredEnv("CLOUDFLARE_SECRET_ACCESS_KEY");
const bucketName = requiredEnv("CLOUDFLARE_BUCKET_NAME");
const allowedOrigins = resolveAllowedOrigins();

const client = new S3Client({
  region: "auto",
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId,
    secretAccessKey,
  },
});

try {
  await client.send(new PutBucketCorsCommand({
    Bucket: bucketName,
    CORSConfiguration: {
      CORSRules: [
        {
          AllowedOrigins: allowedOrigins,
          AllowedMethods: ["GET", "PUT", "HEAD"],
          AllowedHeaders: ["content-type", "x-amz-*"],
          ExposeHeaders: ["ETag"],
          MaxAgeSeconds: 3600,
        },
      ],
    },
  }));

  console.log(`R2 CORS configured for bucket "${bucketName}".`);
  console.log(`Allowed origins: ${allowedOrigins.join(", ")}`);
} catch (error) {
  if (error?.name === "AccessDenied" || error?.Code === "AccessDenied") {
    console.error(
      [
        `Access denied while configuring CORS for bucket "${bucketName}".`,
        "Use an R2 token/key with bucket-level write/admin permission, or set the same CORS rules in the Cloudflare dashboard.",
      ].join("\n")
    );
    process.exit(1);
  }

  throw error;
}
