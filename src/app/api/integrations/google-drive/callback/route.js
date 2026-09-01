import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { exchangeCodeForTokens, googleDriveConfigured, saveGoogleDriveConnection } from "@/lib/integrations/googleDrive";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeLocalPath(path) {
  if (!path || typeof path !== "string" || !path.startsWith("/")) return "/";
  if (path.startsWith("//")) return "/";
  return path;
}

export async function GET(request) {
  const { searchParams, origin } = new URL(request.url);
  const cookieStore = await cookies();
  const next = safeLocalPath(cookieStore.get("desaynclaw_google_oauth_next")?.value || "/");
  const redirectUrl = new URL(next, origin);

  try {
    if (!googleDriveConfigured()) throw new Error("Google Drive integration is not configured.");

    const expectedState = cookieStore.get("desaynclaw_google_oauth_state")?.value;
    const state = searchParams.get("state");
    const code = searchParams.get("code");
    const providerError = searchParams.get("error");

    if (providerError) throw new Error(providerError);
    if (!code || !state || !expectedState || state !== expectedState) {
      throw new Error("Invalid Google OAuth state.");
    }

    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) throw new Error("Please sign in again before connecting Google Drive.");

    const tokens = await exchangeCodeForTokens({ code, origin });
    await saveGoogleDriveConnection(user.id, {
      refreshToken: tokens.refresh_token,
      accessToken: tokens.access_token,
    });

    redirectUrl.searchParams.set("integration", "google_drive_connected");
  } catch (error) {
    logger.warn("[Google Drive] OAuth callback failed", { error });
    redirectUrl.searchParams.set("integration_error", "google_drive_connect_failed");
  }

  cookieStore.delete("desaynclaw_google_oauth_state");
  cookieStore.delete("desaynclaw_google_oauth_next");
  return NextResponse.redirect(redirectUrl);
}
