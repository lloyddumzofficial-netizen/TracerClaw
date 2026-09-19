import { NextResponse } from "next/server";
import { requireUser } from "@/server/api/auth";
import { loadMockupAssets, loadOwnedMockupProject } from "@/server/mockups";
import { adminSupabase } from "@/lib/supabase";
import { getSafeMockupStyle, normalizeMockupColors } from "@/features/mockup-studio/config";

export async function GET(request, { params }) {
  const auth = await requireUser(request);
  if (auth.response) return auth.response;
  const { id } = await params;
  const [{ project, error }, assetsResult] = await Promise.all([
    loadOwnedMockupProject(auth.user.id, id),
    loadMockupAssets(auth.user.id, id),
  ]);
  if (error || !project) return NextResponse.json({ error: "Mockup project not found." }, { status: 404 });
  const { data: latestJobs } = await adminSupabase.from("mockup_jobs").select("*")
    .eq("project_id", id).eq("user_id", auth.user.id)
    .order("created_at", { ascending: false }).limit(1);
  const latestJob = latestJobs?.[0] || null;
  let outputs = [];
  if (latestJob) {
    const outputResult = await adminSupabase.from("mockup_outputs").select("*")
      .eq("job_id", latestJob.id).eq("user_id", auth.user.id);
    outputs = outputResult.data || [];
  }
  return NextResponse.json({ project, assets: assetsResult.data || [], latestJob, outputs });
}

export async function PATCH(request, { params }) {
  const auth = await requireUser(request);
  if (auth.response) return auth.response;
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const update = {
    colors: normalizeMockupColors(body.colors),
    style_preset: getSafeMockupStyle(body.stylePreset),
    updated_at: new Date().toISOString(),
  };
  if (body.name) update.name = String(body.name).trim().slice(0, 100);
  const { data, error } = await adminSupabase.from("mockup_projects").update(update)
    .eq("id", id).eq("user_id", auth.user.id).select("*").single();
  if (error || !data) return NextResponse.json({ error: "Could not update mockup project." }, { status: 404 });
  return NextResponse.json({ project: data });
}
