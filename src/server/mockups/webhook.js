import { createHmac, timingSafeEqual } from "node:crypto";

function webhookSecret() {
  return process.env.MOCKUP_WEBHOOK_SECRET || process.env.CRON_SECRET || "";
}

export function createMockupWebhookUrl(jobId) {
  const secret = webhookSecret();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!secret || !siteUrl || !jobId) return null;
  const url = new URL("/api/mockups/webhook", siteUrl);
  url.searchParams.set("jobId", jobId);
  url.searchParams.set("token", createHmac("sha256", secret).update(String(jobId)).digest("hex"));
  return url.toString();
}

export function isValidMockupWebhookToken(jobId, value) {
  const secret = webhookSecret();
  if (!secret || !jobId) return false;
  const expected = createHmac("sha256", secret).update(String(jobId)).digest("hex");
  const received = String(value || "");
  if (received.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(received), Buffer.from(expected));
}
