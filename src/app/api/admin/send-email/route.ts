import { NextResponse } from "next/server";
import { sendEmail, isEmailTemplate } from "@/lib/email";
import { logger } from "@/lib/logger";
import { enforceRateLimit } from "@/lib/rateLimit";
import { adminSupabase } from "@/lib/supabase";
import type { EmailData } from "@/lib/email";

type SendEmailRequestBody = {
  to?: string;
  subject?: string;
  template?: string;
  message?: string;
  data?: EmailData;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function requireAdmin(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) return { ok: false as const, status: 401, error: "Unauthorized" };

  const token = authHeader.replace("Bearer ", "").trim();
  const { data: { user }, error: authErr } = await adminSupabase.auth.getUser(token);
  const adminEmail = process.env.ADMIN_EMAIL;
  const isAdmin = Boolean(
    adminEmail &&
    user?.email &&
    user.email.toLowerCase() === adminEmail.toLowerCase()
  );

  if (authErr || !isAdmin) {
    return { ok: false as const, status: 403, error: "Forbidden. Admin access required." };
  }

  // Returned so the caller can key a rate limit on the verified admin.
  return { ok: true as const, userId: user.id };
}

export async function POST(request: Request) {
  const admin = await requireAdmin(request);
  if (!admin.ok) {
    return NextResponse.json({ success: false, error: admin.error }, { status: admin.status });
  }

  // Bounds the Resend quota. The admin gate controls who can send, not how many.
  const rateLimit = await enforceRateLimit({
    namespace: "api:admin-send-email:user",
    identifier: admin.userId,
    max: 20,
    window: "60 s",
    windowMs: 60_000,
  });
  if (!rateLimit.success) return rateLimit.response;

  let body: SendEmailRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const to = body.to?.trim();
  const subject = body.subject?.trim();
  const template = body.template?.trim();

  if (!to || !EMAIL_PATTERN.test(to)) {
    return NextResponse.json({ success: false, error: "Valid recipient email is required" }, { status: 400 });
  }

  if (!subject) {
    return NextResponse.json({ success: false, error: "Subject is required" }, { status: 400 });
  }

  if (!template || !isEmailTemplate(template)) {
    return NextResponse.json({ success: false, error: "Valid template is required" }, { status: 400 });
  }

  const result = await sendEmail({
    to,
    subject,
    template,
    data: {
      ...(body.data || {}),
      title: subject,
      message: body.message || body.data?.message,
    },
  });

  if ("error" in result) {
    logger.warn("[Admin Send Email] Failed", { to, template, error: result.error });
    return NextResponse.json(result, { status: 502 });
  }

  return NextResponse.json(result);
}
