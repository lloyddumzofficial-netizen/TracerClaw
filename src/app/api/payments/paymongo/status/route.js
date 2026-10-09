import { NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase";
import { getBearerToken, opaqueIdField, parseSearchParams } from "@/lib/apiValidation";

const statusQuerySchema = {
  paymentId: opaqueIdField({ message: "Missing or invalid payment id" }),
};

export const runtime = "nodejs";

export async function GET(request) {
  try {
    const token = getBearerToken(request);
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { data: { user }, error: authErr } = await adminSupabase.auth.getUser(token);
    if (authErr || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const parsed = parseSearchParams(request, statusQuerySchema);
    if (!parsed.ok) return parsed.response;
    const { paymentId } = parsed.data;

    const { data: payment, error } = await adminSupabase
      .from("paymongo_payments")
      .select("id, status, credited_at, credits")
      .eq("id", paymentId)
      .eq("user_id", user.id)
      .single();

    if (error || !payment) {
      return NextResponse.json({ error: "Payment not found" }, { status: 404 });
    }

    return NextResponse.json({
      status: payment.status,
      creditedAt: payment.credited_at,
      credits: payment.credits,
    });
  } catch (error) {
    console.error("[PayMongo Status] Error:", error);
    return NextResponse.json({ error: "Failed to check QRPh payment." }, { status: 500 });
  }
}
