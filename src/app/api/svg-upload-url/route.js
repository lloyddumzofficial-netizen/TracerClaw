import { NextResponse } from "next/server";
import { getUploadUrl } from "@/lib/cloudflare";
import { adminSupabase } from "@/lib/supabase";
import { enforceRateLimit } from "@/lib/rateLimit";
import { DEFAULT_MAX_SVG_BYTES } from "@/lib/ssrf";

export const runtime = "nodejs";

/**
 * Presigned PUT for an edited SVG from Palette Studio.
 *
 * Palette Studio used to POST the whole SVG as base64 to /api/save-asset. That
 * body exceeds the platform's ~4.5MB serverless request cap for any reasonably
 * detailed vector, so the request was rejected with a 413 before the function
 * ran — the same failure already fixed for /api/trace step 1.
 *
 * The key is always scoped to a project the caller owns, which is what lets
 * /api/save-asset recognise it via isOwnedStorageUrl and record it without
 * re-uploading a second copy.
 */
export async function POST(request) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = authHeader.replace("Bearer ", "").trim();
    const { data: { user }, error: authError } = await adminSupabase.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized: invalid session" }, { status: 401 });
    }

    const rateLimit = await enforceRateLimit({
      namespace: "api:svg-upload-url:user",
      identifier: user.id,
      max: 20,
      window: "60 s",
      windowMs: 60_000,
    });
    if (!rateLimit.success) return rateLimit.response;

    const { projectId, fileSize } = await request.json();
    if (!projectId) {
      return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
    }

    const size = Number(fileSize);
    if (!Number.isFinite(size) || size <= 0) {
      return NextResponse.json({ error: "Missing or invalid file size." }, { status: 400 });
    }
    if (size > DEFAULT_MAX_SVG_BYTES) {
      return NextResponse.json(
        { error: `SVG is too large. Maximum allowed size is ${Math.round(DEFAULT_MAX_SVG_BYTES / 1024 / 1024)}MB.` },
        { status: 413 }
      );
    }

    // Ownership check — the presigned key is scoped to this project.
    const { data: project, error: projError } = await adminSupabase
      .from("projects")
      .select("id")
      .eq("id", projectId)
      .eq("user_id", user.id)
      .single();

    if (projError || !project) {
      return NextResponse.json({ error: "Project not found or access denied" }, { status: 403 });
    }

    const fileName = `projects/${projectId}/vector_${Date.now()}.svg`;
    const urls = await getUploadUrl(fileName, "image/svg+xml", {
      fileSize: size,
      maxBytes: DEFAULT_MAX_SVG_BYTES,
    });

    return NextResponse.json(urls);
  } catch (error) {
    console.error("[SVG Upload URL] Error:", error);
    return NextResponse.json({ error: "Failed to generate upload URL" }, { status: 500 });
  }
}
