import { NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase";

const PLAN_CREDITS = {
  tingi: 2,
  basic: 4,
  starter: 13,
  pro: 45
};

export async function POST(request) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const token = authHeader.replace('Bearer ', '').trim();

    const { data: { user }, error: authErr } = await adminSupabase.auth.getUser(token);
    const adminEmail = process.env.ADMIN_EMAIL;
    if (authErr || !user || user.email !== adminEmail) {
      return NextResponse.json({ error: "Forbidden. Admin access required." }, { status: 403 });
    }

    const { requestId, markOnly } = await request.json();
    if (!requestId) {
      return NextResponse.json({ error: "Missing requestId" }, { status: 400 });
    }

    // Fetch the payment request
    const { data: paymentRequest, error: fetchErr } = await adminSupabase
      .from('payment_requests')
      .select('*')
      .eq('id', requestId)
      .single();

    if (fetchErr || !paymentRequest) {
      return NextResponse.json({ error: "Payment request not found." }, { status: 404 });
    }

    if (paymentRequest.status === 'approved') {
      return NextResponse.json({ error: "Payment request already approved." }, { status: 400 });
    }

    const creditsToAdd = PLAN_CREDITS[paymentRequest.plan] || 0;

    if (!markOnly) {
      // Fetch the user's current profile to update credits
      const { data: profile, error: profileErr } = await adminSupabase
        .from('profiles')
        .select('credits')
        .eq('id', paymentRequest.user_id)
        .single();

      if (profileErr || !profile) {
        return NextResponse.json({ error: "User profile not found." }, { status: 404 });
      }

      // Update the profile with new credits
      const { error: updateProfileErr } = await adminSupabase
        .from('profiles')
        .update({ credits: profile.credits + creditsToAdd })
        .eq('id', paymentRequest.user_id);

      if (updateProfileErr) {
        console.error("Failed to update credits:", updateProfileErr);
        return NextResponse.json({ error: "Failed to update credits." }, { status: 500 });
      }
    }

    // Update the payment request status to approved
    const { error: updateRequestErr } = await adminSupabase
      .from('payment_requests')
      .update({ status: 'approved' })
      .eq('id', requestId);

    if (updateRequestErr) {
      console.error("Failed to update payment request status:", updateRequestErr);
      return NextResponse.json({ error: "Credits added, but failed to update request status." }, { status: 500 });
    }

    return NextResponse.json({ success: true, addedCredits: creditsToAdd });
  } catch (error) {
    console.error("Admin Approval Error:", error);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
