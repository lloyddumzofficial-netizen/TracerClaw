import { requireDesignAdmin, designError } from "@/server/designExtract/access";
import { createProject } from "@/server/designExtract/service";
import { adminSupabase as db } from "@/lib/supabase";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request) {
  try {
    const user = await requireDesignAdmin(request);
    const { data, error } = await db.from("design_extract_projects").select("id,created_at,source_url,manifest").eq("user_id", user.id).gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false }).limit(50);
    if (error) throw error;
    return Response.json({ enabled: true, projects: data.map(project => ({ id: project.id, created_at: project.created_at, original_image_url: project.source_url, trace_type: "design_extract", name: project.manifest?.name || "Untitled Design" })) });
  } catch (error) { return designError(error); }
}
export async function POST(request) {
  try {
    const user = await requireDesignAdmin(request, true);
    const body = await request.json();
    const project = await createProject(user.id, body.imageUrl, body.sourceProjectId);
    return Response.json({ project }, { status: 201 });
  } catch (error) { return designError(error); }
}
