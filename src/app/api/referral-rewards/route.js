import { NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase";
import { enforceRateLimit } from "@/lib/rateLimit";
import { requireUser } from "@/server/api/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_ACKNOWLEDGEMENTS = 25;

async function authorize(request, action) {
  const auth = await requireUser(request);
  if (auth.response) return auth;

  const rateLimit = await enforceRateLimit({
    namespace: `api:referral-rewards:${action}:user`,
    identifier: auth.user.id,
    max: action === "read" ? 30 : 20,
    window: "60 s",
    windowMs: 60_000,
  });

  if (!rateLimit.success) return { ...auth, response: rateLimit.response };
  return { ...auth, rateLimit };
}

function serializeReward(reward) {
  return {
    id: reward.id,
    type: reward.reward_type,
    amount: reward.amount,
    settledAt: reward.settled_at,
  };
}

export async function GET(request) {
  const auth = await authorize(request, "read");
  if (auth.response) return auth.response;

  try {
    const [rewardsResult, profileResult] = await Promise.all([
      adminSupabase
        .from("referral_rewards")
        .select("id, reward_type, amount, settled_at")
        .eq("recipient_user_id", auth.user.id)
        .eq("status", "rewarded")
        .is("acknowledged_at", null)
        .order("settled_at", { ascending: false })
        .limit(MAX_ACKNOWLEDGEMENTS),
      adminSupabase
        .from("profiles")
        .select("credits")
        .eq("id", auth.user.id)
        .single(),
    ]);

    if (rewardsResult.error) throw rewardsResult.error;
    if (profileResult.error) throw profileResult.error;

    const notifications = (rewardsResult.data || []).map(serializeReward);
    return NextResponse.json({
      notifications,
      unreadCount: notifications.length,
      unreadAmount: notifications.reduce((total, reward) => total + Number(reward.amount || 0), 0),
      balance: Number(profileResult.data?.credits || 0),
    }, {
      headers: { "Cache-Control": "no-store", ...auth.rateLimit.headers },
    });
  } catch (error) {
    console.error("[Referral Rewards] Could not load reward notices", error);
    return NextResponse.json({ error: "Could not load reward notices." }, { status: 500 });
  }
}

export async function POST(request) {
  const auth = await authorize(request, "acknowledge");
  if (auth.response) return auth.response;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const ids = [...new Set(Array.isArray(body?.ids) ? body.ids : [])]
    .filter((id) => typeof id === "string" && UUID_PATTERN.test(id));

  if (ids.length === 0 || ids.length > MAX_ACKNOWLEDGEMENTS) {
    return NextResponse.json({ error: "Provide between 1 and 25 valid reward IDs." }, { status: 400 });
  }

  try {
    const { data, error } = await adminSupabase
      .from("referral_rewards")
      .update({ acknowledged_at: new Date().toISOString() })
      .eq("recipient_user_id", auth.user.id)
      .eq("status", "rewarded")
      .in("id", ids)
      .is("acknowledged_at", null)
      .select("id");

    if (error) throw error;
    return NextResponse.json({
      acknowledged: (data || []).map((reward) => reward.id),
    }, {
      headers: { "Cache-Control": "no-store", ...auth.rateLimit.headers },
    });
  } catch (error) {
    console.error("[Referral Rewards] Could not acknowledge reward notices", error);
    return NextResponse.json({ error: "Could not acknowledge reward notices." }, { status: 500 });
  }
}
