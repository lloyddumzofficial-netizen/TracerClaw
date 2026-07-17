import { NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase";
import { getDodoClient } from "@/lib/dodo";
import { getCreditPlan } from "@/lib/paymentPlans";

export const runtime = "nodejs";

function getWebhookHeaders(request) {
  return {
    "webhook-id": request.headers.get("webhook-id") || "",
    "webhook-signature": request.headers.get("webhook-signature") || "",
    "webhook-timestamp": request.headers.get("webhook-timestamp") || "",
  };
}

function resolveLocalPaymentQuery(payment) {
  const metadataId = payment?.metadata?.local_payment_id;
  if (metadataId) {
    return { column: "id", value: metadataId };
  }
  if (payment?.checkout_session_id) {
    return { column: "dodo_checkout_session_id", value: payment.checkout_session_id };
  }
  return null;
}

async function markPaymentStatus(payment, status) {
  const query = resolveLocalPaymentQuery(payment);
  if (!query) return;

  const update = {
    status,
    dodo_payment_id: payment?.payment_id || null,
    amount: Number.isFinite(payment?.total_amount) ? payment.total_amount : undefined,
    currency: payment?.currency || undefined,
  };

  await adminSupabase
    .from("dodo_payments")
    .update(update)
    .eq(query.column, query.value)
    .neq("status", "paid");
}

async function handlePaymentSucceeded(payment) {
  const query = resolveLocalPaymentQuery(payment);
  if (!query) {
    throw new Error("Missing local payment reference in Dodo payment metadata");
  }

  const { data: localPayment, error: fetchErr } = await adminSupabase
    .from("dodo_payments")
    .select("*")
    .eq(query.column, query.value)
    .single();

  if (fetchErr || !localPayment) {
    throw new Error("Local Dodo payment record not found");
  }

  const plan = getCreditPlan(localPayment.plan);
  if (!plan || plan.credits !== localPayment.credits) {
    throw new Error("Local Dodo payment plan is invalid");
  }

  const { data: grantRows, error: grantErr } = await adminSupabase
    .rpc("grant_dodo_payment_credits", {
      payment_row_id: localPayment.id,
      provider_payment_id: payment.payment_id || null,
      provider_checkout_session_id: payment.checkout_session_id || localPayment.dodo_checkout_session_id || null,
      paid_amount: Number.isFinite(payment.total_amount) ? payment.total_amount : localPayment.amount,
      paid_currency: payment.currency || localPayment.currency,
    });

  if (grantErr) {
    console.error("[Dodo Webhook] Failed to grant credits:", grantErr);
    throw new Error("Failed to add credits");
  }

  const grant = Array.isArray(grantRows) ? grantRows[0] : grantRows;
  if (!grant?.granted) {
    return { alreadyProcessed: true };
  }

  await adminSupabase.from("credit_logs").insert({
    user_id: grant.granted_user_id,
    action: "Top-Up via Dodo",
    amount: grant.granted_credits,
  });

  return { credited: true, credits: grant.granted_credits };
}

export async function POST(request) {
  try {
    const webhookSecret = process.env.DODO_PAYMENTS_WEBHOOK_SECRET;
    if (!webhookSecret) {
      return NextResponse.json({ error: "Webhook secret is not configured" }, { status: 500 });
    }

    const rawBody = await request.text();
    const client = getDodoClient();
    const event = client.webhooks.unwrap(rawBody, {
      headers: getWebhookHeaders(request),
      key: webhookSecret,
    });

    if (event.type === "payment.succeeded") {
      await handlePaymentSucceeded(event.data);
    } else if (event.type === "payment.failed" || event.type === "payment.cancelled") {
      await markPaymentStatus(event.data, "failed");
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("[Dodo Webhook] Error:", error);
    return NextResponse.json({ error: "Invalid or failed webhook" }, { status: 400 });
  }
}
