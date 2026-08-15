import { NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase";
import { getCreditPlan } from "@/lib/paymentPlans";
import { enforceRateLimit } from "@/lib/rateLimit";
import { getPayMongoAuthHeader } from "@/lib/paymongo";

export const runtime = "nodejs";

export async function POST(request) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = authHeader.replace("Bearer ", "").trim();
    const { data: { user }, error: authErr } = await adminSupabase.auth.getUser(token);
    if (authErr || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rateLimit = await enforceRateLimit({
      namespace: "paymongo-checkout",
      identifier: user.id,
      max: 10,
      window: "10 m",
      windowMs: 10 * 60_000,
    });
    if (!rateLimit.success) {
      return NextResponse.json({ error: "Too many checkout attempts. Please try again later." }, { status: 429 });
    }

    const { plan: planKey } = await request.json();
    const plan = getCreditPlan(planKey);
    if (!plan) {
      return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
    }
    const payMongoAuthHeader = getPayMongoAuthHeader();

    const { data: localPayment, error: insertErr } = await adminSupabase
      .from("paymongo_payments")
      .insert({
        user_id: user.id,
        email: user.email,
        plan: plan.key,
        credits: plan.credits,
        amount: plan.amount,
        currency: plan.currency,
        status: "pending",
      })
      .select("*")
      .single();

    if (insertErr || !localPayment) {
      console.error("[PayMongo Checkout] Failed to create local payment:", insertErr);
      return NextResponse.json({ error: "Failed to prepare QRPh payment" }, { status: 500 });
    }

    const paymentIntentResponse = await fetch("https://api.paymongo.com/v1/payment_intents", {
      method: "POST",
      headers: {
        Authorization: payMongoAuthHeader,
        "Content-Type": "application/json",
        "Idempotency-Key": localPayment.id,
      },
      body: JSON.stringify({
        data: {
          attributes: {
            amount: plan.amount,
            currency: plan.currency,
            description: `DesaynClaw ${plan.label} - ${plan.credits} Claws`,
            statement_descriptor: "DESAYNCLAW",
            payment_method_allowed: ["qrph"],
            metadata: {
              local_payment_id: localPayment.id,
              user_id: user.id,
              plan: plan.key,
              credits: String(plan.credits),
            },
          },
        },
      }),
    });

    const paymentIntentPayload = await paymentIntentResponse.json().catch(() => ({}));
    const paymentIntent = paymentIntentPayload?.data;
    const paymentIntentId = paymentIntent?.id;
    const clientKey = paymentIntent?.attributes?.client_key;

    if (!paymentIntentResponse.ok || !paymentIntentId || !clientKey) {
      await adminSupabase
        .from("paymongo_payments")
        .update({ status: "failed" })
        .eq("id", localPayment.id)
        .eq("user_id", user.id);

      const message = paymentIntentPayload?.errors?.[0]?.detail || "PayMongo did not create a QRPh payment";
      return NextResponse.json({ error: message }, { status: paymentIntentResponse.ok ? 502 : paymentIntentResponse.status });
    }

    const paymentMethodResponse = await fetch("https://api.paymongo.com/v1/payment_methods", {
      method: "POST",
      headers: {
        Authorization: payMongoAuthHeader,
        "Content-Type": "application/json",
        "Idempotency-Key": `${localPayment.id}-qrph-method`,
      },
      body: JSON.stringify({
        data: {
          attributes: {
            type: "qrph",
            billing: {
              email: user.email,
              name: user.user_metadata?.full_name || user.email?.split("@")[0] || "DesaynClaw User",
            },
          },
        },
      }),
    });

    const paymentMethodPayload = await paymentMethodResponse.json().catch(() => ({}));
    const paymentMethodId = paymentMethodPayload?.data?.id;

    if (!paymentMethodResponse.ok || !paymentMethodId) {
      await adminSupabase
        .from("paymongo_payments")
        .update({
          status: "failed",
          paymongo_payment_intent_id: paymentIntentId,
        })
        .eq("id", localPayment.id)
        .eq("user_id", user.id);

      const message = paymentMethodPayload?.errors?.[0]?.detail || "PayMongo did not prepare QRPh payment method";
      return NextResponse.json({ error: message }, { status: paymentMethodResponse.ok ? 502 : paymentMethodResponse.status });
    }

    const attachResponse = await fetch(`https://api.paymongo.com/v1/payment_intents/${paymentIntentId}/attach`, {
      method: "POST",
      headers: {
        Authorization: payMongoAuthHeader,
        "Content-Type": "application/json",
        "Idempotency-Key": `${localPayment.id}-qrph-attach`,
      },
      body: JSON.stringify({
        data: {
          attributes: {
            payment_method: paymentMethodId,
            client_key: clientKey,
          },
        },
      }),
    });

    const attachPayload = await attachResponse.json().catch(() => ({}));
    const attachedAttrs = attachPayload?.data?.attributes || {};
    const qrCode = attachedAttrs?.next_action?.code || {};
    const qrImageUrl = qrCode?.image_url;

    if (!attachResponse.ok || !qrImageUrl) {
      await adminSupabase
        .from("paymongo_payments")
        .update({
          status: "failed",
          paymongo_payment_intent_id: paymentIntentId,
          paymongo_payment_method_id: paymentMethodId,
        })
        .eq("id", localPayment.id)
        .eq("user_id", user.id);

      const message = attachPayload?.errors?.[0]?.detail || "PayMongo did not return a QRPh code";
      return NextResponse.json({ error: message }, { status: attachResponse.ok ? 502 : attachResponse.status });
    }

    await adminSupabase
      .from("paymongo_payments")
      .update({
        paymongo_payment_intent_id: paymentIntentId,
        paymongo_payment_method_id: paymentMethodId,
      })
      .eq("id", localPayment.id)
      .eq("user_id", user.id);

    return NextResponse.json({
      localPaymentId: localPayment.id,
      qrImageUrl,
      amount: plan.amount,
      currency: plan.currency,
      expiresAt: qrCode?.expires_at || null,
    });
  } catch (error) {
    console.error("[PayMongo Checkout] Error:", error);
    return NextResponse.json({ error: "Failed to create QRPh payment." }, { status: 500 });
  }
}
