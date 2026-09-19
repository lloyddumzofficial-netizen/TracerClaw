import { NextResponse } from "next/server";
import sharp from "sharp";
import { requireUser } from "@/server/api/auth";
import { adminSupabase } from "@/lib/supabase";
import { loadOwnedMockupProject } from "@/server/mockups";
import { fetchWithSSRFProtection, getAllowedStorageHosts, isOwnedStorageUrl } from "@/lib/ssrf";
import { MOCKUP_MAX_PIXELS, MOCKUP_PARTS, MOCKUP_TOTAL_MAX_BYTES, validateMockupAsset } from "@/features/mockup-studio/config";
import { isGarmentPartAllowed } from "@/features/mockup-studio/garmentCatalog";
import { getPanelPreparationSpec, matchesPanelPreparationSpec } from "@/features/mockup-studio/panelPreparation/panelSpecs";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request, { params }) {
  const auth = await requireUser(request);
  if (auth.response) return auth.response;
  const { id } = await params;
  const { project } = await loadOwnedMockupProject(auth.user.id, id);
  if (!project) return NextResponse.json({ error: "Mockup project not found." }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  const validation = validateMockupAsset(body);
  if (!validation.ok) return NextResponse.json({ error: validation.error }, { status: validation.status });
  if (!isGarmentPartAllowed(project.garment_type, body.role)) {
    return NextResponse.json({ error: "This panel does not belong to the selected garment template." }, { status: 400 });
  }
  if (!isOwnedStorageUrl(body.fileUrl, { userId: auth.user.id })) {
    return NextResponse.json({ error: "Invalid asset URL." }, { status: 400 });
  }

  let fetched;
  try {
    fetched = await fetchWithSSRFProtection(body.fileUrl, {
      allowedHosts: getAllowedStorageHosts(),
      maxBytes: validation.part.maxBytes,
      allowedContentTypes: ["image/"],
    });
  } catch {
    return NextResponse.json({ error: "Uploaded file could not be verified." }, { status: 400 });
  }
  if (!fetched.response.ok) {
    return NextResponse.json({ error: "Uploaded file could not be verified." }, { status: 400 });
  }
  const verifiedFileSize = fetched.buffer.length;
  const metadata = await sharp(fetched.buffer, { limitInputPixels: MOCKUP_MAX_PIXELS * MOCKUP_MAX_PIXELS }).metadata().catch(() => null);
  if (!metadata?.width || !metadata?.height || metadata.width > MOCKUP_MAX_PIXELS || metadata.height > MOCKUP_MAX_PIXELS) {
    return NextResponse.json({ error: `Image dimensions must not exceed ${MOCKUP_MAX_PIXELS} × ${MOCKUP_MAX_PIXELS}px.` }, { status: 400 });
  }
  const panelSpec = getPanelPreparationSpec(project.garment_type, body.role);
  if (!matchesPanelPreparationSpec(panelSpec, metadata.width, metadata.height)) {
    return NextResponse.json({
      error: `${panelSpec.label} must be fitted to exactly ${panelSpec.width} × ${panelSpec.height}px before upload. Reopen Panel Fit and apply the production frame.`,
    }, { status: 400 });
  }

  const { data: existing } = await adminSupabase.from("mockup_assets").select("role,file_size")
    .eq("project_id", id).eq("user_id", auth.user.id);
  const totalWithoutRole = (existing || []).filter(item => item.role !== body.role).reduce((sum, item) => sum + Number(item.file_size || 0), 0);
  if (totalWithoutRole + verifiedFileSize > MOCKUP_TOTAL_MAX_BYTES) {
    return NextResponse.json({ error: "This mockup project exceeds the 150MB total asset limit." }, { status: 413 });
  }

  const record = {
    project_id: id,
    user_id: auth.user.id,
    role: body.role,
    file_url: body.fileUrl,
    mime_type: validation.contentType,
    file_size: verifiedFileSize,
    width: metadata.width,
    height: metadata.height,
  };
  const { data, error } = await adminSupabase.from("mockup_assets").upsert(record, { onConflict: "project_id,role" }).select("*").single();
  if (error) return NextResponse.json({ error: "Could not register mockup asset." }, { status: 500 });
  return NextResponse.json({ asset: data });
}

export async function DELETE(request, { params }) {
  const auth = await requireUser(request);
  if (auth.response) return auth.response;
  const { id } = await params;
  const role = new URL(request.url).searchParams.get("role");
  if (!MOCKUP_PARTS[role]) return NextResponse.json({ error: "Invalid garment part." }, { status: 400 });
  const { project } = await loadOwnedMockupProject(auth.user.id, id);
  if (!project) return NextResponse.json({ error: "Mockup project not found." }, { status: 404 });
  if (!isGarmentPartAllowed(project.garment_type, role)) {
    return NextResponse.json({ error: "This panel does not belong to the selected garment template." }, { status: 400 });
  }
  const { error } = await adminSupabase.from("mockup_assets").delete()
    .eq("project_id", id).eq("user_id", auth.user.id).eq("role", role);
  if (error) return NextResponse.json({ error: "Could not remove mockup asset." }, { status: 500 });
  return NextResponse.json({ success: true });
}
