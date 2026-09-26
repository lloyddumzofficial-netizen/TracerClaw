import { NextResponse } from "next/server";

export const runtime = "nodejs";

// Kept as a permanent compatibility response for older app builds and bookmarks.
// New manual payment requests must never reach the approval queue.
export async function POST() {
  return NextResponse.json(
    {
      error: "Manual GCash submissions are no longer accepted. Please use automatic QR Ph checkout and scan with GCash or Maya.",
      code: "MANUAL_GCASH_DISABLED",
    },
    { status: 410 }
  );
}
