import { requireDesignAdmin, designError } from "@/server/designExtract/access";
import { ownedProject, readAsset, fail } from "@/server/designExtract/service";
import { adminSupabase as db } from "@/lib/supabase";
export const runtime = "nodejs";
export async function GET(request, context) {
  try {
    const user = await requireDesignAdmin(request);
    const { id } = await context.params;
    const project = await ownedProject(id, user.id);
    const layerId = new URL(request.url).searchParams.get("layer");
    let url = layerId === "source" ? project.source_url : project.manifest.layers.find(layer => layer.id === layerId)?.url;
    if (!url) {
      const { data, error } = await db.from("design_extract_jobs").select("result").eq("project_id", id).eq("status", "ready").maybeSingle();
      if (error) throw error;
      url = data?.result?.layers.find(layer => layer.id === layerId)?.url;
    }
    if (!url) fail("Layer not found", 404);
    return new Response(await readAsset(url), { headers: { "Content-Type": "image/png", "Cache-Control": "private, no-store" } });
  } catch (error) { return designError(error); }
}
