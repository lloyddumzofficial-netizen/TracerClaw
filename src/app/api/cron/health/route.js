import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { buildInfo, runDeepHealthChecks } from "@/lib/healthChecks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request) {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runDeepHealthChecks();
  if (!result.ok) {
    logger.error("[Health Cron] Dependency readiness degraded", {
      failed: result.failed,
      build: buildInfo(),
    });
  }

  return NextResponse.json(
    {
      ...result,
      status: result.ok ? "healthy" : "degraded",
      build: buildInfo(),
    },
    {
      status: result.ok ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    }
  );
}
