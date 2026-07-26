import { Resend } from "resend";
import { logger } from "@/lib/logger";
import { renderEmailLayout } from "./render";
import { emailTemplates } from "./templates";
import type { EmailTemplate, SendEmailInput, SendEmailResult } from "./types";

const EMAIL_FROM = "DesaynClaw Support <support@desaynclaw.com>";

let resendClient: Resend | null | undefined;

function getResendClient() {
  if (resendClient !== undefined) return resendClient;
  resendClient = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
  return resendClient;
}

export function isEmailTemplate(template: string): template is EmailTemplate {
  return template in emailTemplates;
}

export function renderEmail(template: EmailTemplate, data = {}) {
  const renderer = emailTemplates[template];
  return renderEmailLayout(renderer(data));
}

export async function sendEmail({
  to,
  subject,
  template,
  data = {},
}: SendEmailInput): Promise<SendEmailResult> {
  const client = getResendClient();
  if (!client) {
    logger.warn("[Email] RESEND_API_KEY is not configured", { template });
    return { success: false, error: "Email service is not configured" };
  }

  if (!to || (Array.isArray(to) && to.length === 0)) {
    return { success: false, error: "Recipient is required" };
  }

  if (!subject?.trim()) {
    return { success: false, error: "Subject is required" };
  }

  try {
    const response = await client.emails.send({
      from: EMAIL_FROM,
      to,
      subject,
      html: renderEmail(template, data),
    });

    if (response.error) {
      logger.error("[Email] Resend returned an error", { template, error: response.error });
      return { success: false, error: response.error.message || "Failed to send email" };
    }

    logger.info("[Email] Sent", { template, to });
    return { success: true, id: response.data?.id };
  } catch (error) {
    logger.error("[Email] Failed to send", { template, error });
    return { success: false, error: error instanceof Error ? error.message : "Failed to send email" };
  }
}
