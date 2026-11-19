import nextEnv from "@next/env";
import { S3Client, HeadBucketCommand, CreateBucketCommand, PutBucketCorsCommand, GetBucketCorsCommand, PutBucketLifecycleConfigurationCommand, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";
import { appendFile, readFile, writeFile, mkdir } from "node:fs/promises";
nextEnv.loadEnvConfig(process.cwd());
const bucket = process.env.DESIGN_EXTRACT_PRIVATE_BUCKET || "desaynclaw-design-extract-private";
const create = process.argv.includes("--create");
const objectOnly = process.argv.includes("--objects-only");
const writeLocal = process.argv.includes("--write-local");
if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket) || bucket === process.env.CLOUDFLARE_BUCKET_NAME) throw new Error("Use a separate private bucket");
for (const key of ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_ACCESS_KEY_ID", "CLOUDFLARE_SECRET_ACCESS_KEY"]) if (!process.env[key]) throw new Error(`Missing ${key}`);
const client = new S3Client({ region: "auto", endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`, credentials: { accessKeyId: process.env.CLOUDFLARE_ACCESS_KEY_ID, secretAccessKey: process.env.CLOUDFLARE_SECRET_ACCESS_KEY }, maxAttempts: 1 });
const origins = ["https://desaynclaw.com", "https://www.desaynclaw.com", "http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:3100", "http://127.0.0.1:3100"];
let created = false, probe;
try {
  if (!objectOnly) try { await client.send(new HeadBucketCommand({ Bucket: bucket })); }
  catch (error) {
    if (error.$metadata?.httpStatusCode !== 404) throw error;
    if (!create) throw new Error("Private bucket is missing; run with --create to provision a new private bucket");
    await client.send(new CreateBucketCommand({ Bucket: bucket })); created = true;
    await mkdir(".tmp", { recursive: true });
    await writeFile(".tmp/design-extract-private-bucket-created.json", JSON.stringify({ bucket, createdAt: new Date().toISOString() }));
  }
  // Only configure a bucket created by this explicit operation. Existing buckets
  // require a separate public-domain audit; S3 anonymous access alone cannot prove it.
  if (create && !created) throw new Error("Bucket already exists. Verify that public domains are disabled before configuring it.");
  if (created) {
    await client.send(new PutBucketCorsCommand({ Bucket: bucket, CORSConfiguration: { CORSRules: [{ AllowedOrigins: origins, AllowedMethods: ["GET", "PUT", "HEAD"], AllowedHeaders: ["content-type", "x-amz-*"], ExposeHeaders: ["ETag"], MaxAgeSeconds: 300 }] } }));
    await client.send(new PutBucketLifecycleConfigurationCommand({ Bucket: bucket, LifecycleConfiguration: { Rules: [
      { ID: "design-extract-staging", Status: "Enabled", Filter: { Prefix: "staging/design-extract/" }, Expiration: { Days: 1 } },
      { ID: "design-extract-project-fallback", Status: "Enabled", Filter: { Prefix: "users/" }, Expiration: { Days: 3 } },
      { ID: "incomplete-uploads", Status: "Enabled", Filter: { Prefix: "" }, AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 } },
    ] } }));
  }
  const cors = objectOnly ? null : await client.send(new GetBucketCorsCommand({ Bucket: bucket }));
  if (!objectOnly && !cors.CORSRules?.some(rule => rule.AllowedOrigins?.includes("http://localhost:3000") && rule.AllowedMethods?.includes("PUT"))) throw new Error("Required private upload CORS is missing");
  probe = `staging/design-extract/security-probe/${randomUUID()}.txt`;
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: probe, Body: "private-design-extract-check", ContentType: "text/plain", CacheControl: "private, no-store" }));
  const putUrl = await getSignedUrl(client, new PutObjectCommand({ Bucket: bucket, Key: probe, ContentType: "text/plain" }), { expiresIn: 300 });
  const preflight = await fetch(putUrl, { method: "OPTIONS", headers: { Origin: "http://localhost:3000", "Access-Control-Request-Method": "PUT", "Access-Control-Request-Headers": "content-type" }, signal: AbortSignal.timeout(10000) });
  if (!preflight.ok || preflight.headers.get("access-control-allow-origin") !== "http://localhost:3000" || !preflight.headers.get("access-control-allow-methods")?.includes("PUT")) throw new Error("Private browser upload CORS preflight failed");
  const put = await fetch(putUrl, { method: "PUT", headers: { "Content-Type": "text/plain", Origin: "http://localhost:3000" }, body: "private-design-extract-check", signal: AbortSignal.timeout(10000) });
  if (!put.ok) throw new Error(`Signed private upload failed (HTTP ${put.status})`);
  const signed = await getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: probe }), { expiresIn: 300 });
  const sdkRead = await client.send(new GetObjectCommand({ Bucket: bucket, Key: probe }));
  if (await sdkRead.Body.transformToString() !== "private-design-extract-check") throw new Error("SDK object read mismatch");
  const signedRead = await fetch(signed, { signal: AbortSignal.timeout(10000) });
  const signedText = await signedRead.text();
  console.log(JSON.stringify({ clockOffsetSeconds: Math.round((Date.parse(signedRead.headers.get("date")) - Date.now()) / 1000), sdkClockOffsetSeconds: Math.round((client.config.systemClockOffset || 0) / 1000) }));
  if (!signedRead.ok || signedText !== "private-design-extract-check") { const code = signedText.match(new RegExp("<Code>([A-Za-z]+)<"))?.[1] || "unknown"; throw new Error(`Signed private read failed (HTTP ${signedRead.status}, ${code})`); }
  const anonymous = new URL(signed); anonymous.search = "";
  const blocked = await fetch(anonymous, { signal: AbortSignal.timeout(10000) });
  const anonymousBody = await blocked.text();
  const anonymousCode = anonymousBody.match(new RegExp("<Code>([A-Za-z]+)<"))?.[1];
  if (![401, 403, 404].includes(blocked.status) && !(blocked.status === 400 && anonymousCode === "InvalidArgument")) throw new Error(`Anonymous S3 read returned HTTP ${blocked.status} (${anonymousCode || "unknown"})`);
  if (writeLocal) {
    if (!created) throw new Error("Refusing to activate an existing bucket without a public-domain audit");
    const local = await readFile(".env.local", "utf8");
    if (/^DESIGN_EXTRACT_PRIVATE_BUCKET=/m.test(local)) throw new Error("Private bucket setting already exists; review it manually");
    await appendFile(".env.local", `\n# Dedicated private Design Extract assets (no public domain).\nDESIGN_EXTRACT_PRIVATE_BUCKET=${bucket}\n`);
  }
  console.log(JSON.stringify({ created, signedReadVerified: true, anonymousS3ReadBlocked: true, corsVerified: true, signedUploadVerified: true, localConfigurationWritten: writeLocal, publicDomainsCreated: false }));
} catch (error) {
  console.error("Private storage setup failed:", { code: error.name, status: error.$metadata?.httpStatusCode || null, message: error.$metadata ? "Storage permission or configuration failure" : error.message });
  process.exitCode = 1;
} finally {
  if (probe) await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: probe })).catch(() => { console.error("Could not delete the isolated probe object; staging lifecycle will remove it."); process.exitCode = 1; });
}
