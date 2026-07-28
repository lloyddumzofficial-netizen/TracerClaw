import { NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase";
import { enforceRateLimit } from "@/lib/rateLimit";
import { getCreditPlan } from "@/lib/paymentPlans";
import { logger } from "@/lib/logger";
import { sendEmail } from "@/lib/email";

export async function POST(request) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const token = authHeader.replace('Bearer ', '').trim();

    const { data: { user }, error: authErr } = await adminSupabase.auth.getUser(token);
    const adminEmail = process.env.ADMIN_EMAIL;
    // Guard every side of the comparison. With ADMIN_EMAIL unset and an account
    // that has no email (anonymous / phone auth), `user.email !== adminEmail`
    // reduces to `undefined !== undefined` — false — and grants admin.
    const isAdmin = Boolean(
      adminEmail &&
      user?.email &&
      user.email.toLowerCase() === adminEmail.toLowerCase()
    );
    if (authErr || !isAdmin) {
      return NextResponse.json({ error: "Forbidden. Admin access required." }, { status: 403 });
    }

    // Credit-granting endpoint. The admin gate bounds who, not how often.
    const rateLimit = await enforceRateLimit({
      namespace: "api:admin-approve-payment:user",
      identifier: user.id,
      max: 30,
      window: "60 s",
      windowMs: 60_000,
    });
    if (!rateLimit.success) return rateLimit.response;

    const { requestId, markOnly } = await request.json();
    if (!requestId) {
      return NextResponse.json({ error: "Missing requestId" }, { status: 400 });
    }

    const { data: paymentRequest, error: fetchErr } = await adminSupabase
      .from('payment_requests')
      .select('*')
      .eq('id', requestId)
      .eq('status', 'pending')
      .single();

    if (fetchErr || !paymentRequest) {
      return NextResponse.json({ error: "Payment request not found or already approved." }, { status: 409 });
    }

    const plan = getCreditPlan(paymentRequest.plan);
    const creditsToAdd = plan?.credits || 0;
    if (!markOnly && creditsToAdd <= 0) {
      return NextResponse.json({ error: "Invalid payment plan." }, { status: 400 });
    }

    const { data: approvalRows, error: approvalErr } = await adminSupabase
      .rpc('approve_manual_payment_request', {
        payment_request_id: requestId,
        credits_to_add: creditsToAdd,
        mark_only: Boolean(markOnly),
      });
    const approval = Array.isArray(approvalRows) ? approvalRows[0] : approvalRows;

    if (approvalErr) {
      console.error("Failed to approve payment atomically:", approvalErr);
      return NextResponse.json({ error: "Failed to update credits." }, { status: 500 });
    }

    if (approval?.status !== 'approved') {
      return NextResponse.json({ error: "Payment request already approved." }, { status: 409 });
    }

    // We do not fail the request if email fails; credits were already added.
    if (!markOnly && approval.credited_email) {
      const emailResult = await sendEmail({
        to: approval.credited_email,
        subject: 'Payment Approved - Credits Added! 🎉',
        template: "creditsAdded",
        data: {
          plan: approval.credited_plan,
          credits: creditsToAdd,
          reference: approval.credited_reference || "N/A",
        },
      });

      if (!emailResult.success) {
        logger.warn("[Admin Approval] Failed to send email", {
          email: approval.credited_email,
          error: emailResult.error,
        });
      }
    }

    return NextResponse.json({ success: true, addedCredits: creditsToAdd });
  } catch (error) {
    console.error("Admin Approval Error:", error);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
