import { designJson } from "@/server/designExtract/request";
import { requireDesignAdmin, designError } from "@/server/designExtract/access";
import { ownedProject, fail } from "@/server/designExtract/service";
import { upscaleDesignLayer } from "@/server/designExtract/upscaleLayer";
import { designResponse } from "@/server/designExtract/response";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request, context) {
  try {
    const user = await requireDesignAdmin(request, true);
    const { id } = await context.params;
    const { layerId, revision } = await designJson(request);
    if (typeof layerId !== "string" || !layerId || layerId.length > 120) fail("Select an image layer.");
    return await designResponse(await upscaleDesignLayer(await ownedProject(id, user.id), layerId, revision));
  } catch (error) { return designError(error); }
}
