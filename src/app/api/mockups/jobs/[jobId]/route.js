import { NextResponse } from "next/server";
import { requireUser } from "@/server/api/auth";
import { processMockupJob } from "@/server/mockups";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request, { params }) {
  const auth = await requireUser(request);
  if (auth.response) return auth.response;
  const { jobId } = await params;
  const result = await processMockupJob({ userId: auth.user.id, jobId });
  if (result.notFound) return NextResponse.json({ error: "Mockup render not found." }, { status: 404 });
  return NextResponse.json(result);
}
