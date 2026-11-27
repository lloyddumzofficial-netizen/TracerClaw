import { adminSupabase } from "@/lib/supabase";
import { enforceRateLimit } from "@/lib/rateLimit";
import { getBearerToken, parseJsonRequest, stringField } from "@/lib/apiValidation";
import { POLAR_CREDIT_PLANS } from "@/lib/paymentPlans";

export const runtime = "nodejs";

export async function POST(request) {
  const token = getBearerToken(request);
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { data: { user }, error } = await adminSupabase.auth.getUser(token);
    if (error || !user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const limit = await enforceRateLimit({
      namespace: "polar-checkout", identifier: user.id, max: 10, window: "10 m", windowMs: 600_000,
    });
    if (!limit.success) return Response.json({ error: "Too many checkout attempts." }, { status: 429 });

    const parsed = await parseJsonRequest(request, {
      plan: stringField({ maxLength: 32, pattern: /^(basic|starter|pro)$/ }),
    }, { allowUnknown: false });
    if (!parsed.ok) return parsed.response;

    const plan = POLAR_CREDIT_PLANS[parsed.data.plan];
    const productId = process.env[plan.productEnv];
    const accessToken = process.env.POLAR_ACCESS_TOKEN;
    if (!productId || !accessToken || !process.env.POLAR_WEBHOOK_SECRET || process.env.POLAR_CHECKOUT_ENABLED !== "true") {
      return Response.json({ error: "Card checkout is temporarily unavailable." }, { status: 503 });
    }

    const { data: payment, error: insertError } = await adminSupabase.from("polar_payments").insert({
      user_id: user.id, product_id: productId, amount: plan.amount, credits: plan.credits,
    }).select("id").single();
    if (insertError) throw insertError;

    const sandbox = process.env.POLAR_ENVIRONMENT === "sandbox";
    const api = sandbox ? "https://sandbox-api.polar.sh" : "https://api.polar.sh";
    const siteUrl = new URL(process.env.NEXT_PUBLIC_SITE_URL || request.url).origin;
    const response = await fetch(api + "/v1/checkouts/", {
      method: "POST",
      headers: { Authorization: "Bearer " + accessToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        products: [productId],
        allow_discount_codes: false,
        customer_email: user.email,
        metadata: { desaynclaw_payment: payment.id },
        success_url: siteUrl + "/?topup=polar-return&paymentId=" + payment.id,
        return_url: siteUrl + "/",
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      console.error("[Polar Checkout] Provider status", response.status);
      return Response.json({ error: "Polar checkout is temporarily unavailable." }, { status: 502 });
    }

    const session = await response.json();
    const checkout = new URL(session.url);
    if (checkout.protocol !== "https:" || !["polar.sh", "sandbox.polar.sh", "checkout.polar.sh"].includes(checkout.hostname)
      || session.amount !== plan.amount || session.currency?.toLowerCase() !== "usd" || !session.id) {
      throw new Error("Invalid Polar checkout session");
    }
    const { error: saveError } = await adminSupabase.from("polar_payments")
      .update({ checkout_id: session.id }).eq("id", payment.id);
    if (saveError) throw saveError;

    return Response.json({ checkoutUrl: checkout.href });
  } catch (error) {
    console.error("[Polar Checkout]", error instanceof Error ? error.name : error?.code);
    return Response.json({ error: "Failed to create Polar checkout." }, { status: 500 });
  }
}
