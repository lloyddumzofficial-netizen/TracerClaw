import "server-only";

import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { adminSupabase } from "@/lib/supabase";
import { getClientIp } from "@/lib/rateLimit";
import { logger } from "@/lib/logger";
import { isDisposableEmailDomain, normalizeEmailDomain } from "./disposableDomains";

export const REFERRAL_COOKIE = "dc_referral";
export const REFERRAL_DEVICE_COOKIE = "dc_ref_device";
export const REFERRAL_COOKIE_MAX_AGE = 7 * 24 * 60 * 60;
export const REFERRAL_DEVICE_MAX_AGE = 90 * 24 * 60 * 60;
const REFERRAL_CODE_PATTERN = /^DC[A-F0-9]{18}$/;

export function referralsEnabled() {
  return process.env.REFERRALS_ENABLED === "true";
}

export function isReferralRewardProviderEligible(provider) {
  return String(provider || "").trim().toLowerCase() === "google";
}

export function getReferralSecret() {
  const secret = process.env.REFERRAL_SECURITY_SECRET || "";
  if (secret.length < 32) {
    throw new Error("REFERRAL_SECURITY_SECRET must contain at least 32 characters");
  }
  return secret;
}

function hmac(value) {
  return createHmac("sha256", getReferralSecret()).update(value).digest("base64url");
}

export function deriveReferralCode(userId) {
  const digest = createHmac("sha256", getReferralSecret())
    .update(`referral-code:${userId}`)
    .digest("hex")
    .slice(0, 18)
    .toUpperCase();
  return `DC${digest}`;
}

export function normalizeReferralCode(code) {
  const normalized = String(code || "").trim().toUpperCase();
  return REFERRAL_CODE_PATTERN.test(normalized) ? normalized : "";
}

export function hashReferralCode(code) {
  const normalized = normalizeReferralCode(code);
  return normalized ? createHash("sha256").update(normalized).digest("hex") : "";
}

function signValue(payload) {
  return `${payload}.${hmac(`cookie:${payload}`)}`;
}

function verifySignedValue(value) {
  const raw = String(value || "");
  const separator = raw.lastIndexOf(".");
  if (separator <= 0) return null;
  const payload = raw.slice(0, separator);
  const supplied = raw.slice(separator + 1);
  const expected = hmac(`cookie:${payload}`);
  const suppliedBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(expected);
  if (suppliedBuffer.length !== expectedBuffer.length) return null;
  return timingSafeEqual(suppliedBuffer, expectedBuffer) ? payload : null;
}

export function createReferralCookie(code, issuedAt = Date.now()) {
  const normalized = normalizeReferralCode(code);
  if (!normalized) throw new Error("Invalid referral code");
  const payload = Buffer.from(JSON.stringify({ code: normalized, issuedAt })).toString("base64url");
  return signValue(payload);
}

export function readReferralCookie(value, now = Date.now()) {
  try {
    const payload = verifySignedValue(value);
    if (!payload) return null;
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const code = normalizeReferralCode(parsed.code);
    const issuedAt = Number(parsed.issuedAt);
    if (!code || !Number.isFinite(issuedAt)) return null;
    if (issuedAt > now + 5 * 60_000 || now - issuedAt > REFERRAL_COOKIE_MAX_AGE * 1000) return null;
    return { code, issuedAt };
  } catch {
    return null;
  }
}

export function createDeviceCookie(deviceId = randomUUID()) {
  return signValue(Buffer.from(deviceId).toString("base64url"));
}

export function readDeviceCookie(value) {
  try {
    const payload = verifySignedValue(value);
    if (!payload) return null;
    const deviceId = Buffer.from(payload, "base64url").toString("utf8");
    return /^[0-9a-f-]{36}$/i.test(deviceId) ? deviceId : null;
  } catch {
    return null;
  }
}

export function hashDeviceId(deviceId) {
  return deviceId ? hmac(`device:${deviceId}`) : null;
}

export function coarseNetwork(ip) {
  const value = String(ip || "").trim();
  const ipv4 = value.match(/^(?:\d{1,3}\.){3}\d{1,3}$/);
  if (ipv4) {
    const parts = value.split(".").map(Number);
    if (parts.every((part) => part >= 0 && part <= 255)) return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
  }
  if (value.includes(":")) {
    const normalized = value.toLowerCase().split("%")[0];
    return `${normalized.split(":").slice(0, 4).join(":")}::/64`;
  }
  return null;
}

export function hashRequestNetwork(request) {
  const network = coarseNetwork(getClientIp(request));
  return network ? hmac(`network:${network}`) : null;
}

export function referralCookieOptions(maxAge) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge,
    priority: "high",
  };
}

function requestCookie(request, name) {
  if (request.cookies?.get) return request.cookies.get(name)?.value || "";
  const cookieHeader = request.headers.get("cookie") || "";
  const item = cookieHeader.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : "";
}

export function getOrCreateDevice(request) {
  const existing = readDeviceCookie(requestCookie(request, REFERRAL_DEVICE_COOKIE));
  if (existing) return { deviceId: existing, cookieValue: null };
  const deviceId = randomUUID();
  return { deviceId, cookieValue: createDeviceCookie(deviceId) };
}

