import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase";
import { getCreditPlan } from "@/lib/paymentPlans";
import { logger } from "@/lib/logger";
import { sendEmail } from "@/lib/email";

export const runtime = "nodejs";

function verifyPayMongoSignature(rawBody, signatureHeader) {
  const webhookSecret = process.env.PAYMONGO_WEBHOOK_SECRET;
  if (!webhookSecret) return false;
  if (!signatureHeader) return false;

  const parts = Object.fromEntries(
    signatureHeader
      .split(",")
      .map((part) => part.trim().split("=").map((value) => value.trim()))
      .filter(([key, value]) => key && value)
  );
  const timestamp = parts.t;
  const signatures = [parts.te, parts.li].filter(Boolean);
  if (!timestamp || signatures.length === 0) return false;

  const expected = crypto
    .createHmac("sha256", webhookSecret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");

  try {
    const expectedBuffer = Buffer.from(expected);
    return signatures.some((signature) => {
      const signatureBuffer = Buffer.from(signature);
      return signatureBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
    });
  } catch {
    return false;
  }
}

function getEventType(payload) {
  return payload?.data?.attributes?.type || payload?.data?.type || payload?.type || "";
}

function getEventData(payload) {
  const attrs = payload?.data?.attributes;
  return attrs?.data || payload?.data?.data || payload?.data || null;
}

function resolveLocalPaymentQuery(eventData) {
  const attrs = eventData?.attributes || eventData || {};
  const metadataId = attrs?.metadata?.local_payment_id;
  if (metadataId) {
    return { column: "id", value: metadataId };
  }
  if (attrs?.reference_number) {
    return { column: "id", value: attrs.reference_number };
  }
  if (attrs?.payment_intent_id) {
    return { column: "paymongo_payment_intent_id", value: attrs.payment_intent_id };
  }
  if (eventData?.id && String(eventData.id).startsWith("pi_")) {
    return { column: "paymongo_payment_intent_id", value: eventData.id };
  }
  if (eventData?.id) {
    return { column: "paymongo_checkout_session_id", value: eventData.id };
  }
  return null;
}

function getProviderPayment(eventData) {
  const attrs = eventData?.attributes || eventData || {};
  const payments = Array.isArray(attrs.payments)
    ? attrs.payments
    : Array.isArray(attrs.payments?.data)
      ? attrs.payments.data
      : [];
  const payment = eventData?.id && String(eventData.id).startsWith("pay_") ? eventData : payments[0] || null;
  if (!payment) return { id: null, amount: null, currency: null };
  const paymentAttrs = payment.attributes || payment;
  return {
    id: payment.id || paymentAttrs.id || null,
    amount: Number.isFinite(paymentAttrs.amount) ? paymentAttrs.amount : null,
    currency: paymentAttrs.currency || null,
    intentId: paymentAttrs.payment_intent_id || null,
  };
}

async function sendPayMongoPaymentEmail({ email, plan, credits, paymentId }) {
  if (!email) return;

  const result = await sendEmail({
    to: email,
    subject: "QRPh Payment Successful - Credits Added",
    template: "purchaseReceipt",
    data: {
      plan,
      credits,
      receipt: paymentId || "QRPh",
      paymentId: paymentId || "QRPh",
    },
  });

  if (!result.success) {
    logger.warn("[PayMongo Webhook] Failed to send payment email", { email, error: result.error });
  }
}

async function markPaymentStatus(eventData, status) {
  const query = resolveLocalPaymentQuery(eventData);
  if (!query) return;

  await adminSupabase
    .from("paymongo_payments")
    .update({ status })
    .eq(query.column, query.value)
    .neq("status", "paid");
}

async function handlePaymentPaid(eventData) {
  const query = resolveLocalPaymentQuery(eventData);
  if (!query) {
    throw new Error("Missing local PayMongo payment reference");
  }

  const { data: localPayment, error: fetchErr } = await adminSupabase
    .from("paymongo_payments")
    .select("*")
    .eq(query.column, query.value)
    .single();

  if (fetchErr || !localPayment) {
    throw new Error("Local PayMongo payment record not found");
  }

  const plan = getCreditPlan(localPayment.plan);
  if (!plan || plan.credits !== localPayment.credits) {
    throw new Error("Local PayMongo payment plan is invalid");
  }

  const providerPayment = getProviderPayment(eventData);
  const { data: grantRows, error: grantErr } = await adminSupabase
    .rpc("grant_paymongo_payment_credits", {
      payment_row_id: localPayment.id,
      provider_payment_id: providerPayment.id,
      provider_checkout_session_id: eventData?.id && String(eventData.id).startsWith("cs_")
        ? eventData.id
        : localPayment.paymongo_checkout_session_id || null,
      paid_amount: providerPayment.amount || localPayment.amount,
      paid_currency: providerPayment.currency || localPayment.currency,
    });

  if (grantErr) {
    console.error("[PayMongo Webhook] Failed to grant credits:", grantErr);
    throw new Error("Failed to add QRPh credits");
  }

  const grant = Array.isArray(grantRows) ? grantRows[0] : grantRows;
  if (!grant?.granted) {
    return { alreadyProcessed: true };
  }

  if (providerPayment.intentId) {
    await adminSupabase
      .from("paymongo_payments")
      .update({ paymongo_payment_intent_id: providerPayment.intentId })
      .eq("id", localPayment.id);
  }

  await sendPayMongoPaymentEmail({
    email: localPayment.email,
    plan: localPayment.plan,
    credits: grant.granted_credits,
    paymentId: providerPayment.id,
  });

  return { credited: true, credits: grant.granted_credits };
}

export async function POST(request) {
  try {
    const rawBody = await request.text();
    const signatureHeader = request.headers.get("paymongo-signature") || "";

    if (!verifyPayMongoSignature(rawBody, signatureHeader)) {
      return NextResponse.json({ error: "Invalid webhook signature" }, { status: 400 });
    }

    const payload = JSON.parse(rawBody);
    const eventType = getEventType(payload);
    const eventData = getEventData(payload);

    if (eventType === "checkout_session.payment.paid" || eventType === "payment.paid") {
      await handlePaymentPaid(eventData);
    } else if (
      eventType === "checkout_session.payment.failed" ||
      eventType === "checkout_session.expired" ||
      eventType === "checkout_session.cancelled" ||
      eventType === "payment.failed" ||
      eventType === "qrph.expired"
    ) {
      await markPaymentStatus(eventData, "failed");
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("[PayMongo Webhook] Error:", error);
    return NextResponse.json({ error: "Invalid or failed PayMongo webhook" }, { status: 400 });
  }
}
