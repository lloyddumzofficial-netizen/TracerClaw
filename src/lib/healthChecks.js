import { adminSupabase } from "@/lib/supabase";

/**
 * Runtime assertions about the environment and database schema.
 *
 * These exist because production silently diverged from the repository twice:
 * setup_refunds.sql was never applied (so credit_deducted/refunded did not
 * exist and refunds never worked for anyone), and RLS was never enabled on
 * public.projects (so 2,443 rows were world-readable and world-deletable).
 * Neither was noticed because nothing ever checked.
 *
 * Everything here is read-only and safe to run on every request to /api/health.
 */

/** Env vars the app cannot function correctly without. */
export const REQUIRED_ENV = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_ACCESS_KEY_ID",
  "CLOUDFLARE_SECRET_ACCESS_KEY",
  "CLOUDFLARE_BUCKET_NAME",
  "CLOUDFLARE_PUBLIC_URL",
  "FAL_KEY",
];

/**
 * Env vars whose absence degrades a feature rather than breaking the app.
 * Listed so a missing one shows up as a warning instead of vanishing silently.
 */
export const OPTIONAL_ENV = [
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "OPENROUTER_API_KEY",
  "VECTORIZER_API_ID",
  "VECTORIZER_API_SECRET",
  "RECRAFT_API_KEY",
  "RESEND_API_KEY",
  "CRON_SECRET",
  "ADMIN_EMAIL",
  "DODO_PAYMENTS_API_KEY",
  "DODO_PAYMENTS_ENVIRONMENT",
  "DODO_PAYMENTS_WEBHOOK_SECRET",
  "DODO_PRODUCT_TINGI",
  "DODO_PRODUCT_BASIC",
  "DODO_PRODUCT_STARTER",
  "DODO_PRODUCT_PRO",
  "NEXT_PUBLIC_GA4_MEASUREMENT_ID",
  "NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION",
  "NEXT_PUBLIC_CLARITY_PROJECT_ID",
  "NEXT_PUBLIC_POSTHOG_KEY",
  "NEXT_PUBLIC_POSTHOG_HOST",
  "NEXT_PUBLIC_SENTRY_DSN",
  "NEXT_PUBLIC_SENTRY_ENVIRONMENT",
  "NEXT_PUBLIC_SENTRY_RELEASE",
  "NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE",
  "NEXT_PUBLIC_SENTRY_REPLAYS_SESSION_SAMPLE_RATE",
  "NEXT_PUBLIC_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE",
  "SENTRY_AUTH_TOKEN",
  "NEXT_PUBLIC_MAINTENANCE_MODE",
  "LOG_LEVEL",
];

/** Columns the billing and refund logic depends on, per table. */
export const REQUIRED_COLUMNS = {
  projects: [
    "id", "user_id", "name", "trace_type", "ai_prompt",
    "original_image_url", "generated_image_url", "upscaled_image_url", "svg_url",
    "credit_deducted", "refunded", "failed_at", "failed_step",
  ],
  profiles: ["id", "email", "credits"],
  credit_logs: ["user_id", "action", "amount"],
};

export function checkEnv() {
  const missingRequired = REQUIRED_ENV.filter((k) => !process.env[k]);
  const missingOptional = OPTIONAL_ENV.filter((k) => !process.env[k]);
  return {
    ok: missingRequired.length === 0,
    missingRequired,
    missingOptional,
  };
}

export function validateProductionEnv() {
  if (process.env.NODE_ENV !== "production") return;
  const env = checkEnv();
  if (!env.ok) {
    throw new Error(`Missing required production environment variables: ${env.missingRequired.join(", ")}`);
  }
}

/**
 * Verify each required column exists by selecting it. PostgREST returns
 * "column ... does not exist" for anything missing, which is exactly the
 * failure that went unnoticed for months.
 */
export async function checkSchema() {
  const results = {};
  let ok = true;

  for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
    const { error } = await adminSupabase.from(table).select(columns.join(",")).limit(1);
    if (error) {
      ok = false;
      results[table] = { ok: false, error: error.message };
    } else {
      results[table] = { ok: true, columns: columns.length };
    }
  }

  return { ok, tables: results };
}

/**
 * Confirm RLS is actually enforced on public.projects by querying it with the
 * ANON key and no user session. With RLS on and the correct policies, that must
 * return zero rows or a permission error. If it returns data, the table is
 * world-readable — the exact hole that existed in production.
 */
export async function checkRlsEnforced() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return { ok: false, reason: "supabase env missing" };

  try {
    const res = await fetch(`${url}/rest/v1/projects?select=id&limit=1`, {
      headers: { apikey: anon, Authorization: `Bearer ${anon}` },
      cache: "no-store",
    });

    // 401/403 = grant revoked. 200 with [] = RLS filtering. 200 with rows = OPEN.
    if (res.status === 401 || res.status === 403) {
      return { ok: true, mode: "grant-revoked", status: res.status };
    }
    if (res.ok) {
      const rows = await res.json();
      if (Array.isArray(rows) && rows.length === 0) {
        return { ok: true, mode: "rls-filtered", status: res.status };
      }
      return {
        ok: false,
        mode: "PUBLICLY READABLE",
        status: res.status,
        reason: "anon key returned project rows — RLS is not enforced",
      };
    }
    return { ok: true, mode: `unexpected-${res.status}`, status: res.status };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

/** Cheap round-trip proving the service-role connection works. */
export async function checkDatabase() {
  const started = Date.now();
  const { error } = await adminSupabase.from("profiles").select("id").limit(1);
  return { ok: !error, latencyMs: Date.now() - started, ...(error ? { error: error.message } : {}) };
}

export function buildInfo() {
  return {
    commit: process.env.BUILD_COMMIT || "unknown",
    dirty: process.env.BUILD_DIRTY === "true",
    builtAt: process.env.BUILD_TIME || "unknown",
    env: process.env.VERCEL_ENV || process.env.NODE_ENV || "unknown",
  };
}
