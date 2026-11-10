import { NextResponse } from "next/server";
import { requireUser } from "@/server/api/auth";
import { adminSupabase } from "@/lib/supabase";
import { campaignStatus } from "@/server/welcomeTrial";
import { enforceRateLimit, getClientIp } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";
export async function GET(request) {
  const json = (body, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
  try {
    const limit = await enforceRateLimit({ namespace: "api:welcome-trial:read", identifier: getClientIp(request), max: 60 });
    if (!limit.success) { limit.response.headers.set("Cache-Control", "no-store"); return limit.response; }
    const campaign = await campaignStatus();
    if (!request.headers.get("authorization")) return json(campaign);
    const auth = await requireUser(request);
    if (auth.response) { auth.response.headers.set("Cache-Control", "no-store"); return auth.response; }
    if (!campaign.enabled) return json({ enabled: false, status: "temporarily_unavailable" });
    const { data, error } = await adminSupabase.rpc("get_google_trial_status", { target_user_id: auth.user.id });
    if (error) throw error;
    return json({ enabled: true, ...(Array.isArray(data) ? data[0] : data) });
  } catch {
    return json({ enabled: false, status: "temporarily_unavailable" });
  }
}
