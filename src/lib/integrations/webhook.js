import { createHmac, randomBytes } from "node:crypto";
import net from "node:net";
import { adminSupabase } from "@/lib/supabase";
import { decryptSecret, encryptSecret, integrationsCryptoConfigured } from "@/lib/integrations/crypto";
import { logger } from "@/lib/logger";

const WEBHOOK_TIMEOUT_MS = 5000;
const MAX_WEBHOOK_BODY_BYTES = 64 * 1024;

function isPrivateIpLiteral(hostname) {
  if (net.isIPv4(hostname)) {
    const parts = hostname.split(".").map(Number);
    return (
      parts[0] === 10 ||
      parts[0] === 127 ||
      parts[0] === 0 ||
      parts[0] >= 224 ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168) ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)
    );
  }

  if (net.isIPv6(hostname)) {
    const normalized = hostname.toLowerCase();
    return normalized === "::1" || normalized === "::" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80");
  }

  return false;
}

export function validateWebhookUrl(url) {
  try {
    const parsed = new URL(String(url || "").trim());
    if (parsed.protocol !== "https:") return { ok: false, error: "Webhook URL must use https://." };
    if (parsed.username || parsed.password) return { ok: false, error: "Webhook URL cannot include credentials." };
    if (["localhost", "127.0.0.1", "::1"].includes(parsed.hostname.toLowerCase())) {
      return { ok: false, error: "Webhook URL cannot target localhost." };
    }
    if (isPrivateIpLiteral(parsed.hostname)) return { ok: false, error: "Webhook URL cannot target private IP addresses." };
    if (String(url).length > 2048) return { ok: false, error: "Webhook URL is too long." };
    return { ok: true, url: parsed.href };
  } catch {
    return { ok: false, error: "Webhook URL is invalid." };
  }
}

export function createWebhookSecret() {
  return `dclaw_whsec_${randomBytes(32).toString("base64url")}`;
}

export function signWebhookPayload(secret, timestamp, rawBody) {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex")}`;
}

export function buildProjectCompletedPayload(project) {
  return {
    event: "project.completed",
    project: {
      id: project.id,
      name: project.name || "Untitled Design",
      svgUrl: project.svg_url || null,
      pngUrl: project.upscaled_image_url || project.generated_image_url || null,
      zipUrl: project.zip_url || null,
    },
    completedAt: new Date().toISOString(),
  };
}

export async function upsertWebhookSettings(userId, { url, enabled }) {
  if (!integrationsCryptoConfigured()) {
    throw new Error("Integrations encryption is not configured.");
  }

  const validation = validateWebhookUrl(url);
  if (!validation.ok) throw new Error(validation.error);

  const { data: existing, error: readError } = await adminSupabase
    .from("user_integrations")
    .select("webhook_secret_enc")
    .eq("user_id", userId)
    .maybeSingle();
  if (readError) throw readError;

  const secret = existing?.webhook_secret_enc ? decryptSecret(existing.webhook_secret_enc) : createWebhookSecret();
  const { error } = await adminSupabase
    .from("user_integrations")
    .upsert({
      user_id: userId,
      webhook_url: validation.url,
      webhook_enabled: Boolean(enabled),
      webhook_secret_enc: encryptSecret(secret),
      webhook_last_error: null,
    }, { onConflict: "user_id" });
  if (error) throw error;

  return { url: validation.url, enabled: Boolean(enabled), signingSecret: secret };
}

export async function deliverWebhook(userId, payload) {
  if (!integrationsCryptoConfigured()) return { skipped: true, reason: "encryption_not_configured" };

  const { data: settings, error } = await adminSupabase
    .from("user_integrations")
    .select("webhook_url, webhook_secret_enc, webhook_enabled")
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !settings?.webhook_enabled || !settings.webhook_url || !settings.webhook_secret_enc) {
    return { skipped: true, reason: error ? "settings_error" : "not_enabled" };
  }

  const validation = validateWebhookUrl(settings.webhook_url);
  if (!validation.ok) return { skipped: true, reason: "invalid_url" };

  const rawBody = JSON.stringify(payload);
  if (Buffer.byteLength(rawBody, "utf8") > MAX_WEBHOOK_BODY_BYTES) {
    return { skipped: true, reason: "payload_too_large" };
  }

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const secret = decryptSecret(settings.webhook_secret_enc);
  const signature = signWebhookPayload(secret, timestamp, rawBody);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

  try {
    const response = await fetch(validation.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "DesaynClaw-Webhooks/1.0",
        "x-desaynclaw-event": payload.event || "project.completed",
        "x-desaynclaw-timestamp": timestamp,
        "x-desaynclaw-signature": signature,
      },
      body: rawBody,
      redirect: "error",
      signal: controller.signal,
    });

    await adminSupabase
      .from("user_integrations")
      .update({
        webhook_last_status: String(response.status),
        webhook_last_delivered_at: response.ok ? new Date().toISOString() : null,
        webhook_last_error: response.ok ? null : `HTTP ${response.status}`,
      })
      .eq("user_id", userId);

    return { ok: response.ok, status: response.status };
  } catch (deliveryError) {
    await adminSupabase
      .from("user_integrations")
      .update({
        webhook_last_status: "failed",
        webhook_last_error: String(deliveryError?.message || "Webhook delivery failed").slice(0, 500),
      })
      .eq("user_id", userId);
    logger.warn("[Webhook] Delivery failed", { userId, error: deliveryError });
    return { ok: false, error: "delivery_failed" };
  } finally {
    clearTimeout(timeout);
  }
}

export async function notifyProjectCompleted(userId, project) {
  try {
    return await deliverWebhook(userId, buildProjectCompletedPayload(project));
  } catch (error) {
    logger.warn("[Webhook] Project completed notification skipped", { userId, projectId: project?.id, error });
    return { ok: false, error: "notification_failed" };
  }
}
