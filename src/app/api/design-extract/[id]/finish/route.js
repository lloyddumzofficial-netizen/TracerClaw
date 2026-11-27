import { requireDesignUser, designError } from "@/server/designExtract/access";
import { readFinishAllowance } from "@/server/designExtract/finishBilling";
import { ownedProject, fail } from "@/server/designExtract/service";
import { designResponse } from "@/server/designExtract/response";

export const runtime = "nodejs";

export async function GET(request, context) {
  try {
    const user = await requireDesignUser(request);
    const { id } = await context.params;
    const layerId = new URL(request.url).searchParams.get("layerId");
    if (!layerId || layerId.length > 120) fail("Select an image layer.");
    const project = await ownedProject(id, user.id);
    return await designResponse({ allowance: await readFinishAllowance(project, layerId) });
  } catch (error) { return designError(error); }
}
