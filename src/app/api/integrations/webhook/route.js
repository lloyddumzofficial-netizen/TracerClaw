import { NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase";
import { requireBearerUser } from "@/lib/integrations/auth";
import { buildProjectCompletedPayload, deliverWebhook, upsertWebhookSettings } from "@/lib/integrations/webhook";
import { integrationsCryptoConfigured } from "@/lib/integrations/crypto";
import { enforceRateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";

export async function POST(request) {
  const { user, error } = await requireBearerUser(request);
  if (error) return error;

  const rateLimit = await enforceRateLimit({
    namespace: "api:integrations:webhook:user",
    identifier: user.id,
    max: 10,
    window: "60 s",
    windowMs: 60_000,
  });
  if (!rateLimit.success) return rateLimit.response;

  if (!integrationsCryptoConfigured()) {
    return NextResponse.json({ error: "Integrations encryption is not configured." }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));

  if (body.action === "test") {
    const payload = {
      event: "integration.test",
      message: "DesaynClaw webhook test",
      sentAt: new Date().toISOString(),
    };
    const result = await deliverWebhook(user.id, payload);
    if (!result.ok) return NextResponse.json({ error: "Webhook test failed", result }, { status: 502 });
    return NextResponse.json({ success: true, result });
  }

  const settings = await upsertWebhookSettings(user.id, {
    url: body.url,
    enabled: body.enabled !== false,
  });

  return NextResponse.json({
    success: true,
    webhook: {
      url: settings.url,
      enabled: settings.enabled,
      signingSecret: settings.signingSecret,
      signatureExample: {
        header: "X-DesaynClaw-Signature",
        format: "sha256=<hmac_sha256(timestamp + '.' + raw_json_body)>",
      },
      samplePayload: buildProjectCompletedPayload({
        id: "project_id",
        name: "Sample Project",
        svg_url: "https://example.com/vector.svg",
        upscaled_image_url: "https://example.com/output.png",
        zip_url: "https://example.com/files.zip",
      }),
    },
  });
}

export async function DELETE(request) {
  const { user, error } = await requireBearerUser(request);
  if (error) return error;

  const { error: updateError } = await adminSupabase
    .from("user_integrations")
    .update({ webhook_enabled: false })
    .eq("user_id", user.id);
  if (updateError) return NextResponse.json({ error: "Failed to disable webhook" }, { status: 500 });

  return NextResponse.json({ success: true });
}
