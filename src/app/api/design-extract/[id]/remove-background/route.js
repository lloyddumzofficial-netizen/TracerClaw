import { designJson } from "@/server/designExtract/request";
import { requireDesignUser, designError } from "@/server/designExtract/access";
import { ownedProject, fail } from "@/server/designExtract/service";
import { removeDesignBackground } from "@/server/designExtract/removeBackground";
import { designResponse } from "@/server/designExtract/response";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request, context) {
  try {
    const user = await requireDesignUser(request, true);
    const { id } = await context.params;
    const { layerId, revision } = await designJson(request);
    if (typeof layerId !== "string" || !layerId || layerId.length > 120) fail("Select an image layer.");
    const result = await removeDesignBackground(await ownedProject(id, user.id), layerId, revision);
    return await designResponse(result, { status: result.pending ? 202 : 200 });
  } catch (error) { return designError(error); }
}
