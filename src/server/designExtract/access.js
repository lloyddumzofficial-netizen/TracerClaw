import { adminSupabase } from "@/lib/supabase";
import { enforceRateLimit } from "@/lib/rateLimit";

export async function requireDesignAdmin(request, mutate = false) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw Object.assign(new Error("Sign in required"), { status: 401 });
  const { data: { user }, error } = await adminSupabase.auth.getUser(token);
  if (error && (error.name === "AuthRetryableFetchError" || error.status === 0 || error.status >= 500)) throw Object.assign(new Error("Cannot reach the sign-in service. Check the server connection and retry."), { status: 503 });
  if (error || !user) throw Object.assign(new Error("Sign in required"), { status: 401 });
  if (!process.env.ADMIN_EMAIL || !user.email || user.email.toLowerCase() !== process.env.ADMIN_EMAIL.toLowerCase()) throw Object.assign(new Error("Admin beta only"), { status: 403 });
  if (process.env.DESIGN_EXTRACT_ENABLED !== "true") throw Object.assign(new Error("Design Extract beta is not enabled"), { status: 404 });
  const limit = await enforceRateLimit({ namespace: `design-extract:${mutate ? "write" : "read"}`, identifier: user.id, max: mutate ? 60 : 120, window: "60 s", windowMs: 60000 });
  if (!limit.success) throw Object.assign(new Error("Too many requests. Try again shortly."), { status: 429 });
  return user;
}
export function designError(error) {
  if (error.code === "P0001") return Response.json({ error: "Project changed or an operation is active. Reload before continuing." }, { status: 409 });
  if (["42P01", "PGRST205"].includes(error.code)) return Response.json({ error: "Design Extract database setup is required." }, { status: 503 });
  if (!error.status) console.error("[Design Extract]", error);
  return Response.json({ error: error.status ? error.message : "Design Extract request failed. Please retry." }, { status: error.status || 500 });
}
