import { NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase";
import { requireBearerUser } from "@/lib/integrations/auth";
import { exportProjectToGoogleDrive, projectDriveExportIsCurrent } from "@/lib/integrations/googleDrive";
import { enforceRateLimit } from "@/lib/rateLimit";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request) {
  try {
    const { user, error } = await requireBearerUser(request);
    if (error) return error;

    const { projectId } = await request.json().catch(() => ({}));
    if (!projectId) return NextResponse.json({ error: "Missing projectId" }, { status: 400 });

    const { data: project, error: projectError } = await adminSupabase
      .from("projects")
      .select("id, user_id, name, original_image_url, generated_image_url, upscaled_image_url, svg_url, zip_url, google_drive_folder_id, google_drive_folder_url, google_drive_exported_at, google_drive_export_signature")
      .eq("id", projectId)
      .eq("user_id", user.id)
      .single();
    if (projectError || !project) {
      return NextResponse.json({ error: "Project not found or access denied" }, { status: 404 });
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

    const result = await exportProjectToGoogleDrive({ userId: user.id, project });
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
