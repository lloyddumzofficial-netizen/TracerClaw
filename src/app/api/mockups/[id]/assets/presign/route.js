import { NextResponse } from "next/server";
import { getUploadUrl } from "@/lib/cloudflare";
import { enforceRateLimit } from "@/lib/rateLimit";
import { requireUser } from "@/server/api/auth";
import { loadOwnedMockupProject } from "@/server/mockups";
import { validateMockupAsset } from "@/features/mockup-studio/config";
import { isGarmentPartAllowed } from "@/features/mockup-studio/garmentCatalog";

export async function POST(request, { params }) {
  const auth = await requireUser(request);
  if (auth.response) return auth.response;
  const limited = await enforceRateLimit({ namespace: "api:mockups:presign:user", identifier: auth.user.id, max: 30, window: "60 s", windowMs: 60_000 });
  if (!limited.success) return limited.response;
  const { id } = await params;
  const { project } = await loadOwnedMockupProject(auth.user.id, id);
  if (!project) return NextResponse.json({ error: "Mockup project not found." }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const validation = validateMockupAsset(body);
  if (!validation.ok) return NextResponse.json({ error: validation.error, maxBytes: validation.maxBytes }, { status: validation.status });
  if (!isGarmentPartAllowed(project.garment_type, body.role)) {
    return NextResponse.json({ error: "This panel does not belong to the selected garment template." }, { status: 400 });
  }
  const extension = validation.contentType === "image/jpeg" || validation.contentType === "image/jpg" ? "jpg" : validation.contentType.split("/")[1];
  const key = `users/${auth.user.id}/mockups/${id}/inputs/${body.role}-${Date.now()}.${extension}`;
  const urls = await getUploadUrl(key, validation.contentType, { fileSize: validation.fileSize, maxBytes: validation.part.maxBytes });
  return NextResponse.json(urls);
}
