import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await adminSupabase.auth.getUser(token);
    
    if (authError || !user) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }

    // Manual refund since RPC doesn't exist and DB cannot be migrated easily
    const { data: proj } = await adminSupabase.from('projects').select('generated_image_url').eq('id', projectId).single();
    if (proj && proj.generated_image_url !== 'REFUNDED') {
      const { data: profile } = await adminSupabase.from('profiles').select('credits').eq('id', user.id).single();
      if (profile) {
        await adminSupabase.from('profiles').update({ credits: profile.credits + 1 }).eq('id', user.id);
        await adminSupabase.from('projects').update({ generated_image_url: 'REFUNDED' }).eq('id', projectId);
      }
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
