import { NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase";
import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

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

      // Log the transaction
      await adminSupabase.from('credit_logs').insert({
        user_id: paymentRequest.user_id,
        action: 'Top-Up via GCash',
        amount: creditsToAdd
      });
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

    // --- SEND EMAIL NOTIFICATION VIA RESEND ---
    if (!markOnly && resend && paymentRequest.email) {
      try {
        const htmlTemplate = `
          <div style="background-color: #1a1a1a; color: #ffffff; font-family: 'Inter', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 40px 20px; text-align: center;">
            <div style="max-width: 500px; margin: 0 auto; background-color: #262626; border: 1px solid #444444; padding: 40px 30px; border-radius: 8px;">
              <div style="text-align: center; margin-bottom: 24px;">
                <img src="https://desaynclaw.com/logo.png" alt="DesaynClaw Logo" style="max-width: 240px; height: auto; display: inline-block;" />
              </div>
              <hr style="border: 0; border-top: 1px solid #444; margin: 24px 0;">
              <h2 style="font-size: 20px; font-weight: 600; margin-bottom: 12px; color: #ffffff;">Payment Approved! 🎉</h2>
              <p style="color: #cccccc; font-size: 15px; line-height: 1.6; margin-bottom: 30px;">
                Good news! Your GCash payment has been verified and your credits have been successfully added to your account.
              </p>
              
              <div style="background-color: #1a1a1a; border: 1px solid #333333; padding: 20px; border-radius: 6px; margin-bottom: 30px; text-align: left;">
                <p style="margin: 0 0 10px 0; color: #888888; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;">Package Details</p>
                <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                  <span style="color: #aaaaaa; font-size: 14px;">Plan:</span>
                  <strong style="color: #ffffff; text-transform: capitalize; font-size: 14px;">${paymentRequest.plan}</strong>
                </div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                  <span style="color: #aaaaaa; font-size: 14px;">Credits Added:</span>
                  <strong style="color: #FFD700; font-size: 15px;">+${creditsToAdd} Traces</strong>
                </div>
                <div style="display: flex; justify-content: space-between;">
                  <span style="color: #aaaaaa; font-size: 14px;">Reference No:</span>
                  <strong style="color: #ffffff; font-size: 14px;">${paymentRequest.reference_number || 'N/A'}</strong>
                </div>
              </div>

              <a href="https://desaynclaw.com" style="display: inline-block; background-color: #FFD700; color: #000000; text-decoration: none; padding: 14px 28px; font-weight: 700; border-radius: 4px; font-size: 15px; transition: opacity 0.2s;">
                Start Tracing Now
              </a>
              
              <p style="color: #666666; font-size: 12px; margin-top: 40px; line-height: 1.5;">
                If you have any questions or need help, just reply to this email.<br>
                &copy; 2026 DesaynClaw. All rights reserved.
              </p>
            </div>
          </div>
        `;

        await resend.emails.send({
          from: 'DesaynClaw <hello@desaynclaw.com>',
          to: paymentRequest.email,
          subject: 'Payment Approved - Credits Added! 🎉',
          html: htmlTemplate,
        });
        console.log(`Email sent to ${paymentRequest.email}`);
      } catch (emailErr) {
        console.error("Failed to send email:", emailErr);
        // We do not fail the request if email fails, credits were already added.
      }
    }

    return NextResponse.json({ success: true, addedCredits: creditsToAdd });
  } catch (error) {
    console.error("Admin Approval Error:", error);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