export async function bindReferralFromAuthCallback(request, user) {
  if (!referralsEnabled() || !user?.id || !user?.email) return { handled: false, status: "disabled" };
  const referral = readReferralCookie(requestCookie(request, REFERRAL_COOKIE));
  const deviceId = readDeviceCookie(requestCookie(request, REFERRAL_DEVICE_COOKIE));
  if (!referral || !deviceId) return { handled: false, status: "missing_cookie" };

  const domain = normalizeEmailDomain(user.email);
  const provider = user.app_metadata?.provider || user.app_metadata?.providers?.[0] || "email";
  const disposableEmail = isDisposableEmailDomain(domain);
  const providerEligible = isReferralRewardProviderEligible(provider);
  const { data, error } = await adminSupabase.rpc("bind_referral_and_grant_trial", {
    target_code_hash: hashReferralCode(referral.code),
    target_invitee_user_id: user.id,
    target_invitee_email: user.email,
    target_email_domain: domain,
    target_auth_provider: provider,
    target_device_hash: hashDeviceId(deviceId),
    target_network_hash: hashRequestNetwork(request),
    target_referral_issued_at: new Date(referral.issuedAt).toISOString(),
    // Unknown disposable domains rotate continuously. Referral rewards therefore
    // require Google identity in addition to the domain denylist. Magic-link
    // authentication remains available, but it cannot mint referral Claws.
    target_disposable_email: disposableEmail || !providerEligible,
  });
  if (error) throw error;
  const result = Array.isArray(data) ? data[0] : data;

  if (result?.status === "rejected" && result?.referral_id && !disposableEmail && !providerEligible) {
    const [referralUpdate, signalUpdate] = await Promise.all([
      adminSupabase.from("referrals")
        .update({ rejection_reason: "untrusted_auth_provider" })
        .eq("id", result.referral_id)
        .eq("rejection_reason", "disposable_email"),
      adminSupabase.from("referral_risk_signals")
        .update({ signal_type: "untrusted_auth_provider" })
        .eq("referral_id", result.referral_id)
        .eq("signal_type", "disposable_email"),
    ]);
    if (referralUpdate.error || signalUpdate.error) {
      logger.warn("[Referrals] Could not refine rejected provider audit reason", {
        referralId: result.referral_id,
      });
    }
  }
  return { handled: true, status: result?.status || "unknown", referralId: result?.referral_id || null };
}

export function maskEmail(email) {
  const normalized = String(email || "");
  const [local, domain] = normalized.split("@");
  if (!local || !domain) return "Hidden user";
  return `${local.slice(0, 1)}${"*".repeat(Math.min(Math.max(local.length - 1, 2), 6))}@${domain}`;
}

export async function getReferralSummary(userId, origin) {
  const [profileResult, activityResult, codeResult, referralsResult, lifetimeRewardResult] = await Promise.all([
    adminSupabase.from("profiles").select("created_at").eq("id", userId).single(),
    adminSupabase.from("user_activity_summary").select("completed_project_count").eq("user_id", userId).maybeSingle(),
    adminSupabase.from("referral_codes").select("id, enabled, code_hash, click_count").eq("owner_user_id", userId).maybeSingle(),
    adminSupabase.from("referrals")
      .select("id, invitee_email, status, trial_granted_at, qualified_at, review_after, settled_at, rejection_reason, created_at")
      .eq("referrer_user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50),
    adminSupabase.from("referral_rewards")
      .select("id", { count: "exact", head: true })
      .eq("recipient_user_id", userId)
      .eq("reward_type", "referrer_completion")
      .eq("status", "rewarded"),
  ]);
  if (profileResult.error) throw profileResult.error;
  if (activityResult.error) throw activityResult.error;
  if (codeResult.error) throw codeResult.error;
  if (referralsResult.error) throw referralsResult.error;
  if (lifetimeRewardResult.error) throw lifetimeRewardResult.error;

  const accountAgeMs = Date.now() - new Date(profileResult.data.created_at).getTime();
  const completedProjects = activityResult.data?.completed_project_count || 0;
  const eligible = accountAgeMs >= 7 * 24 * 60 * 60_000 && completedProjects >= 1;
  const derivedCode = codeResult.data ? deriveReferralCode(userId) : null;
  const code = codeResult.data?.enabled ? derivedCode : null;
  const secretMatches = !codeResult.data || hashReferralCode(derivedCode) === codeResult.data.code_hash;
  const referrals = (referralsResult.data || []).map((item) => ({
    id: item.id,
    invitee: maskEmail(item.invitee_email),
    status: item.status,
    trialGrantedAt: item.trial_granted_at,
    qualifiedAt: item.qualified_at,
    reviewAfter: item.review_after,
    settledAt: item.settled_at,
    rejectionReason: item.rejection_reason,
    createdAt: item.created_at,
  }));
  const lifetimeRewards = lifetimeRewardResult.count || 0;

  return {
    enabled: true,
    eligible,
    eligibility: { accountAgeDays: Math.max(0, Math.floor(accountAgeMs / 86_400_000)), completedProjects },
    code: secretMatches ? code : null,
    link: secretMatches && code ? `${origin}/r/${code}` : null,
    codeEnabled: Boolean(codeResult.data?.enabled),
    clickCount: codeResult.data?.click_count || 0,
    lifetimeRewards,
    lifetimeCap: 3,
    referrals,
    configurationError: secretMatches ? null : "REFERRAL_SECRET_CHANGED",
  };
}

export async function createOrGetReferralCode(userId, deviceId) {
  const code = deriveReferralCode(userId);
  const { data, error } = await adminSupabase.rpc("create_referral_code", {
    target_owner_user_id: userId,
    target_code_hash: hashReferralCode(code),
    target_code_prefix: code.slice(0, 8),
    target_owner_device_hash: hashDeviceId(deviceId),
  });
  if (error) throw error;
  const result = Array.isArray(data) ? data[0] : data;
  return { ...result, code: ["created", "existing"].includes(result?.status) ? code : null };
}
