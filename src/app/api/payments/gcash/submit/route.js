import { NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase";
import { getCreditPlan } from "@/lib/paymentPlans";
import { enforceRateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";

const MANUAL_BLOCK_DAYS = 7;

function normalizeReference(value) {
  return String(value || "").replace(/\s+/g, "").trim();
}

export async function POST(request) {
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

    const rateLimit = await enforceRateLimit({
      namespace: "gcash-submit",
      identifier: user.id,
      max: 5,
      window: "60 m",
      windowMs: 60 * 60_000,
    });
    if (!rateLimit.success) return rateLimit.response;

    const { plan: planKey, referenceNumber, proofUrl } = await request.json();
    const plan = getCreditPlan(planKey);
    const normalizedReference = normalizeReference(referenceNumber);

    if (!plan) {
      return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
    }
    if (!normalizedReference || !proofUrl) {
      return NextResponse.json({ error: "Missing GCash number/reference or proof of payment." }, { status: 400 });
    }

    const { data: pendingRequest, error: pendingErr } = await adminSupabase
      .from("payment_requests")
      .select("id, created_at")
      .eq("user_id", user.id)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (pendingErr) {
      console.error("[GCash Submit] Pending check failed:", pendingErr);
      return NextResponse.json({ error: "Failed to verify current payment status." }, { status: 500 });
    }

    if (pendingRequest) {
      return NextResponse.json(
        { error: "You already have a pending GCash request. Please wait for admin review before submitting again." },
        { status: 409 }
      );
    }

    const since = new Date(Date.now() - MANUAL_BLOCK_DAYS * 24 * 60 * 60_000).toISOString();
    const { data: duplicateApproved, error: duplicateErr } = await adminSupabase
      .from("payment_requests")
      .select("id, created_at")
      .eq("user_id", user.id)
      .eq("status", "approved")
      .eq("reference_number", normalizedReference)
      .gte("created_at", since)
      .limit(1)
      .maybeSingle();

    if (duplicateErr) {
      console.error("[GCash Submit] Duplicate reference check failed:", duplicateErr);
      return NextResponse.json({ error: "Failed to verify payment reference." }, { status: 500 });
    }

    if (duplicateApproved) {
      return NextResponse.json(
        {
          error: "This GCash reference was already approved and your credits have been added. Please check your balance. If you believe this is wrong, contact support.",
          alreadyApproved: true,
        },
        { status: 409 }
      );
    }

    const { data: paymentRequest, error: insertErr } = await adminSupabase
      .from("payment_requests")
      .insert({
        user_id: user.id,
        email: user.email,
        plan: plan.key,
        reference_number: normalizedReference,
        proof_url: proofUrl,
        status: "pending",
      })
      .select("id, created_at")
      .single();

    if (insertErr) {
      console.error("[GCash Submit] Insert failed:", insertErr);
      return NextResponse.json({ error: "Failed to submit payment request." }, { status: 500 });
    }

    return NextResponse.json({ success: true, requestId: paymentRequest?.id || null });
  } catch (error) {
    console.error("[GCash Submit] Error:", error);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
