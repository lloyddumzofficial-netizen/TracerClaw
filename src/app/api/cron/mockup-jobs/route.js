import { NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase";
import { logger } from "@/lib/logger";
import { processMockupJob } from "@/server/mockups";

export const runtime = "nodejs";
export const maxDuration = 60;

const JOB_BATCH_LIMIT = 4;

export async function GET(request) {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: jobs, error } = await adminSupabase.from("mockup_jobs").select("*")
    .in("status", ["queueing", "queued", "processing"])
    .order("updated_at", { ascending: true })
    .limit(JOB_BATCH_LIMIT);
  if (error?.code === "42P01" || error?.code === "PGRST205") {
    return NextResponse.json({ success: true, processed: 0, unavailable: true });
  }
  if (error) return NextResponse.json({ error: "Could not load active mockup jobs." }, { status: 503 });

  const results = { processed: 0, completed: 0, refunded: 0, failed: 0, stillProcessing: 0 };
  for (const job of jobs || []) {
    try {
      const result = await processMockupJob({ userId: job.user_id, job });
      results.processed++;
      if (result.refunded || result.job?.status === "refunded") results.refunded++;
      else if (result.job?.status === "completed") results.completed++;
      else if (result.job?.status === "failed") results.failed++;
      else results.stillProcessing++;
    } catch (caught) {
      results.failed++;
      logger.error("[Mockup recovery] Job processing failed", { jobId: job.id, message: caught?.message });
    }
  }

  return NextResponse.json({ success: true, ...results, hasMore: (jobs || []).length === JOB_BATCH_LIMIT });
}
