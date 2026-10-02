import { adminSupabase } from "@/lib/supabase";
import { getDodoClient } from "@/lib/dodo";
import { getCreditPlan, getDodoProductId } from "@/lib/paymentPlans";
import { logger } from "@/lib/logger";
import { sendEmail } from "@/lib/email";
import { verifyDodoPayment } from "@/server/payments/verifyDodoPayment";

export function resolveDodoPaymentReference(payment) {
  const metadataId = payment?.metadata?.local_payment_id;
  if (metadataId) return { column: "id", value: metadataId };
  if (payment?.checkout_session_id) {
    return { column: "dodo_checkout_session_id", value: payment.checkout_session_id };
  }
  return null;
}

async function loadCompletePayment(payment) {
  if (Array.isArray(payment?.product_cart) && payment.product_cart.length > 0) {
    return payment;
  }
  if (!payment?.payment_id) return payment;

  const retrieved = await getDodoClient().payments.retrieve(payment.payment_id);
  return {
    ...retrieved,
    metadata: retrieved.metadata || payment.metadata,
    checkout_session_id: retrieved.checkout_session_id || payment.checkout_session_id,
  };
}

async function sendReceipt({ localPayment, credits, providerPaymentId }) {
  if (!localPayment.email) return;

  const result = await sendEmail({
    to: localPayment.email,
    subject: "Payment Successful - Credits Added",
    template: "purchaseReceipt",
    data: {
      plan: localPayment.plan,
      credits,
      receipt: providerPaymentId || "N/A",
      paymentId: providerPaymentId || "N/A",
    },
  });

  if (!result.success) {
    logger.warn("[Dodo Payment] Failed to send receipt", {
      localPaymentId: localPayment.id,
      error: result.error,
    });
  }
}

async function getBalance(userId) {
  const { data } = await adminSupabase
    .from("profiles")
    .select("credits")
    .eq("id", userId)
    .single();
  return Number.isFinite(data?.credits) ? data.credits : null;
}

export async function fulfillDodoPayment({ payment, localPayment: suppliedLocalPayment, source }) {
  const completePayment = await loadCompletePayment(payment);
  let localPayment = suppliedLocalPayment;

  if (!localPayment) {
    const query = resolveDodoPaymentReference(completePayment);
    if (!query) {
      throw new Error("Missing local payment reference in Dodo payment");
    }

    const { data, error } = await adminSupabase
      .from("dodo_payments")
      .select("*")
      .eq(query.column, query.value)
      .single();
    if (error || !data) throw new Error("Local Dodo payment record not found");
    localPayment = data;
  }

  const plan = getCreditPlan(localPayment.plan);
  if (!plan || plan.credits !== localPayment.credits || plan.amount !== localPayment.amount) {
    throw new Error("Local Dodo payment plan is invalid");
  }

  const verification = verifyDodoPayment(localPayment, completePayment, getDodoProductId(plan));
  logger.info("[Dodo Payment] Verified successful payment", {
    source,
    localPaymentId: localPayment.id,
    providerPaymentId: completePayment.payment_id,
    checkoutSessionId: completePayment.checkout_session_id,
    paidAmount: verification.paidAmount,
    paidCurrency: verification.paidCurrency,
    adaptiveCurrency: verification.adaptiveCurrency,
  });

  // The RPC receives the immutable local checkout amount/currency because it is
  // the final atomic guard. Provider evidence was verified above by exact product.
  const { data: grantRows, error: grantErr } = await adminSupabase.rpc(
    "grant_dodo_payment_credits",
    {
      payment_row_id: localPayment.id,
      provider_payment_id: completePayment.payment_id,
      provider_checkout_session_id:
        completePayment.checkout_session_id || localPayment.dodo_checkout_session_id || null,
      paid_amount: localPayment.amount,
      paid_currency: localPayment.currency,
    },
  );

  if (grantErr) {
    logger.error("[Dodo Payment] Failed to grant credits", {
      source,
      localPaymentId: localPayment.id,
      error: grantErr,
    });
    throw new Error("Failed to add credits");
  }

  const grant = Array.isArray(grantRows) ? grantRows[0] : grantRows;
  const granted = Boolean(grant?.granted);
  const grantedCredits = grant?.granted_credits ?? localPayment.credits;

  if (granted) {
    await sendReceipt({
      localPayment,
      credits: grantedCredits,
      providerPaymentId: completePayment.payment_id,
    });
  }

  return {
    status: "paid",
    granted,
    credits: grantedCredits,
    balance: await getBalance(localPayment.user_id),
  };
}

export async function markDodoPaymentStatus(payment, status) {
  const query = resolveDodoPaymentReference(payment);
  if (!query) return;

  const { error } = await adminSupabase
    .from("dodo_payments")
    .update({ status, dodo_payment_id: payment?.payment_id || null })
    .eq(query.column, query.value)
    .neq("status", "paid");

  if (error) {
    logger.warn("[Dodo Payment] Could not update payment status", { status, error });
  }
}
