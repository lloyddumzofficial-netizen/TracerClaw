import { adminSupabase } from "@/lib/supabase";
import { getBearerToken } from "@/lib/apiValidation";

export async function GET(request) {
  const token = getBearerToken(request);
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { data: { user }, error: authError } = await adminSupabase.auth.getUser(token);
  if (authError || !user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const id = new URL(request.url).searchParams.get("paymentId");
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id || "")) {
    return Response.json({ error: "Invalid payment ID" }, { status: 400 });
  }
  const { data, error } = await adminSupabase.from("polar_payments")
    .select("credits, credited_at").eq("id", id).eq("user_id", user.id).maybeSingle();
  if (error) return Response.json({ error: "Could not confirm payment" }, { status: 500 });
  if (!data) return Response.json({ error: "Payment not found" }, { status: 404 });
  return Response.json(data.credited_at ? { status: "paid", credits: data.credits } : { status: "pending" });
}
