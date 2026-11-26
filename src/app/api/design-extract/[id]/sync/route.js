import { designResponse } from "@/server/designExtract/response";
import { requireDesignUser, designError } from "@/server/designExtract/access";
import { ownedProject, snapshot } from "@/server/designExtract/service";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request, context) {
  try {
    const user = await requireDesignUser(request, true);
    const { id } = await context.params;
    const data = await snapshot(await ownedProject(id, user.id), true);
    if (data.job?.processor === "workflow") {
      const { wakeDesignWorkflow } = await import("@/server/designExtract/processing/launcher");
      await wakeDesignWorkflow(data.job);
    }
    return await designResponse(data);
  } catch (error) { return designError(error); }
}
