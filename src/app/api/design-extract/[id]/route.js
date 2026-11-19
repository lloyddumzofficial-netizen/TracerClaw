import { designJson } from "@/server/designExtract/request";
import { designResponse } from "@/server/designExtract/response";
import { requireDesignAdmin, designError } from "@/server/designExtract/access";
import { ownedProject, snapshot, saveManifest, startOperation, reviewOperation, reconcileSubmission, recoverOperation, fail } from "@/server/designExtract/service";
import { renameDesignProject, deleteDesignProject, editLayerAsset } from "@/server/designExtract/service";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request, context) {
  try {
    const user = await requireDesignAdmin(request);
    const { id } = await context.params;
    return await designResponse(await snapshot(await ownedProject(id, user.id)), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return designError(error); }
}
export async function PATCH(request, context) {
  try {
    const user = await requireDesignAdmin(request, true);
    const { id } = await context.params;
    const project = await ownedProject(id, user.id);
    const body = await designJson(request);
    if (["mask", "version"].includes(body.action)) return await designResponse({ project: await editLayerAsset(project, body) });
    if (body.action === "rename") return await designResponse({ project: await renameDesignProject(project, body.newName) });
    return await designResponse({ project: await saveManifest(project, body.layers, body.revision) });
  } catch (error) { return designError(error); }
}
export async function DELETE(request, context) {
  try {
    const user = await requireDesignAdmin(request, true);
    const { id } = await context.params;
    await deleteDesignProject(await ownedProject(id, user.id));
    return await designResponse({ success: true });
  } catch (error) { return designError(error); }
}
export async function POST(request, context) {
  try {
    const user = await requireDesignAdmin(request, true);
    const { id } = await context.params;
    const project = await ownedProject(id, user.id);
    const body = await designJson(request);
    if (body.action === "recover") return await designResponse({ job: await recoverOperation(project, body.jobId) });
    if (body.action === "reconcile") return await designResponse({ job: await reconcileSubmission(project, body.jobId, body.requestId) });
    if (["accept", "reject"].includes(body.action)) {
      if (body.revision !== project.revision) fail("Project changed. Reload before reviewing.", 409);
      await reviewOperation(project, body.jobId, body.action === "accept", body.versions);
      return await designResponse(await snapshot(await ownedProject(id, user.id)));
    }
    return await designResponse({ job: await startOperation(project, body) });
  } catch (error) { return designError(error); }
}
