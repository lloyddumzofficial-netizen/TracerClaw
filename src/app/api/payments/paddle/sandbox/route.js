import { adminSupabase } from "@/lib/supabase";
import { getBearerToken } from "@/lib/apiValidation";
import { grantSandboxClaws, priceIds } from "@/lib/paddleSandbox";
import { enforceRateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";

export async function POST(request) {
  if (process.env.NODE_ENV !== "development" || process.env.VERCEL ||
    !["localhost", "127.0.0.1"].includes(new URL(request.url).hostname) ||
    !process.env.PADDLE_SANDBOX_API_KEY || !process.env.PADDLE_SANDBOX_TEST_USER_ID) {
    return Response.json({ error: "Sandbox unavailable" }, { status: 404 });
  }
  const token = getBearerToken(request);
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { data: { user } } = await adminSupabase.auth.getUser(token);
  if (user?.id !== process.env.PADDLE_SANDBOX_TEST_USER_ID) {
    return Response.json({ error: "Sandbox test account required" }, { status: 403 });
  }
  const limit = await enforceRateLimit({
    namespace: "paddle-sandbox", identifier: user.id, max: 30, window: "1 m", windowMs: 60_000,
  });
  if (!limit.success) return Response.json({ error: "Too many sandbox requests" }, { status: 429 });

  const body = await request.json().catch(() => null);
  const checkout = body?.action === "checkout";
  const transactionId = body?.transactionId;
  const plan = checkout && Object.hasOwn(priceIds, body.plan) ? body.plan : null;
  if ((checkout && !plan) || (!checkout && (body?.action !== "fulfill" ||
    typeof transactionId !== "string" || !/^txn_[a-z0-9]{26}$/.test(transactionId)))) {
    return Response.json({ error: "Invalid sandbox request" }, { status: 400 });
  }

  try {
    const response = await fetch("https://sandbox-api.paddle.com/transactions" + (checkout ? "" : "/" + transactionId), {
      method: checkout ? "POST" : "GET",
      headers: { Authorization: "Bearer " + process.env.PADDLE_SANDBOX_API_KEY, "Content-Type": "application/json" },
      body: checkout ? JSON.stringify({
        items: [{ price_id: priceIds[plan], quantity: 1 }],
        currency_code: "USD",
        custom_data: { desaynclaw_sandbox_user: user.id, desaynclaw_plan: plan },
      }) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return Response.json({ error: "Paddle sandbox request failed" }, { status: 502 });
    const { data } = await response.json();
    if (checkout) return Response.json({ transactionId: data.id });
    if (data.custom_data?.desaynclaw_sandbox_user !== user.id || data.id !== transactionId) {
      return Response.json({ error: "Sandbox transaction not found" }, { status: 404 });
    }
    if (data.status !== "completed") return Response.json({ status: data.status });

    return await grantSandboxClaws(data, user.id);
  } catch (error) {
    console.error("[Paddle Sandbox]", error?.code || error?.name);
    return Response.json({ error: "Sandbox payment could not be processed" }, { status: 500 });
  }
}
