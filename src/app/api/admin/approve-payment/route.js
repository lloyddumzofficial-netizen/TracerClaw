import { NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase";
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

    const { data: claimedRequest, error: claimErr } = await adminSupabase
      .from('payment_requests')
      .update({ status: 'approved' })
      .eq('id', requestId)
      .eq('status', 'pending')
      .select('*')
      .single();

    if (claimErr || !claimedRequest) {
      return NextResponse.json({ error: "Payment request already approved." }, { status: 409 });
    }

    if (!markOnly) {
      const { error: updateProfileErr } = await adminSupabase
        .rpc('increment_credits', { user_id: claimedRequest.user_id, amount: creditsToAdd });

      if (updateProfileErr) {
        console.error("Failed to update credits:", updateProfileErr);
        await adminSupabase
          .from('payment_requests')
          .update({ status: 'pending' })
          .eq('id', requestId)
          .eq('status', 'approved');
        return NextResponse.json({ error: "Failed to update credits." }, { status: 500 });
      }

      // Log the transaction
      await adminSupabase.from('credit_logs').insert({
        user_id: claimedRequest.user_id,
        action: 'Top-Up via GCash',
        amount: creditsToAdd
      });
    }

    // We do not fail the request if email fails; credits were already added.
    if (!markOnly && claimedRequest.email) {
      const emailResult = await sendEmail({
        to: claimedRequest.email,
        subject: 'Payment Approved - Credits Added! 🎉',
        template: "creditsAdded",
        data: {
          plan: claimedRequest.plan,
          credits: creditsToAdd,
          reference: claimedRequest.reference_number || "N/A",
        },
      });

      if (!emailResult.success) {
        logger.warn("[Admin Approval] Failed to send email", {
          email: claimedRequest.email,
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
