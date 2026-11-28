import { createHmac, timingSafeEqual } from "node:crypto";
import { grantSandboxClaws } from "@/lib/paddleSandbox";

export const runtime = "nodejs";

function isSigned(body, header, secret) {
  const parts = (header ?? "").split(";").map(part => part.trim());
  const timestamp = parts.find(part => /^ts=\d{10}$/.test(part))?.slice(3);
  // The local sandbox host and Paddle can differ by more than a few seconds.
  // The ledger rejects repeat grants within this bounded signature window.
  if (!timestamp || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = createHmac("sha256", secret).update(timestamp + ":").update(body).digest();
  return parts.some(part => /^h1=[\da-f]{64}$/i.test(part) &&
    timingSafeEqual(expected, Buffer.from(part.slice(3), "hex")));
}

export async function POST(request) {
  const secret = process.env.PADDLE_SANDBOX_WEBHOOK_SECRET;
  const userId = process.env.PADDLE_SANDBOX_TEST_USER_ID;
  if (process.env.NODE_ENV !== "development" || process.env.VERCEL || !secret || !userId) {
    return Response.json({ error: "Sandbox unavailable" }, { status: 404 });
  }

  const body = Buffer.from(await request.arrayBuffer());
  if (!isSigned(body, request.headers.get("paddle-signature"), secret)) {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }

  let event;
  try {
    event = JSON.parse(body.toString("utf8"));
  } catch {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }
  const data = event?.data;
  if (event?.event_type !== "transaction.completed" ||
    data?.custom_data?.desaynclaw_sandbox_user !== userId) {
    return Response.json({ received: true });
  }
  if (data.status !== "completed" || typeof data.id !== "string" || !/^txn_[a-z0-9]{26}$/.test(data.id)) {
    return Response.json({ error: "Invalid completed transaction" }, { status: 400 });
  }

  try {
    return await grantSandboxClaws(data, userId);
  } catch (error) {
    console.error("[Paddle Sandbox Webhook]", error?.code || error?.name);
    return Response.json({ error: "Sandbox Claw grant failed" }, { status: 500 });
  }
}
