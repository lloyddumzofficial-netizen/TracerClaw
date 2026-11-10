import { editUser, editRateLimit, editBody, editFailure, editJson } from "@/server/artworkEdits/http";
import { ownedProject, applyEdit } from "@/server/artworkEdits/service";
export const runtime = "nodejs";
export async function POST(request, { params }) {
  try {
    const user = await editUser(request);
    const limited = await editRateLimit(user.id, true); if (limited) return limited;
    const { id, editId } = await params;
    await ownedProject(user.id, id);
    const body = await editBody(request);
    return editJson({ project: await applyEdit(user.id, id, editId, body.restore === true) });
  } catch (error) { return editFailure(error); }
}
