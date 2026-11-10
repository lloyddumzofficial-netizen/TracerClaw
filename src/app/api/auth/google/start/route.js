import { NextResponse } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { createClient } from "@/utils/supabase/server";
import { adminSupabase } from "@/lib/supabase";
import { getClientIp, getRedisClient } from "@/lib/rateLimit";
import { createDeviceCookie, getOrCreateDevice, hashDeviceId, referralCookieOptions, REFERRAL_DEVICE_COOKIE, REFERRAL_DEVICE_MAX_AGE } from "@/server/referrals";
import { intentRecord, INTENT_TTL_SECONDS, signIntent, TRIAL_INTENT_COOKIE, verifyTurnstile, welcomeTrialEnabled } from "@/server/welcomeTrial/security";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

export async function POST(request) {
  const origin = new URL(request.url).origin;
  if (request.headers.get("origin") !== origin) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  if (Number(request.headers.get("content-length") || 0) > 4096) return NextResponse.json({ error: "Request too large" }, { status: 413 });
  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request" }, { status: 400 }); }
  let device;
  let intent;
  if (welcomeTrialEnabled()) {
    try {
      device = getOrCreateDevice(request);
      const redis = getRedisClient();
      if (redis) {
        const limiter = (max, prefix) => new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(max, "15 m"), prefix });
        const [browser, network] = await Promise.all([
          limiter(10, "rl:trial:browser").limit(hashDeviceId(device.deviceId)),
          limiter(60, "rl:trial:ip").limit(getClientIp(request)),
        ]);
        if (browser.success && network.success && await verifyTurnstile(body.captchaToken, request)) {
          const record = intentRecord(device.deviceId);
          const { error } = await adminSupabase.from("welcome_trial_intents").insert(record);
          if (error) throw error;
          intent = signIntent(record.nonce);
        }
      }
    } catch {
      // Never log the request, CAPTCHA token, OAuth response, or secret.
      logger.warn("[Welcome trial] Bonus verification unavailable; continuing ordinary Google sign-in");
    }
  }
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${origin}/api/auth/callback`, scopes: "openid profile email", skipBrowserRedirect: true },
    });
    if (error || !data?.url) throw new Error("OAuth unavailable");
    const response = NextResponse.json({ url: data.url, trialVerification: intent ? "ready" : "unavailable" }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set(TRIAL_INTENT_COOKIE, intent || "", referralCookieOptions(intent ? INTENT_TTL_SECONDS : 0));
    // Refresh the existing signed cookie as well, so the 90-day browser window
    // never silently expires early during an active referral/signup session.
    if (device) response.cookies.set(REFERRAL_DEVICE_COOKIE, device.cookieValue || createDeviceCookie(device.deviceId), referralCookieOptions(REFERRAL_DEVICE_MAX_AGE));
    return response;
  } catch {
    return NextResponse.json({ error: "Google sign-in is temporarily unavailable. Please try again." }, { status: 503 });
  }
}
