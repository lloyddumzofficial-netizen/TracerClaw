import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { buildGoogleAuthUrl, googleDriveConfigured } from "@/lib/integrations/googleDrive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeLocalPath(path) {
  if (!path || typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")) return "/";
  return path;
}

function redirectBackWithError(next, origin, error) {
  const redirectUrl = new URL(safeLocalPath(next), origin);
  redirectUrl.searchParams.set("integration_error", error);
  return NextResponse.redirect(redirectUrl);
}

export async function GET(request) {
  const { origin, searchParams } = new URL(request.url);
  const next = safeLocalPath(searchParams.get("next") || "/");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL(`/?login=1&next=${encodeURIComponent(next)}`, origin));

  if (!googleDriveConfigured()) {
    return redirectBackWithError(next, origin, "google_drive_not_configured");
  }

  const state = randomBytes(24).toString("base64url");
  const cookieStore = await cookies();
  cookieStore.set("desaynclaw_google_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 10 * 60,
  });
  cookieStore.set("desaynclaw_google_oauth_next", next, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 10 * 60,
  });

  return NextResponse.redirect(buildGoogleAuthUrl({ state, origin }));
}
