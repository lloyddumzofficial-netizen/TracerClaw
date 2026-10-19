import { NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase";
import { getRedisClient } from "@/lib/rateLimit";
import { logger } from "@/lib/logger";
import {
  getReferralSecret,
  isReferralRewardProviderEligible,
  referralsEnabled,
} from "@/server/referrals";
import { isDisposableEmailDomain, normalizeEmailDomain } from "@/server/referrals/disposableDomains";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function reject(referralId, reason) {
  const result = await adminSupabase.rpc("reject_referral_reward", {
    target_referral_id: referralId,
    rejection_reason_value: reason,
  });
  if (result.error) throw result.error;
  return result;
}

export async function GET(request) {
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!referralsEnabled()) return NextResponse.json({ status: "disabled", processed: 0 });
  try {
    getReferralSecret();
  } catch {
    return NextResponse.json({ error: "Referral configuration is incomplete." }, { status: 503 });
  }
  if (!getRedisClient()) {
    return NextResponse.json({ error: "Distributed referral security is unavailable." }, { status: 503 });
  }

  const { data: pending, error } = await adminSupabase.rpc("get_pending_referral_rewards", {
    batch_limit: 100,
  });
  if (error) {
    logger.error("[Referral Cron] Could not load pending rewards", { error: error.message });
    return NextResponse.json({ error: "Could not load pending referral rewards." }, { status: 500 });
  }

  const results = { processed: 0, rewarded: 0, rejected: 0, deferred: 0, failures: 0 };
  for (const item of pending || []) {
    results.processed += 1;
    try {
      const { data: authData, error: authError } = await adminSupabase.auth.admin.getUserById(item.invitee_user_id);
      const authUser = authData?.user;
      const currentDomain = normalizeEmailDomain(authUser?.email);
      const authProvider = authUser?.app_metadata?.provider || authUser?.app_metadata?.providers?.[0] || "email";
      const emailChanged = !authUser?.email || authUser.email.toLowerCase() !== item.invitee_email.toLowerCase();
      const unverified = !authUser?.email_confirmed_at && !authUser?.confirmed_at;
      const disabled = Boolean(authUser?.banned_until && new Date(authUser.banned_until) > new Date());

      if (authError || !authUser) {
        await reject(item.referral_id, "invitee_account_missing");
        results.rejected += 1;
        continue;
      }
      if (emailChanged || unverified || disabled) {
        await reject(item.referral_id, emailChanged ? "invitee_email_changed" : unverified ? "invitee_unverified" : "invitee_disabled");
        results.rejected += 1;
        continue;
      }
      if (!isReferralRewardProviderEligible(authProvider)) {
        await reject(item.referral_id, "untrusted_auth_provider");
        results.rejected += 1;
        continue;
      }
      if (currentDomain !== item.invitee_email_domain || isDisposableEmailDomain(currentDomain)) {
        await reject(item.referral_id, "disposable_email");
        results.rejected += 1;
        continue;
      }

      const { data: settlement, error: settlementError } = await adminSupabase.rpc("settle_referral_reward", {
        target_referral_id: item.referral_id,
      });
      if (settlementError) throw settlementError;
      const row = Array.isArray(settlement) ? settlement[0] : settlement;
      if (["rewarded", "already_rewarded"].includes(row?.status)) results.rewarded += 1;
      else if (["monthly_cap", "not_pending", "referral_code_disabled"].includes(row?.status)) results.rejected += 1;
      else results.deferred += 1;
    } catch (itemError) {
      results.failures += 1;
      logger.error("[Referral Cron] Settlement failed", {
        referralId: item.referral_id,
        error: itemError?.message,
      });
    }
  }

  const riskRetentionCutoff = new Date(Date.now() - 90 * 24 * 60 * 60_000).toISOString();
  await adminSupabase.from("referral_risk_signals")
    .delete()
    .lt("expires_at", new Date().toISOString());
  await adminSupabase.from("referrals")
    .update({ device_hash: null, network_hash: null })
    .lt("created_at", riskRetentionCutoff);
  await adminSupabase.from("referral_codes")
    .update({ owner_device_hash: null })
    .lt("created_at", riskRetentionCutoff);
  return NextResponse.json({ status: results.failures ? "partial" : "ok", ...results }, {
    status: results.failures ? 207 : 200,
    headers: { "Cache-Control": "no-store" },
  });
}
