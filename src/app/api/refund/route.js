import { NextResponse } from "next/server";
import { adminSupabase, safeRefundCredit } from "@/lib/supabase";

export async function POST(request) {
  try {
    const { projectId } = await request.json();

    if (!projectId) {
      return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
    }

    // Verify who is making the request
    const authHeader = request.headers.get("authorization");
    if (!authHeader) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = authHeader.replace("Bearer ", "").trim();
    const { data: { user }, error: authError } = await adminSupabase.auth.getUser(token);
    
    if (authError || !user) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }

    // Fetch project — use shared adminSupabase singleton (no new DB connections per request)
    const { data: proj } = await adminSupabase
      .from('projects')
      .select('user_id, credit_deducted, refunded')
      .eq('id', projectId)
      .single();
    
    // Security check: only the project owner can request a refund
    if (!proj || proj.user_id !== user.id) {
      return NextResponse.json({ error: "Project not found or access denied" }, { status: 403 });
    }

    if (!proj.credit_deducted || proj.refunded) {
      return NextResponse.json({ error: "Project is not eligible for refund" }, { status: 409 });
    }

    const { data: chargeLog, error: chargeLogErr } = await adminSupabase
      .from('credit_logs')
      .select('id')
      .eq('user_id', user.id)
      .eq('amount', -1)
      .in('action', ['Extract & Vectorize', 'Background Removal', 'AI Upscale (4K)'])
      .limit(1)
      .maybeSingle();

    if (chargeLogErr || !chargeLog) {
      return NextResponse.json({ error: "No matching credit deduction record found" }, { status: 409 });
    }

    const { data: updatedProj, error: updateErr } = await adminSupabase
      .from('projects')
      .update({ generated_image_url: 'REFUNDED', refunded: true })
      .eq('id', projectId)
      .eq('user_id', user.id)
      .eq('credit_deducted', true)
      .eq('refunded', false)
      .select('user_id');

    if (updateErr) {
      throw updateErr;
    }
      
    if (updatedProj && updatedProj.length > 0) {
      await safeRefundCredit(user.id);
      await adminSupabase.from('credit_logs').insert({
        user_id: user.id,
        action: 'Refund',
        amount: 1
      });
    } else {
      console.log(`[Refund API] Project ${projectId} already refunded or invalid.`);
    }

    console.log(`[Refund API] ✅ Successfully processed refund for project ${projectId} (User: ${user.id})`);
    
    return NextResponse.json({ success: true, message: "Refund processed successfully" });

  } catch (error) {
    console.error(`[Refund API Error]:`, error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
