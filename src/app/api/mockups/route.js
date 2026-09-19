import { NextResponse } from "next/server";
import { requireUser } from "@/server/api/auth";
import { adminSupabase } from "@/lib/supabase";
import { enforceRateLimit } from "@/lib/rateLimit";
import { DEFAULT_GARMENT_TYPE, isGarmentTypeAvailable } from "@/features/mockup-studio/garmentCatalog";
import { cleanupExpiredMockupProjects } from "@/server/mockups";

export async function GET(request) {
  const auth = await requireUser(request);
  if (auth.response) return auth.response;

  // Opportunistically remove this user's expired R2 prefix. The daily global
  // cleanup remains the fallback, while active users never build a backlog.
  await cleanupExpiredMockupProjects({ limit: 3, userId: auth.user.id }).catch(() => null);

  const { data: projects, error } = await adminSupabase
    .from("mockup_projects")
    .select("id, name, garment_type, status, created_at, updated_at, expires_at")
    .eq("user_id", auth.user.id)
    .gt("expires_at", new Date().toISOString())
    .order("updated_at", { ascending: false })
    .limit(12);

  if (error) return NextResponse.json({ error: "Could not load recent mockup projects." }, { status: 503 });
  if (!projects?.length) return NextResponse.json({ projects: [] });

  const projectIds = projects.map(project => project.id);
  const [outputsResult, assetsResult] = await Promise.all([
    adminSupabase.from("mockup_outputs").select("project_id, file_url, view_type, created_at")
      .eq("user_id", auth.user.id).in("project_id", projectIds).eq("view_type", "hero")
      .order("created_at", { ascending: false }),
    adminSupabase.from("mockup_assets").select("project_id, file_url, role, created_at")
      .eq("user_id", auth.user.id).in("project_id", projectIds).in("role", ["front", "shorts_front"])
      .order("created_at", { ascending: false }),
  ]);

  const previewByProject = new Map();
  for (const output of outputsResult.data || []) {
    if (!previewByProject.has(output.project_id)) previewByProject.set(output.project_id, output.file_url);
  }
  for (const asset of assetsResult.data || []) {
    if (!previewByProject.has(asset.project_id)) previewByProject.set(asset.project_id, asset.file_url);
  }

  return NextResponse.json({
    projects: projects.map(project => ({ ...project, preview_url: previewByProject.get(project.id) || null })),
  });
}

export async function POST(request) {
  const auth = await requireUser(request);
  if (auth.response) return auth.response;
  const limited = await enforceRateLimit({ namespace: "api:mockups:create:user", identifier: auth.user.id, max: 10, window: "60 s", windowMs: 60_000 });
  if (!limited.success) return limited.response;

  const body = await request.json().catch(() => ({}));
  const name = String(body.name || "Untitled Mockup").trim().slice(0, 100);
  const garmentType = String(body.garmentType || DEFAULT_GARMENT_TYPE);
  if (!name) return NextResponse.json({ error: "Project name is required." }, { status: 400 });
  if (!isGarmentTypeAvailable(garmentType)) {
    return NextResponse.json({ error: "Only Round Neck T-shirt and Polo are available right now." }, { status: 400 });
  }

  const { data, error } = await adminSupabase
    .from("mockup_projects")
    .insert({ user_id: auth.user.id, name, garment_type: garmentType, template_version: "garment-catalog-v2" })
    .select("*")
    .single();
  if (error) {
    const migrationMissing = error.code === "42P01" || error.code === "PGRST205" || error.code === "23514";
    return NextResponse.json({ error: migrationMissing ? "Mockup Studio database migration is not installed yet." : "Could not create mockup project." }, { status: 503 });
  }
  return NextResponse.json({ project: data }, { status: 201 });
}
