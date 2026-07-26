import { field, textToHtml } from "./render";
import type { EmailData, EmailTemplateRenderer } from "./types";

const HOME_CTA = { label: "Open DesaynClaw", url: "https://desaynclaw.com" };

const supportTemplate = (data: EmailData) => ({
  title: field(data, "title", "Support Reply"),
  body: textToHtml(field(data, "message", "Hello,\n\nThank you for contacting DesaynClaw Support."), data),
});

export const emailTemplates = {
  welcome: (data: EmailData) => ({
    title: "Welcome to DesaynClaw",
    body: textToHtml("Hello {{name}},\n\nWelcome to DesaynClaw. Your account is ready.", data),
    cta: HOME_CTA,
  }),

  emailVerification: (data: EmailData) => ({
    title: "Verify Your Email",
    body: textToHtml("Hello {{name}},\n\nPlease verify your email to finish securing your DesaynClaw account.", data),
    details: [{ label: "Verification Link", value: field(data, "verificationUrl") }],
    cta: { label: "Verify Email", url: field(data, "verificationUrl", "https://desaynclaw.com") },
  }),

  passwordReset: (data: EmailData) => ({
    title: "Reset Your Password",
    body: textToHtml("Hello {{name}},\n\nUse the secure link below to reset your DesaynClaw password.", data),
    details: [{ label: "Reset Link", value: field(data, "resetUrl") }],
    cta: { label: "Reset Password", url: field(data, "resetUrl", "https://desaynclaw.com") },
  }),

  creditsAdded: (data: EmailData) => ({
    title: "Payment Approved!",
    body: textToHtml("Good news! Your payment has been verified and your credits have been successfully added to your account.", data),
    detailsLabel: "Package Details",
    details: [
      { label: "Plan", value: field(data, "plan") },
      { label: "Credits Added", value: `+${field(data, "credits", "0")} Traces`, highlight: true },
      { label: "Reference No", value: field(data, "reference") },
      { label: "Current Credits", value: field(data, "currentCredits") },
    ],
    cta: { label: "Start Tracing Now", url: "https://desaynclaw.com" },
  }),

  purchaseReceipt: (data: EmailData) => ({
    title: "Payment Successful",
    body: textToHtml("Your payment was confirmed and your credits have been automatically added to your DesaynClaw account.", data),
    detailsLabel: "Package Details",
    details: [
      { label: "Plan", value: field(data, "plan") },
      { label: "Credits Added", value: `+${field(data, "credits", "0")} Traces`, highlight: true },
      { label: "Receipt Number", value: field(data, "receipt") },
      { label: "Payment ID", value: field(data, "paymentId") },
    ],
    cta: { label: "Start Tracing Now", url: "https://desaynclaw.com" },
  }),

  support: supportTemplate,

  supportReply: supportTemplate,

  affiliateApproval: (data: EmailData) => ({
    title: "Affiliate Approved",
    body: textToHtml("Hello {{name}},\n\nYour DesaynClaw affiliate application has been approved.", data),
    details: [{ label: "Affiliate Link", value: field(data, "affiliateUrl") }],
    cta: { label: "Open Affiliate Dashboard", url: field(data, "affiliateUrl", "https://desaynclaw.com") },
  }),

  newsletter: (data: EmailData) => ({
    title: field(data, "title", "DesaynClaw Update"),
    body: textToHtml(field(data, "message", "Hello {{name}},\n\nHere is the latest from DesaynClaw."), data),
    cta: data.ctaUrl ? { label: field(data, "ctaLabel", "Read More"), url: field(data, "ctaUrl") } : undefined,
  }),

  custom: (data: EmailData) => ({
    title: field(data, "title", "Message from DesaynClaw"),
    body: textToHtml(field(data, "message", "Hello,\n\n{{message}}"), data),
    cta: data.ctaUrl ? { label: field(data, "ctaLabel", "Open DesaynClaw"), url: field(data, "ctaUrl") } : undefined,
  }),
} satisfies Record<string, EmailTemplateRenderer>;
