import { adminSupabase } from "@/lib/supabase";
import { NANO_BANANA_EDIT_MODEL } from "@/lib/tracePrompts";

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
  "NEXT_PUBLIC_SITE_URL",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
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
  "PAYMONGO_SECRET_KEY",
  "PAYMONGO_WEBHOOK_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "INTEGRATION_ENCRYPTION_KEY",
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
  "LOG_LEVEL",
];

/** Columns the billing and refund logic depends on, per table. */
export const REQUIRED_COLUMNS = {
  projects: [
    "id", "user_id", "name", "trace_type", "ai_prompt",
    "original_image_url", "generated_image_url", "upscaled_image_url", "svg_url",
    "credit_deducted", "refunded", "failed_at", "failed_step", "client_request_id",
  ],
  profiles: ["id", "email", "credits"],
  credit_logs: ["user_id", "action", "amount"],
  generation_attempts: [
    "id", "request_key", "user_id", "project_id", "operation", "status",
    "charge_amount", "result_url", "result_mime_type", "error_code", "created_at", "updated_at",
  ],
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

/** Feature readiness without exposing any secret values. */
export function checkCapabilities() {
  const has = (name) => Boolean(process.env[name]);
  return {
    aiGeneration: has("FAL_KEY"),
    standardSvg: has("RECRAFT_API_KEY"),
    precisionSvg: has("VECTORIZER_API_ID") && has("VECTORIZER_API_SECRET"),
    distributedRateLimit: has("UPSTASH_REDIS_REST_URL") && has("UPSTASH_REDIS_REST_TOKEN"),
    googleDrive: has("GOOGLE_CLIENT_ID") && has("GOOGLE_CLIENT_SECRET") && has("INTEGRATION_ENCRYPTION_KEY"),
    dodoPayments: has("DODO_PAYMENTS_API_KEY") && has("DODO_PAYMENTS_WEBHOOK_SECRET"),
    paymongo: has("PAYMONGO_SECRET_KEY") && has("PAYMONGO_WEBHOOK_SECRET"),
  };
}

export async function checkAiProvider() {
  if (!process.env.FAL_KEY) {
    return { ok: false, provider: "fal.ai", model: NANO_BANANA_EDIT_MODEL, reason: "FAL_KEY missing" };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    const response = await fetch("https://rest.fal.ai/tokens/", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Key ${process.env.FAL_KEY}`,
      },
      body: JSON.stringify({
        allowed_apps: [NANO_BANANA_EDIT_MODEL],
        token_expiration: 120,
      }),
      signal: controller.signal,
      cache: "no-store",
    }).finally(() => clearTimeout(timeout));

    if (response.ok) {
      return { ok: true, provider: "fal.ai", model: NANO_BANANA_EDIT_MODEL };
    }

    let message = response.statusText || "Provider rejected readiness check";
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const data = await response.json().catch(() => null);
      message = data?.detail || data?.message || data?.error || message;
    } else {
      message = (await response.text().catch(() => "")) || message;
    }

    return {
      ok: false,
      provider: "fal.ai",
      model: NANO_BANANA_EDIT_MODEL,
      status: response.status,
      reason: String(message).slice(0, 240),
    };
  } catch (err) {
    return {
      ok: false,
      provider: "fal.ai",
      model: NANO_BANANA_EDIT_MODEL,
      reason: err?.name === "AbortError" ? "Provider readiness check timed out" : String(err?.message || err).slice(0, 240),
    };
  }
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

/** Run the complete dependency-readiness suite used by deploy and cron checks. */
export async function runDeepHealthChecks() {
  const [database, schema, rls, aiProvider] = await Promise.all([
    checkDatabase(),
    checkSchema(),
    checkRlsEnforced(),
    checkAiProvider(),
  ]);
  const checks = {
    env: checkEnv(),
    database,
    schema,
    rls,
    capabilities: checkCapabilities(),
    aiProvider,
  };
  const failed = Object.entries(checks)
    .filter(([, value]) => value && value.ok === false)
    .map(([name]) => name);

  return { ok: failed.length === 0, failed, checks };
}
