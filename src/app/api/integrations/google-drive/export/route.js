import { NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase";
import { requireBearerUser } from "@/lib/integrations/auth";
import { exportProjectToGoogleDrive, projectDriveExportIsCurrent } from "@/lib/integrations/googleDrive";
import { enforceRateLimit } from "@/lib/rateLimit";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const maxDuration = 60;

const PROJECT_BASE_SELECT = "id, user_id, name, original_image_url, generated_image_url, upscaled_image_url, svg_url, zip_url";
const PROJECT_DRIVE_SELECT = `${PROJECT_BASE_SELECT}, google_drive_folder_id, google_drive_folder_url, google_drive_exported_at, google_drive_export_signature`;

function isMissingDriveColumnError(error) {
  const message = `${error?.code || ""} ${error?.message || ""} ${error?.details || ""}`;
  return /google_drive_|schema cache|column/i.test(message);
}

async function fetchProjectForDriveExport({ projectId, userId }) {
  const fullResult = await adminSupabase
    .from("projects")
    .select(PROJECT_DRIVE_SELECT)
    .eq("id", projectId)
    .eq("user_id", userId)
    .single();

  if (!fullResult.error) {
    return { project: fullResult.data, drivePersistenceReady: true, error: null };
  }

  if (!isMissingDriveColumnError(fullResult.error)) {
    return { project: null, drivePersistenceReady: true, error: fullResult.error };
  }

  logger.warn("[Google Drive] Project Drive columns are not available yet; falling back to one-time export", {
    projectId,
    error: fullResult.error,
  });

  const baseResult = await adminSupabase
    .from("projects")
    .select(PROJECT_BASE_SELECT)
    .eq("id", projectId)
    .eq("user_id", userId)
    .single();

  return {
    project: baseResult.data || null,
    drivePersistenceReady: false,
    error: baseResult.error || null,
  };
}

export async function POST(request) {
  try {
    const { user, error } = await requireBearerUser(request);
    if (error) return error;

    const { projectId } = await request.json().catch(() => ({}));
    if (!projectId) return NextResponse.json({ error: "Missing projectId" }, { status: 400 });

    const { project, drivePersistenceReady, error: projectError } = await fetchProjectForDriveExport({
      projectId,
      userId: user.id,
    });
    if (projectError || !project) {
      logger.warn("[Google Drive] Project lookup failed", { projectId, error: projectError });
      const notFound = projectError?.code === "PGRST116";
      return NextResponse.json({
        error: notFound ? "Project not found or access denied" : "Failed to load project for Google Drive export.",
        code: notFound ? "PROJECT_NOT_FOUND" : "PROJECT_LOOKUP_FAILED",
      }, { status: notFound ? 404 : 500 });
    }

    if (projectDriveExportIsCurrent(project)) {
      return NextResponse.json({
        success: true,
        alreadySaved: true,
        folderId: project.google_drive_folder_id,
        folderUrl: project.google_drive_folder_url,
        exportSignature: project.google_drive_export_signature,
        files: [],
      });
    }

    const rateLimit = await enforceRateLimit({
      namespace: "api:integrations:drive-export:user",
      identifier: user.id,
      max: 8,
      window: "60 s",
      windowMs: 60_000,
    });
    if (!rateLimit.success) return rateLimit.response;

    const result = await exportProjectToGoogleDrive({ userId: user.id, project, persistProjectExport: drivePersistenceReady });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    logger.error("[Google Drive] Export failed", error);
    const message = error?.message || "Failed to export to Google Drive";
    const status = /not configured|not connected/i.test(message) ? 503 : 500;
    return NextResponse.json({
      error: message,
      code: error?.code || null,
      actionUrl: error?.actionUrl || null,
    }, { status });
  }
}
