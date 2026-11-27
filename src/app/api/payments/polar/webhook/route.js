import { createHmac, timingSafeEqual } from "node:crypto";
import { adminSupabase } from "@/lib/supabase";

export const runtime = "nodejs";

function isSigned(payload, headers, secret) {
  const id = headers.get("webhook-id");
  const timestamp = headers.get("webhook-timestamp");
  const signatures = headers.get("webhook-signature");
  if (!id || !timestamp || !/^\d+$/.test(timestamp) || !signatures
    || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;

  const expected = createHmac("sha256", secret).update(id + "." + timestamp + "." + payload).digest();
  return signatures.split(" ").some((signature) => {
    const [version, encoded] = signature.split(",");
    if (version !== "v1" || !encoded) return false;
    const received = Buffer.from(encoded, "base64");
    return received.length === expected.length && timingSafeEqual(received, expected);
  });
}

export async function POST(request) {
  const secret = process.env.POLAR_WEBHOOK_SECRET;
  if (!secret) return Response.json({ error: "Webhook unavailable" }, { status: 503 });

  const body = await request.text();
  if (!isSigned(body, request.headers, secret)) {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }

  let event;
  try {
    event = JSON.parse(body);
  } catch {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  const order = event?.data;
  const paymentId = order?.metadata?.desaynclaw_payment;
  if (event?.type !== "order.paid" || !paymentId) return Response.json({ received: true });

  if (order.paid !== true || order.status !== "paid" || order.currency?.toLowerCase() !== "usd"
    || !order.id || !order.checkout_id || !order.product_id || !Number.isInteger(order.net_amount)) {
    return Response.json({ error: "Invalid paid order" }, { status: 400 });
  }

  const { error } = await adminSupabase.rpc("grant_polar_payment_credits", {
    payment_row_id: paymentId, provider_order_id: order.id, provider_checkout_id: order.checkout_id,
    provider_product_id: order.product_id, amount_before_tax: order.net_amount,
  });
  if (error) {
    console.error("[Polar Webhook] Fulfillment failed", error.code);
    return Response.json({ error: "Payment fulfillment failed" }, { status: 500 });
  }
  return Response.json({ received: true });
}
