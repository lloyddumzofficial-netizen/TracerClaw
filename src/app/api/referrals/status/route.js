import { NextResponse } from "next/server";
import { referralsEnabled } from "@/server/referrals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    { enabled: referralsEnabled() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
