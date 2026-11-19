import { designJson } from "@/server/designExtract/request";
import { requireDesignAdmin, designError } from "@/server/designExtract/access";
import { ownedProject, fail } from "@/server/designExtract/service";
import { convertDesignLayer } from "@/server/designExtract/vectorize";
import { attachVectorLayer } from "@/server/designExtract/vectorLayer";
import { designResponse } from "@/server/designExtract/response";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request, context) {
  try {
    const user = await requireDesignAdmin(request, true);
    const { id } = await context.params;
    const project = await ownedProject(id, user.id);
    const { layerId, attach, revision } = await designJson(request);
    if (typeof layerId !== "string" || !layerId || layerId.length > 120) fail("Select a layer to convert.");
    if(attach===true)return await designResponse(await attachVectorLayer(project,layerId,revision));
    const svg = await convertDesignLayer(project, layerId);
    return new Response(svg, { headers: { "Content-Type": "image/svg+xml", "Content-Disposition": 'attachment; filename="design-layer.svg"', "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox" } });
  } catch (error) { return designError(error); }
}
