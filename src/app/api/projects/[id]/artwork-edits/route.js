import { editUser, editRateLimit, editBody, editFailure, editJson } from "@/server/artworkEdits/http";
import { artworkEditsEnabled, ownedProject, listEdits, startEdit, publicEdit } from "@/server/artworkEdits/service";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request, { params }) {
  try {
    const user = await editUser(request, { requireEnabled: false });
    if (!artworkEditsEnabled(user)) return editJson({ enabled: false, edits: [] });
    const limited = await editRateLimit(user.id); if (limited) return limited;
    const { id } = await params;
    const project = await ownedProject(user.id, id);
    // The extraction UI may still hold its pre-extraction revision. Return
    // the owned, authoritative artifact identity alongside editor history.
    const fields = ["id", "original_image_url", "generated_image_url", "upscaled_image_url", "svg_url", "zip_url", "zip_signature", "zip_generated_at", "google_drive_folder_id", "google_drive_folder_url", "google_drive_exported_at", "google_drive_export_signature"];
    const snapshot = { ...Object.fromEntries(fields.map(field => [field, project[field] ?? null])), artwork_revision: project.artwork_revision || 0 };
    return editJson({ enabled: true, project: snapshot, edits: (await listEdits(user.id, id)).map(publicEdit) });
  } catch (error) { return editFailure(error); }
}
export async function POST(request, { params }) {
  try {
    const user = await editUser(request);
    const limited = await editRateLimit(user.id, true); if (limited) return limited;
    const { id } = await params;
    const project = await ownedProject(user.id, id);
    const body = await editBody(request);
    const edit = await startEdit(project, user, body);
    return editJson({ edit: publicEdit(edit) }, 202);
  } catch (error) { return editFailure(error); }
}
