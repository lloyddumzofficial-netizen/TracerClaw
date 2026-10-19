import { NextResponse } from "next/server";
import { requireUser } from "@/server/api/auth";
import { enforceRateLimit } from "@/lib/rateLimit";
import { getReferralSummary, getReferralSecret, referralsEnabled } from "@/server/referrals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  if (!referralsEnabled()) {
    return NextResponse.json({ enabled: false }, { headers: { "Cache-Control": "no-store" } });
  }
  try {
    getReferralSecret();
  } catch {
    return NextResponse.json({ error: "Referral program is unavailable." }, { status: 503 });
  }

  const auth = await requireUser(request);
  if (auth.response) return auth.response;
  const rateLimit = await enforceRateLimit({
    namespace: "api:referrals:read:user",
    identifier: auth.user.id,
    max: 30,
    window: "60 s",
    windowMs: 60_000,
  });
  if (!rateLimit.success) return rateLimit.response;

  try {
    const summary = await getReferralSummary(auth.user.id, new URL(request.url).origin);
    return NextResponse.json(summary, { headers: { "Cache-Control": "no-store", ...rateLimit.headers } });
  } catch (error) {
    console.error("[Referrals] Could not load referral summary", error);
    return NextResponse.json({ error: "Could not load referral information." }, { status: 500 });
  }
}
