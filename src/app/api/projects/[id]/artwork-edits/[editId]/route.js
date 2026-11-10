import { editUser, editRateLimit, editFailure, editJson } from "@/server/artworkEdits/http";
import { ownedProject, readEdit, settleEdit, publicEdit } from "@/server/artworkEdits/service";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request, { params }) {
  try {
    const user = await editUser(request);
    const limited = await editRateLimit(user.id); if (limited) return limited;
    const { id, editId } = await params;
    await ownedProject(user.id, id);
    return editJson({ edit: publicEdit(await settleEdit(await readEdit(user.id, id, editId))) });
  } catch (error) { return editFailure(error); }
}
