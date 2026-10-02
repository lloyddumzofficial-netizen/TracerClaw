import { NextResponse } from "next/server";
import { getDodoClient } from "@/lib/dodo";
import { logger } from "@/lib/logger";
import { fulfillDodoPayment, markDodoPaymentStatus } from "@/server/payments/dodoFulfillment";

export const runtime = "nodejs";

function getWebhookHeaders(request) {
  return {
    "webhook-id": request.headers.get("webhook-id") || "",
    "webhook-signature": request.headers.get("webhook-signature") || "",
    "webhook-timestamp": request.headers.get("webhook-timestamp") || "",
  };
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
      await fulfillDodoPayment({ payment: event.data, source: "webhook" });
    } else if (event.type === "payment.failed" || event.type === "payment.cancelled") {
      await markDodoPaymentStatus(event.data, "failed");
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    logger.error("[Dodo Webhook] Processing failed", error);
    return NextResponse.json({ error: "Invalid or failed webhook" }, { status: 400 });
  }
}
