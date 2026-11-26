import { designJson } from "@/server/designExtract/request";
import { designResponse } from "@/server/designExtract/response";
import { canReconcileDesignSubmission, requireDesignUser, designError } from "@/server/designExtract/access";
import { ownedProject, snapshot, saveManifest, startOperation, reviewOperation, reconcileSubmission, recoverOperation, fail } from "@/server/designExtract/service";
import { colorCutout, renameDesignProject, deleteDesignProject, editLayerAsset, reviseQualityReview, restoreRefinementOptions } from "@/server/designExtract/service";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request, context) {
  try {
    const user = await requireDesignUser(request);
    const { id } = await context.params;
    return await designResponse({ ...await snapshot(await ownedProject(id, user.id)), canReconcile: canReconcileDesignSubmission(user) });
  } catch (error) { return designError(error); }
}
export async function PATCH(request, context) {
  try {
    const user = await requireDesignUser(request, true);
    const { id } = await context.params;
    const project = await ownedProject(id, user.id);
    const body = await designJson(request);
    if (body.action === "quality-review") {
      const draft = await reviseQualityReview(project, body);
      if (body.edit === "wand-preview") return new Response(draft, { headers: { "Content-Type": "image/png", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
      return await designResponse(draft);
    }
    if (body.action === "color-preview") {
      const png = await colorCutout(project, body);
      return new Response(png, { headers: { "Content-Type": "image/png", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
    }
    if (body.action === "color-cutout") return await designResponse(await colorCutout(project, body));
    if (["mask", "version"].includes(body.action)) return await designResponse({ project: await editLayerAsset(project, body) });
    if (body.action === "rename") return await designResponse({ project: await renameDesignProject(project, body.newName) });
    return await designResponse({ project: await saveManifest(project, body.layers, body.revision) });
  } catch (error) { return designError(error); }
}
export async function DELETE(request, context) {
  try {
    const user = await requireDesignUser(request, true);
    const { id } = await context.params;
    await deleteDesignProject(await ownedProject(id, user.id));
    return await designResponse({ success: true });
  } catch (error) { return designError(error); }
}
export async function POST(request, context) {
  try {
    const user = await requireDesignUser(request, true);
    const { id } = await context.params;
    const project = await ownedProject(id, user.id);
    const body = await designJson(request);
    if (body.action === "restore-refinement") return await designResponse(await snapshot(await restoreRefinementOptions(project, body.jobId, body.revision)));
    if (body.action === "recover") {
      const job = await recoverOperation(project, body.jobId);
      return await designResponse(job.status === "accepted" ? { job, project: await ownedProject(id, user.id) } : { job });
    }
    if (body.action === "reconcile") {
      if (!canReconcileDesignSubmission(user)) fail("Administrator access required", 403);
      return await designResponse({ job: await reconcileSubmission(project, body.jobId, body.requestId) });
    }
    if (["accept", "reject"].includes(body.action)) {
      if (body.revision !== project.revision) fail("Project changed. Reload before reviewing.", 409);
      await reviewOperation(project, body.jobId, body.action === "accept", body.versions, body.draftId);
      return await designResponse(await snapshot(await ownedProject(id, user.id)));
    }
    return await designResponse({ job: await startOperation(project, body) });
  } catch (error) { return designError(error); }
}
