import { NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase";

export const runtime = "nodejs";

export async function GET(request) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = authHeader.replace("Bearer ", "").trim();
    const { data: { user }, error: authErr } = await adminSupabase.auth.getUser(token);
    if (authErr || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const paymentId = searchParams.get("paymentId");
    if (!paymentId) {
      return NextResponse.json({ error: "Missing payment id" }, { status: 400 });
    }

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
