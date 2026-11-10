import "server-only";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { getReferralSecret, readDeviceCookie, hashDeviceId, REFERRAL_DEVICE_COOKIE } from "@/server/referrals";
import { canonicalTrialEmail, trialFingerprint } from "@/lib/welcomeTrialIdentity.mjs";

export const TRIAL_INTENT_COOKIE = "dc_trial_intent";
export const INTENT_TTL_SECONDS = 20 * 60;
export const TURNSTILE_ACTION = "desaynclaw_login";

export function welcomeTrialEnabled() {
  return process.env.GOOGLE_WELCOME_TRIAL_ENABLED === "true";
}

export function cookieValue(request, name) {
  if (request.cookies?.get) return request.cookies.get(name)?.value || "";
  const item = (request.headers.get("cookie") || "").split(";").map(x => x.trim()).find(x => x.startsWith(`${name}=`));
  try { return item ? decodeURIComponent(item.slice(name.length + 1)) : ""; } catch { return ""; }
}

export function signIntent(nonce) {
  return `${nonce}.${trialFingerprint("intent", nonce, getReferralSecret())}`;
}

export function readIntent(value) {
  const [nonce, signature, extra] = String(value || "").split(".");
  if (extra || !/^[0-9a-f-]{36}$/i.test(nonce || "") || !/^[a-f0-9]{64}$/.test(signature || "")) return null;
  const expected = trialFingerprint("intent", nonce, getReferralSecret());
  return signature.length === expected.length && timingSafeEqual(Buffer.from(signature), Buffer.from(expected)) ? nonce : null;
}

export function intentRecord(deviceId) {
  const nonce = randomUUID();
  return {
    nonce,
    device_hash: hashDeviceId(deviceId),
    expires_at: new Date(Date.now() + INTENT_TTL_SECONDS * 1000).toISOString(),
  };
}

export function requestDeviceHash(request) {
  return hashDeviceId(readDeviceCookie(cookieValue(request, REFERRAL_DEVICE_COOKIE)));
}

export async function verifyTurnstile(token, request, fetcher = fetch) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret || typeof token !== "string" || !token || token.length > 2048) return false;
  if (process.env.NODE_ENV === "production" && /^[123]x0+/.test(secret)) return false;
  const response = await fetcher("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: new URLSearchParams({ secret, response: token }),
    signal: AbortSignal.timeout(5000),
    cache: "no-store",
  });
  if (!response.ok) return false;
  const result = await response.json();
  const allowedHosts = (process.env.TURNSTILE_ALLOWED_HOSTNAMES || "").split(",").map(x => x.trim()).filter(Boolean);
  // Explicit deployment allowlist; never trust a caller-controlled Host header alone.
  const age = Date.now() - Date.parse(result.challenge_ts);
  return result.success === true && allowedHosts.includes(result.hostname)
    && result.hostname === new URL(request.url).hostname
    && result.action === TURNSTILE_ACTION && age >= -30_000 && age <= 300_000;
}

export async function verifiedGoogleIdentity(session, fetcher = fetch) {
  if (!session?.provider_token || !session.user?.id) return null;
  const response = await fetcher("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${session.provider_token}` },
    signal: AbortSignal.timeout(5000), cache: "no-store",
  });
  if (!response.ok) return null;
  const identity = await response.json();
  const email = String(identity.email || "").trim().toLowerCase();
  if (!identity.sub || identity.email_verified !== true || !/^[^@\s]+@gmail\.com$/.test(email)) return null;
  // GoTrue's public UserIdentity API exposes the provider subject as `id`
  // (identity_id is the UUID). Some versions also return provider_id.
  const bound = session.user.identities?.some(item => item.provider === "google" && (item.provider_id || item.id) === identity.sub);
  if (!bound) return null;
  const secret = getReferralSecret();
  return {
    subject: identity.sub, email,
    googleHash: trialFingerprint("google", identity.sub, secret),
    emailHash: trialFingerprint("email", canonicalTrialEmail(email), secret),
  };
}
