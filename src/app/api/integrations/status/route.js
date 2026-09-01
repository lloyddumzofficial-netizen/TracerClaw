import { NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase";
import { requireBearerUser } from "@/lib/integrations/auth";
import { googleDriveConfigured } from "@/lib/integrations/googleDrive";
import { integrationsCryptoConfigured } from "@/lib/integrations/crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const { user, error } = await requireBearerUser(request);
  if (error) return error;

  const { data, error: readError } = await adminSupabase
    .from("user_integrations")
    .select("google_drive_email, google_drive_connected_at, webhook_url, webhook_enabled, webhook_last_status, webhook_last_delivered_at, webhook_last_error")
    .eq("user_id", user.id)
    .maybeSingle();

  if (readError) {
    return NextResponse.json({ error: "Failed to load integrations" }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    configured: {
      encryption: integrationsCryptoConfigured(),
      googleDrive: googleDriveConfigured(),
    },
    googleDrive: {
      connected: Boolean(data?.google_drive_connected_at),
      email: data?.google_drive_email || null,
      connectedAt: data?.google_drive_connected_at || null,
    },
    webhook: {
      configured: integrationsCryptoConfigured(),
      enabled: Boolean(data?.webhook_enabled),
      url: data?.webhook_url || "",
      lastStatus: data?.webhook_last_status || null,
      lastDeliveredAt: data?.webhook_last_delivered_at || null,
      lastError: data?.webhook_last_error || null,
    },
  });
}
