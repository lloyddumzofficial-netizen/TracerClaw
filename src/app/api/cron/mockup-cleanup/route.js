import { NextResponse } from "next/server";
import { cleanupExpiredMockupProjects } from "@/server/mockups";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request) {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await cleanupExpiredMockupProjects({ limit: 25 });
    return NextResponse.json({ success: true, ...result });
  } catch (caught) {
    return NextResponse.json({ error: "Mockup cleanup failed.", detail: caught?.message }, { status: 500 });
  }
}
