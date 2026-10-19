import { NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase";
import { enforceRateLimit, getRedisClient } from "@/lib/rateLimit";
import {
  REFERRAL_COOKIE,
  REFERRAL_COOKIE_MAX_AGE,
  REFERRAL_DEVICE_COOKIE,
  REFERRAL_DEVICE_MAX_AGE,
  createReferralCookie,
  getOrCreateDevice,
  getReferralSecret,
  hashReferralCode,
  hashRequestNetwork,
  normalizeReferralCode,
  referralCookieOptions,
  referralsEnabled,
} from "@/server/referrals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function homeRedirect(request, state) {
  const url = new URL("/", request.url);
  if (state) url.searchParams.set("referral", state);
  return NextResponse.redirect(url);
}

export async function GET(request, context) {
  if (!referralsEnabled()) return homeRedirect(request, "disabled");

  let code;
  try {
    getReferralSecret();
    code = normalizeReferralCode((await context.params).code);
  } catch {
    return homeRedirect(request, "unavailable");
  }
  if (!code) return homeRedirect(request, "invalid");
  if (!getRedisClient()) return homeRedirect(request, "unavailable");

  const rateLimit = await enforceRateLimit({
    namespace: "referrals:click:network",
    identifier: hashRequestNetwork(request) || "unknown",
    max: 30,
    window: "1 h",
    windowMs: 60 * 60_000,
  });
  if (!rateLimit.success) return rateLimit.response;

  const codeHash = hashReferralCode(code);
  const { data, error } = await adminSupabase.rpc("record_referral_click", {
    target_code_hash: codeHash,
  });
  const result = Array.isArray(data) ? data[0] : data;
  if (error || result?.status !== "recorded") return homeRedirect(request, "invalid");

  const response = homeRedirect(request, "ready");
  const device = getOrCreateDevice(request);
  response.cookies.set(
    REFERRAL_COOKIE,
    createReferralCookie(code),
    referralCookieOptions(REFERRAL_COOKIE_MAX_AGE)
  );
  if (device.cookieValue) {
    response.cookies.set(
      REFERRAL_DEVICE_COOKIE,
      device.cookieValue,
      referralCookieOptions(REFERRAL_DEVICE_MAX_AGE)
    );
  }
  return response;
}
