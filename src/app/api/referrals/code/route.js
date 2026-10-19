import { NextResponse } from "next/server";
import { requireUser } from "@/server/api/auth";
import { enforceRateLimit, getRedisClient } from "@/lib/rateLimit";
import {
  REFERRAL_DEVICE_COOKIE,
  REFERRAL_DEVICE_MAX_AGE,
  createOrGetReferralCode,
  getOrCreateDevice,
  getReferralSecret,
  referralCookieOptions,
  referralsEnabled,
} from "@/server/referrals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  if (!referralsEnabled()) {
    return NextResponse.json({ error: "Referral program is not enabled." }, { status: 503 });
  }
  try {
    getReferralSecret();
  } catch {
    return NextResponse.json({ error: "Referral program is unavailable." }, { status: 503 });
  }
  if (!getRedisClient()) {
    return NextResponse.json({ error: "Referral security service is unavailable." }, { status: 503 });
  }

  const auth = await requireUser(request);
  if (auth.response) return auth.response;
  const rateLimit = await enforceRateLimit({
    namespace: "api:referrals:create:user",
    identifier: auth.user.id,
    max: 5,
    window: "1 h",
    windowMs: 60 * 60_000,
  });
  if (!rateLimit.success) return rateLimit.response;

  try {
    const device = getOrCreateDevice(request);
    const result = await createOrGetReferralCode(auth.user.id, device.deviceId);
    if (result.status === "not_eligible") {
      return NextResponse.json({ error: "Complete one project and keep your account active for 7 days first." }, { status: 403 });
    }
    if (result.status === "secret_mismatch") {
      return NextResponse.json({ error: "Referral configuration changed. Contact support before creating a new link." }, { status: 409 });
    }
    if (result.status === "disabled") {
      return NextResponse.json({ error: "This referral code has been disabled." }, { status: 403 });
    }
    if (!result.code) {
      return NextResponse.json({ error: "Could not create a referral link." }, { status: 500 });
    }

    const origin = new URL(request.url).origin;
    const response = NextResponse.json({
      code: result.code,
      link: `${origin}/r/${result.code}`,
      status: result.status,
    }, { headers: rateLimit.headers });
    if (device.cookieValue) {
      response.cookies.set(
        REFERRAL_DEVICE_COOKIE,
        device.cookieValue,
        referralCookieOptions(REFERRAL_DEVICE_MAX_AGE)
      );
    }
    return response;
  } catch (error) {
    console.error("[Referrals] Could not create referral code", error);
    return NextResponse.json({ error: "Could not create a referral link." }, { status: 500 });
  }
}
