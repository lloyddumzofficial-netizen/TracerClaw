import { NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase";
import { getDodoClient } from "@/lib/dodo";
import { getCreditPlan } from "@/lib/paymentPlans";
import { Resend } from "resend";

export const runtime = "nodejs";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

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

async function sendDodoPaymentEmail({ email, plan, credits, paymentId }) {
  if (!resend || !email) return;

  try {
    const htmlTemplate = `
      <div style="background-color: #1a1a1a; color: #ffffff; font-family: 'Inter', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 40px 20px; text-align: center;">
        <div style="max-width: 500px; margin: 0 auto; background-color: #262626; border: 1px solid #444444; padding: 40px 30px; border-radius: 8px;">
          <div style="text-align: center; margin-bottom: 24px;">
            <img src="https://desaynclaw.com/logo.png" alt="DesaynClaw Logo" style="max-width: 240px; height: auto; display: inline-block;" />
          </div>
          <hr style="border: 0; border-top: 1px solid #444; margin: 24px 0;">
          <h2 style="font-size: 20px; font-weight: 600; margin-bottom: 12px; color: #ffffff;">Payment Successful</h2>
          <p style="color: #cccccc; font-size: 15px; line-height: 1.6; margin-bottom: 30px;">
            Your Dodo payment was confirmed and your credits have been automatically added to your DesaynClaw account.
          </p>

          <div style="background-color: #1a1a1a; border: 1px solid #333333; padding: 20px; border-radius: 6px; margin-bottom: 30px; text-align: left;">
            <p style="margin: 0 0 10px 0; color: #888888; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;">Package Details</p>
            <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
              <span style="color: #aaaaaa; font-size: 14px;">Plan:</span>
              <strong style="color: #ffffff; text-transform: capitalize; font-size: 14px;">${plan}</strong>
            </div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
              <span style="color: #aaaaaa; font-size: 14px;">Credits Added:</span>
              <strong style="color: #FFD700; font-size: 15px;">+${credits} Traces</strong>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span style="color: #aaaaaa; font-size: 14px;">Payment ID:</span>
              <strong style="color: #ffffff; font-size: 14px;">${paymentId || "N/A"}</strong>
            </div>
          </div>

          <a href="https://desaynclaw.com" style="display: inline-block; background-color: #FFD700; color: #000000; text-decoration: none; padding: 14px 28px; font-weight: 700; border-radius: 4px; font-size: 15px;">
            Start Tracing Now
          </a>

          <p style="color: #666666; font-size: 12px; margin-top: 40px; line-height: 1.5;">
            If you have any questions or need help, just reply to this email.<br>
            &copy; 2026 DesaynClaw. All rights reserved.
          </p>
        </div>
      </div>
    `;

    await resend.emails.send({
      from: "DesaynClaw <hello@desaynclaw.com>",
      to: email,
      subject: "Payment Successful - Credits Added",
      html: htmlTemplate,
    });
    console.log(`[Dodo Webhook] Email sent to ${email}`);
  } catch (emailErr) {
    console.error("[Dodo Webhook] Failed to send payment email:", emailErr);
  }
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

  await sendDodoPaymentEmail({
    email: localPayment.email,
    plan: localPayment.plan,
    credits: grant.granted_credits,
    paymentId: payment.payment_id || null,
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
