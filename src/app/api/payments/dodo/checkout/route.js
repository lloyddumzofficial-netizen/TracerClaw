import { NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase";
import { getCreditPlan, getDodoProductId } from "@/lib/paymentPlans";
import { getDodoClient, getSiteUrl } from "@/lib/dodo";
import { enforceRateLimit } from "@/lib/rateLimit";
import { getBearerToken, parseJsonRequest, stringField } from "@/lib/apiValidation";

const checkoutSchema = {
  plan: stringField({
    maxLength: 32,
    pattern: /^[a-z]+$/,
    normalize: (value) => value.trim().toLowerCase(),
    message: "Invalid plan",
  }),
};

export const runtime = "nodejs";

export async function POST(request) {
  try {
    const token = getBearerToken(request);
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { data: { user }, error: authErr } = await adminSupabase.auth.getUser(token);
    if (authErr || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rateLimit = await enforceRateLimit({
      namespace: "dodo-checkout",
      identifier: user.id,
      max: 10,
      window: "10 m",
      windowMs: 10 * 60_000,
    });
    if (!rateLimit.success) {
      return NextResponse.json({ error: "Too many checkout attempts. Please try again later." }, { status: 429 });
    }

    const parsed = await parseJsonRequest(request, checkoutSchema, { allowUnknown: false });
    if (!parsed.ok) return parsed.response;

    const plan = getCreditPlan(parsed.data.plan);
    if (!plan) {
      return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
    }
    if (!plan.dodoEnabled) {
      return NextResponse.json({ error: "This package is available through automatic QR Ph payment only." }, { status: 400 });
    }

    const productId = getDodoProductId(plan);
    if (!productId) {
      return NextResponse.json({ error: `${plan.dodoProductEnv} is not configured` }, { status: 500 });
    }

    const { data: localPayment, error: insertErr } = await adminSupabase
      .from("dodo_payments")
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
      console.error("[Dodo Checkout] Failed to create local payment:", insertErr);
      return NextResponse.json({ error: "Failed to prepare checkout" }, { status: 500 });
    }

    const siteUrl = getSiteUrl(request);
    const client = getDodoClient();
    const session = await client.checkoutSessions.create({
      product_cart: [{ product_id: productId, quantity: 1 }],
      customer: {
        email: user.email,
        name: user.user_metadata?.full_name || user.email?.split("@")[0] || "DesaynClaw User",
      },
      metadata: {
        local_payment_id: localPayment.id,
        user_id: user.id,
        plan: plan.key,
        credits: String(plan.credits),
      },
      return_url: `${siteUrl}/?topup=dodo-return&paymentId=${encodeURIComponent(localPayment.id)}`,
      cancel_url: `${siteUrl}/?topup=dodo-cancelled&paymentId=${encodeURIComponent(localPayment.id)}`,
    });

    const checkoutUrl = session.checkout_url;
    if (!checkoutUrl) {
      await adminSupabase
        .from("dodo_payments")
        .update({ status: "failed" })
        .eq("id", localPayment.id)
        .eq("user_id", user.id);
      return NextResponse.json({ error: "Dodo checkout did not return a checkout URL" }, { status: 502 });
    }

    await adminSupabase
      .from("dodo_payments")
      .update({ dodo_checkout_session_id: session.session_id })
      .eq("id", localPayment.id)
      .eq("user_id", user.id);

    return NextResponse.json({ checkoutUrl });
  } catch (error) {
    console.error("[Dodo Checkout] Error:", error);
    return NextResponse.json({ error: "Failed to create Dodo checkout." }, { status: 500 });
  }
}
