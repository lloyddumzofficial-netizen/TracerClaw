import { adminSupabase } from "@/lib/supabase";
import { designRateLimit as enforceRateLimit } from "./rateLimit";
import { designBillingMode } from "./billing";

export function canReconcileDesignSubmission(user) {
  return Boolean(process.env.ADMIN_EMAIL && user.email?.toLowerCase() === process.env.ADMIN_EMAIL.toLowerCase());
}

export async function requireDesignUser(request, mutate = false) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw Object.assign(new Error("Sign in required"), { status: 401, designExtractError: true });
  const { data: { user }, error } = await adminSupabase.auth.getUser(token);
  if (error && (error.name === "AuthRetryableFetchError" || error.status === 0 || error.status >= 500)) throw Object.assign(new Error("Cannot reach the sign-in service. Check the server connection and retry."), { status: 503, designExtractError: true });
  if (error || !user) throw Object.assign(new Error("Sign in required"), { status: 401, designExtractError: true });
  if (process.env.DESIGN_EXTRACT_ENABLED !== "true") throw Object.assign(new Error("Design Extract is not available"), { status: 404, designExtractError: true });
  if (designBillingMode() !== "paid") {
    if (process.env.VERCEL_ENV === "production") throw Object.assign(new Error("Design Extract billing is not configured"), { status: 503, designExtractError: true });
    if (!canReconcileDesignSubmission(user)) throw Object.assign(new Error("Administrator access required for free testing"), { status: 403, designExtractError: true });
  }
  const limit = await enforceRateLimit({ namespace: `design-extract:${mutate ? "write" : "read"}`, identifier: user.id, max: mutate ? 60 : 120, window: "60 s", windowMs: 60000 });
  if (!limit.success) throw Object.assign(new Error("Too many requests. Try again shortly."), { status: 429, designExtractError: true });
  return user;
}
export function designError(error) {
  if (error.code === "P0001") return Response.json({ error: "Project changed or an operation is active. Reload before continuing." }, { status: 409 });
  if (["42P01", "42703", "PGRST202", "PGRST204", "PGRST205"].includes(error.code)) return Response.json({ error: "Design Extract database setup is required." }, { status: 503 });
  if (error.designExtractError) return Response.json({
    error: error.message,
    ...(error.code === "DESIGN_FINISH_UNLOCK_REQUIRED" && { code: error.code }),
  }, { status: error.status || 400 });
  console.error("[Design Extract] Request failed", { code: error.code || null, status: error.status || null });
  return Response.json({ error: "Design Extract request failed. Please retry." }, { status: Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? error.status : 500 });
}
