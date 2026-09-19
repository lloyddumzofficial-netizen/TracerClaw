import { NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase";
import { isValidMockupWebhookToken, processMockupJob } from "@/server/mockups";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request) {
  const url = new URL(request.url);
  const jobId = url.searchParams.get("jobId");
  if (!jobId) return NextResponse.json({ error: "Missing job identifier." }, { status: 400 });
  if (!isValidMockupWebhookToken(jobId, url.searchParams.get("token"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Parse the provider body so malformed webhook calls fail early. The job
  // processor still fetches the authoritative result from fal by request id.
  const body = await request.json().catch(() => null);
  if (!body?.request_id || !["OK", "ERROR"].includes(body.status)) {
    return NextResponse.json({ error: "Invalid webhook payload." }, { status: 400 });
  }
  const { data: job } = await adminSupabase.from("mockup_jobs").select("*").eq("id", jobId).maybeSingle();
  if (!job) return NextResponse.json({ error: "Mockup render not found." }, { status: 404 });
  const knownRequestIds = Object.entries(job.provider_requests || {})
    .filter(([key]) => !key.startsWith("_"))
    .map(([, value]) => value);
  if (!knownRequestIds.includes(body.request_id) && job.provider_requests?._retryRequest !== body.request_id) {
    return NextResponse.json({ error: "Webhook request does not belong to this job." }, { status: 409 });
  }

  const result = await processMockupJob({ userId: job.user_id, job });
  return NextResponse.json({ success: true, status: result.job?.status || "processing" });
}
