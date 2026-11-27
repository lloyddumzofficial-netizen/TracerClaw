import { designJson } from "@/server/designExtract/request";
import { designResponse } from "@/server/designExtract/response";
import { requireDesignUser, designError } from "@/server/designExtract/access";
import { createProject } from "@/server/designExtract/service";
import { adminSupabase as db } from "@/lib/supabase";
import { designRefineAvailable, isRefinementProject } from "@/server/designExtract/refinement";
import { designBillingMode } from "@/server/designExtract/billing";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request) {
  try {
    const scope = new URL(request.url).searchParams.get("scope");
    if (scope === "availability") {
      const enabled = process.env.DESIGN_EXTRACT_ENABLED === "true" && designBillingMode() === "paid";
      return Response.json({ enabled }, { headers: { "Cache-Control": "no-store" } });
    }
    const user = await requireDesignUser(request);
    if (scope === "access") {
      const refinement = await designRefineAvailable();
      return await designResponse(refinement ? { enabled: true, refinement } : { enabled: true });
    }
    const { data, error } = await db.from("design_extract_projects").select("id,created_at,source_url,manifest").eq("user_id", user.id).gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false }).limit(50);
    if (error) throw error;
    const refinement = await designRefineAvailable();
    return await designResponse({ enabled: true, ...(refinement && { refinement }), projects: data.map(project => ({ id: project.id, created_at: project.created_at, original_image_url: project.source_url, width: project.manifest.width, height: project.manifest.height, trace_type: "design_extract", ...(isRefinementProject(project) && { workspaceMode: "refine" }), name: project.manifest?.name || "Untitled Design" })) });
  } catch (error) { return designError(error); }
}
export async function POST(request) {
  try {
    const user = await requireDesignUser(request, true);
    const body = await designJson(request);
    const project = await createProject(user.id, body.imageUrl, body.sourceProjectId, await designRefineAvailable());
    return await designResponse({ project }, { status: 201 });
  } catch (error) { return designError(error); }
}
