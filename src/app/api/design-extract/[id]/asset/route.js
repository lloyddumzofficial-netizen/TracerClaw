import { requireDesignAdmin, designError } from "@/server/designExtract/access";
import { ownedProject, readAsset, fail } from "@/server/designExtract/service";
import { adminSupabase as db } from "@/lib/supabase";
import { maskAsset } from "@/lib/designExtractVariants";
export const runtime = "nodejs";
export async function GET(request, context) {
  try {
    const user = await requireDesignAdmin(request);
    const { id } = await context.params;
    const project = await ownedProject(id, user.id);
    const params = new URL(request.url).searchParams;
    const layerId = params.get("layer"), variant = params.get("variant"), svg=params.get('format')==='svg';
    const assetUrl = layer => !layer ? null : layer.kind==='svg' ? svg ? layer.url : layer.previewUrl : svg ? null : variant === "mask-source" ? maskAsset(layer).source : variant === "mask-base" ? maskAsset(layer).mask : layer.url;
    let url = layerId === "source" ? project.source_url : assetUrl(project.manifest.layers.find(layer => layer.id === layerId));
    if (!url) {
      const { data, error } = await db.from("design_extract_jobs").select("result").eq("project_id", id).in("status", ["ready", "saving"]).maybeSingle();
      if (error) throw error;
      url = assetUrl(data?.result?.layers.find(layer => layer.id === layerId));
    }
    if (!url) fail("Layer not found", 404);
    return new Response(await readAsset(url), { headers: { "Content-Type": svg?"image/svg+xml":"image/png", "Cache-Control": "private, no-store", "X-Content-Type-Options":"nosniff", "Content-Security-Policy":"default-src 'none'; sandbox" } });
  } catch (error) { return designError(error); }
}
