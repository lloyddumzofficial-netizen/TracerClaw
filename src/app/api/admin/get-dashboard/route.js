import { NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase";

async function fetchActiveCreditsTotal() {
  const pageSize = 1000;
  let from = 0;
  let total = 0;

  while (true) {
    const { data, error } = await adminSupabase
      .from('profiles')
      .select('credits')
      .gt('credits', 0)
      .range(from, from + pageSize - 1);

    if (error) {
      throw error;
    }

    const rows = data || [];
    total += rows.reduce((sum, row) => sum + Number(row.credits || 0), 0);

    if (rows.length < pageSize) {
      return total;
    }

    from += pageSize;
  }
}

export async function GET(request) {
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

    // Fetch all payment requests (Bypasses RLS using Service Role Key)
    const { data: requests, error: reqError } = await adminSupabase
      .from('payment_requests')
      .select('*')
      .order('created_at', { ascending: false });

    if (reqError) {
      throw reqError;
    }

    let dodoPayments = [];
    try {
      const { data: dodoRows, error: dodoErr } = await adminSupabase
        .from('dodo_payments')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      if (dodoErr) {
        console.error("Failed to fetch Dodo payments:", dodoErr);
      } else {
        dodoPayments = dodoRows || [];
      }
    } catch (dodoFetchErr) {
      console.error("Error fetching Dodo payments:", dodoFetchErr);
    }

    // Fetch total generations (projects) count
    const { count: projCount, error: projError } = await adminSupabase
      .from('projects')
      .select('*', { count: 'exact', head: true });

    if (projError) {
      throw projError;
    }

    // Fetch recent reviews (projects with a rating)
    const { data: reviews, error: reviewError } = await adminSupabase
      .from('projects')
      .select('id, name, rating, feedback_text, created_at')
      .not('rating', 'is', null)
      .order('created_at', { ascending: false })
      .limit(20);

    if (reviewError) {
      console.error("Failed to fetch reviews:", reviewError);
    }

    const activeCreditsTotal = await fetchActiveCreditsTotal();

    // Fetch users with credits (SCALABLE APPROACH)
    let paidUsers = [];
    try {
      // 1. Fetch only profiles with credits > 0 directly from DB (limits memory usage)
      // Capped at top 100 to ensure the admin dashboard never freezes at scale
      const { data: profiles, error: profErr } = await adminSupabase
        .from('profiles')
        .select('id, credits')
        .gt('credits', 0)
        .order('credits', { ascending: false })
        .limit(100);

      if (!profErr && profiles && profiles.length > 0) {
        const userIds = profiles.map(p => p.id);

        // 2. Fast bulk mapping: Get emails from payment history
        const { data: reqs } = await adminSupabase
          .from('payment_requests')
          .select('user_id, email, created_at')
          .in('user_id', userIds);

        const emailMap = {};
        const joinMap = {};

        if (reqs) {
          reqs.forEach(r => {
            if (r.email) emailMap[r.user_id] = r.email;
            if (!joinMap[r.user_id] || new Date(r.created_at) < new Date(joinMap[r.user_id])) {
              joinMap[r.user_id] = r.created_at;
            }
          });
        }

        // 3. Fallback for any users without a payment record (e.g. free initial credits)
        const missingEmailIds = userIds.filter(id => !emailMap[id]);
        if (missingEmailIds.length > 0) {
          await Promise.all(
            missingEmailIds.map(async (id) => {
              const { data: authData } = await adminSupabase.auth.admin.getUserById(id);
              if (authData && authData.user) {
                emailMap[id] = authData.user.email;
                joinMap[id] = authData.user.created_at;
              }
            })
          );
        }

        // 4. Assemble the final list
        paidUsers = profiles.map(p => ({
          id: p.id,
          email: emailMap[p.id] || "Unknown User",
          credits: p.credits,
          created_at: joinMap[p.id] || new Date().toISOString()
        }));
      }
    } catch(e) {
      console.error("Error fetching paid users list", e);
    }

    return NextResponse.json({
      success: true,
      requests: requests || [],
      dodoPayments,
      totalProjects: projCount || 0,
      activeCreditsTotal,
      reviews: reviews || [],
      paidUsers: paidUsers
    });
  } catch (error) {
    console.error("Admin Dashboard Fetch Error:", error);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
