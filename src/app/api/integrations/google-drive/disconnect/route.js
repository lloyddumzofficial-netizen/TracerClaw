import { NextResponse } from "next/server";
import { requireBearerUser } from "@/lib/integrations/auth";
import { disconnectGoogleDrive } from "@/lib/integrations/googleDrive";

export const runtime = "nodejs";

export async function POST(request) {
  const { user, error } = await requireBearerUser(request);
  if (error) return error;

  await disconnectGoogleDrive(user.id);
  return NextResponse.json({ success: true });
}
