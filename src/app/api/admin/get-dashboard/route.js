import { NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase";
import { enforceRateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const PROOF_BUCKET = "payment_proofs";
const PROOF_URL_TTL_SECONDS = 600;
const APPROVED_REQUEST_LIMIT = 100;

/**
 * The payment_proofs bucket is private (database/secure_payment_proofs.sql), so
 * the stored proof_url no longer resolves for anyone. It is still the stable
 * reference to the object, so derive the key from it and hand the admin a
 * short-lived signed URL instead. Rows written before that migration and rows
 * written after it both use the same public-format URL, so one path covers both.
 */
function proofObjectKey(proofUrl) {
  if (!proofUrl) return null;
  const marker = `/${PROOF_BUCKET}/`;
  const index = String(proofUrl).indexOf(marker);
  if (index === -1) return null;
  const key = decodeURIComponent(String(proofUrl).slice(index + marker.length).split("?")[0]);
  return key && !key.includes("..") ? key : null;
}

async function withSignedProofUrls(requests) {
  const keyed = requests
    .map((request) => ({ request, key: proofObjectKey(request.proof_url) }))
    .filter((entry) => entry.key);

  if (keyed.length === 0) return requests;

  const { data: signed, error } = await adminSupabase
    .storage
    .from(PROOF_BUCKET)
    .createSignedUrls(keyed.map((entry) => entry.key), PROOF_URL_TTL_SECONDS);

  if (error) {
    console.error("[Admin Dashboard] Could not sign payment proof URLs:", error);
  }

  const signedByKey = new Map();
  (signed || []).forEach((row, index) => {
    if (row?.signedUrl) signedByKey.set(keyed[index].key, row.signedUrl);
  });

  // Blank the stored URL when signing failed rather than returning the old
  // public one — it does not resolve any more and would look like a dead link.
  return requests.map((request) => {
    const key = proofObjectKey(request.proof_url);
    if (!key) return request;
    return { ...request, proof_url: signedByKey.get(key) || null };
  });
}

async function fetchPaymentRequestsByStatus(status, { limit } = {}) {
  const pageSize = 1000;
  let from = 0;
  const rows = [];

  while (true) {
    const remaining = Number.isFinite(limit) ? limit - rows.length : pageSize;
    if (remaining <= 0) return rows;

    const { data, error } = await adminSupabase
      .from('payment_requests')
      .select('*')
      .eq('status', status)
      .order('created_at', { ascending: false })
      .range(from, from + Math.min(pageSize, remaining) - 1);

    if (error) {
      throw error;
    }

    const page = data || [];
    rows.push(...page);

    if (page.length < pageSize) {
      return rows;
    }

    from += pageSize;
  }
}

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

async function fetchDashboardMetricsFallback() {
  const { count: projCount, error: projError } = await adminSupabase
    .from('projects')
    .select('*', { count: 'exact', head: true });

  if (projError) throw projError;

  return {
    totalProjects: projCount || 0,
    activeCreditsTotal: await fetchActiveCreditsTotal(),
    totalRevenue: null,
  };
}

async function fetchDashboardMetrics() {
  const { data, error } = await adminSupabase.rpc('get_admin_dashboard_metrics');
  if (error) {
    console.warn("[Admin Dashboard] Metrics RPC unavailable; using compatibility fallback:", error.message);
    return fetchDashboardMetricsFallback();
  }

  const row = Array.isArray(data) ? data[0] : data;
  return {
    totalProjects: Number(row?.total_projects || 0),
    activeCreditsTotal: Number(row?.active_credits_total || 0),
    totalRevenue: Number(row?.approved_gcash_revenue || 0),
  };
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

    // The admin email gate controls WHO can call this, not HOW OFTEN. This is
    // the most expensive query in the app — unbounded pagination plus up to 100
    // auth.admin.getUserById calls — and the dashboard polls it every 10s on top
    // of a realtime subscription. That is 6/min of legitimate traffic, so 30
    // leaves 5x headroom while capping a runaway client or a stolen session.
    const rateLimit = await enforceRateLimit({
      namespace: "api:admin-dashboard:user",
      identifier: user.id,
      max: 30,
      window: "60 s",
      windowMs: 60_000,
    });
    if (!rateLimit.success) return rateLimit.response;

    // Fetch manual GCash requests by status with explicit pagination.
    // Supabase otherwise caps result sets, which can hide pending payments once
    // the table grows.
    const [pendingRequests, approvedRequests] = await Promise.all([
      fetchPaymentRequestsByStatus('pending'),
      fetchPaymentRequestsByStatus('approved', { limit: APPROVED_REQUEST_LIMIT }),
    ]);
    const requests = await withSignedProofUrls([...pendingRequests, ...approvedRequests]);

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

    const metrics = await fetchDashboardMetrics();

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
      pendingRequestCount: pendingRequests.length,
      approvedRequestCount: approvedRequests.length,
      approvedRequestLimit: APPROVED_REQUEST_LIMIT,
      dodoPayments,
      totalProjects: metrics.totalProjects,
      activeCreditsTotal: metrics.activeCreditsTotal,
      totalRevenue: metrics.totalRevenue,
      reviews: reviews || [],
      paidUsers: paidUsers
    }, {
      headers: {
        "Cache-Control": "no-store, max-age=0"
      }
    });
  } catch (error) {
    console.error("Admin Dashboard Fetch Error:", error);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
