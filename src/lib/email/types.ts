export type EmailTemplate =
  | "welcome"
  | "emailVerification"
  | "passwordReset"
  | "creditsAdded"
  | "purchaseReceipt"
  | "support"
  | "supportReply"
  | "affiliateApproval"
  | "newsletter"
  | "custom";

export type EmailData = Record<string, string | number | boolean | null | undefined>;

export type EmailTemplateRenderResult = {
  title: string;
  body: string;
  detailsLabel?: string;
  details?: Array<{ label: string; value: string | number | null | undefined; highlight?: boolean }>;
  cta?: { label: string; url: string };
};

export type EmailTemplateRenderer = (data: EmailData) => EmailTemplateRenderResult;

export type SendEmailInput = {
  to: string | string[];
  subject: string;
  template: EmailTemplate;
  data?: EmailData;
};

export type SendEmailResult =
  | { success: true; id?: string }
  | { success: false; error: string };
