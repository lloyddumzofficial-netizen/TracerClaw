import { NextResponse } from "next/server";
import { enforceRateLimit, getClientIp } from "@/lib/rateLimit";
import {
  buildInfo,
  runDeepHealthChecks,
} from "@/lib/healthChecks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/health
 *   Shallow, public. Safe for uptime monitors. Reports liveness and the exact
 *   commit running in production, so repo/production drift is measurable
 *   instead of assumed.
 *
 * GET /api/health?deep=1   (Authorization: Bearer $CRON_SECRET)
 *   Full check: env vars, required schema columns, RLS enforcement, DB latency.
 *   Authenticated because it reveals configuration state.
 *
 * Returns 503 when a deep check fails, so an uptime monitor pointed at the deep
 * URL will page rather than silently pass.
 */
export async function GET(request) {
  const limit = await enforceRateLimit({
    namespace: "api:health:ip",
    identifier: getClientIp(request),
    max: 60,
    window: "60 s",
    windowMs: 60_000,
  });
  if (!limit.success) return limit.response;

  const build = buildInfo();
  const { searchParams } = new URL(request.url);
  const wantsDeep = searchParams.get("deep") === "1";

  if (!wantsDeep) {
    return NextResponse.json(
      { ok: true, status: "alive", build },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { ok, failed, checks } = await runDeepHealthChecks();

  return NextResponse.json(
    {
      ok,
      status: ok ? "healthy" : "degraded",
      failed,
      build,
      checks,
    },
    {
      status: ok ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    }
  );
}

export async function HEAD() {
  return new Response(null, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}
