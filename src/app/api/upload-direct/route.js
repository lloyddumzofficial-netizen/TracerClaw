import { NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase";
import { uploadToR2 } from "@/lib/cloudflare";
import { enforceRateLimit } from "@/lib/rateLimit";
import { validateImageUploadRequest } from "@/lib/uploadLimits";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

const EXTENSIONS_BY_CONTENT_TYPE = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "image/bmp": "bmp",
  "image/tiff": "tiff",
};

function sanitizeBaseName(fileName) {
  const safeName = String(fileName || "upload").replace(/[^a-zA-Z0-9.-]/g, "_");
  return safeName.replace(/\.[^.]*$/, "") || "upload";
}

async function authenticateUser(request) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) return { error: "Unauthorized", status: 401 };

  const token = authHeader.replace("Bearer ", "").trim();
  if (!token || token === "undefined") return { error: "Unauthorized: invalid token", status: 401 };

  const { data: { user }, error } = await adminSupabase.auth.getUser(token);
  if (error || !user) return { error: "Unauthorized: invalid session", status: 401 };

  return { user };
}

export async function POST(request) {
  try {
    const auth = await authenticateUser(request);
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const rateLimit = await enforceRateLimit({
      namespace: "api:upload-direct:user",
      identifier: auth.user.id,
      max: 12,
      window: "60 s",
      windowMs: 60_000,
    });
    if (!rateLimit.success) return rateLimit.response;

    const formData = await request.formData();
    const file = formData.get("file");
    const purpose = formData.get("purpose") || "standard";

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No image file provided" }, { status: 400 });
    }

    const validation = validateImageUploadRequest({
      contentType: file.type,
      fileSize: file.size,
      purpose,
    });
    if (!validation.ok) {
      return NextResponse.json(
        { error: validation.error, maxBytes: validation.maxBytes },
        { status: validation.status }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const extension = EXTENSIONS_BY_CONTENT_TYPE[validation.contentType] || "bin";
    const baseName = sanitizeBaseName(file.name);
    const fileName = `users/${auth.user.id}/${Date.now()}_${baseName}.${extension}`;
    const publicUrl = await uploadToR2(buffer, fileName, validation.contentType);

    return NextResponse.json({ publicUrl });
  } catch (error) {
    logger.error("[Upload Direct] Request failed", error);
    return NextResponse.json({ error: "Failed to upload image to storage." }, { status: 500 });
  }
}
