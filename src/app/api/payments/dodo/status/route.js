import { NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase";
import { getDodoClient } from "@/lib/dodo";
import { logger } from "@/lib/logger";
import { fulfillDodoPayment } from "@/server/payments/dodoFulfillment";
import { getBearerToken, opaqueIdField, parseSearchParams } from "@/lib/apiValidation";

const statusQuerySchema = {
  paymentId: opaqueIdField({ required: false, message: "Invalid payment id" }),
};

export const runtime = "nodejs";

async function getAuthenticatedUser(request) {
  const token = getBearerToken(request);
  if (!token) return null;
  const { data: { user }, error } = await adminSupabase.auth.getUser(token);
  return error ? null : user;
}

async function getBalance(userId) {
  const { data } = await adminSupabase
    .from("profiles")
    .select("credits")
    .eq("id", userId)
    .single();
  return Number.isFinite(data?.credits) ? data.credits : null;
}

async function reconcileLocalPayment(localPayment, userId) {
  if (localPayment.status === "paid") {
    return {
      status: "paid",
      credits: localPayment.credits,
      balance: await getBalance(userId),
    };
  }
  if (localPayment.status === "failed") return { status: "failed" };
  if (!localPayment.dodo_checkout_session_id) return { status: "pending" };

  const client = getDodoClient();
  const session = await client.checkoutSessions.retrieve(localPayment.dodo_checkout_session_id);

  if (["failed", "cancelled"].includes(session.payment_status)) {
    await adminSupabase
      .from("dodo_payments")
      .update({ status: "failed", dodo_payment_id: session.payment_id || null })
      .eq("id", localPayment.id)
      .eq("user_id", userId)
      .neq("status", "paid");
    return { status: "failed" };
  }

  if (session.payment_status !== "succeeded" || !session.payment_id) {
    return { status: "pending" };
  }

  const providerPayment = await client.payments.retrieve(session.payment_id);
  return fulfillDodoPayment({
    payment: providerPayment,
    localPayment,
    source: "return-reconciliation",
  });
}

export async function GET(request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const parsed = parseSearchParams(request, statusQuerySchema);
    if (!parsed.ok) return parsed.response;
    const { paymentId } = parsed.data;
    if (paymentId) {
      const { data: localPayment, error } = await adminSupabase
        .from("dodo_payments")
        .select("*")
        .eq("id", paymentId)
        .eq("user_id", user.id)
        .single();
      if (error || !localPayment) {
        return NextResponse.json({ error: "Payment not found" }, { status: 404 });
      }
      return NextResponse.json(await reconcileLocalPayment(localPayment, user.id));
    }

    // Repair recent successful sessions that were left pending by the previous
    // cross-currency webhook check. This runs once per browser session on sign-in.
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString();
    const { data: pendingPayments, error } = await adminSupabase
      .from("dodo_payments")
      .select("*")
      .eq("user_id", user.id)
      .eq("status", "pending")
      .is("credited_at", null)
      .gte("created_at", cutoff)
      .order("created_at", { ascending: false })
      .limit(10);
    if (error) throw error;

    let recoveredCredits = 0;
    let latestBalance = null;
    for (const localPayment of pendingPayments || []) {
      try {
        const result = await reconcileLocalPayment(localPayment, user.id);
        if (result.status === "paid" && result.granted) {
          recoveredCredits += result.credits;
          latestBalance = result.balance;
        }
      } catch (error) {
        logger.warn("[Dodo Status] Could not reconcile pending payment", {
          localPaymentId: localPayment.id,
          error,
        });
      }
    }

    return NextResponse.json({
      status: recoveredCredits > 0 ? "paid" : "none",
      credits: recoveredCredits,
      balance: latestBalance,
    });
  } catch (error) {
    logger.error("[Dodo Status] Reconciliation failed", error);
    return NextResponse.json({ error: "Failed to confirm Dodo payment." }, { status: 500 });
  }
}
