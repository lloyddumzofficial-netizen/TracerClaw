import type { EmailData, EmailTemplateRenderResult } from "./types";

const SITE_URL = "https://desaynclaw.com";
const HEADER_URL = `${SITE_URL}/DESAYNCLAW_EMAIL-HEADER.jpg`;

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderVariables(value: string, data: EmailData): string {
  return value.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) =>
    escapeHtml(data[key])
  );
}

export function textToHtml(value: string, data: EmailData): string {
  return renderVariables(value, data)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("<br>");
}

export function field(data: EmailData, key: string, fallback = "N/A"): string {
  const value = data[key];
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}

export function renderEmailLayout(content: EmailTemplateRenderResult): string {
  const details = content.details?.filter((item) => item.value !== undefined && item.value !== null && item.value !== "");
  const headerUrl = content.headerImageUrl || HEADER_URL;
  const video = content.videoPreview;

  return `
    <!doctype html>
    <html>
      <head>
        <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${escapeHtml(content.title)}</title>
      </head>
      <body style="margin:0; padding:0; background-color:#eeeeee; font-family: Arial, Helvetica, sans-serif; color:#111827;">
        ${content.preheader ? `<div style="display:none; max-height:0; overflow:hidden; opacity:0; color:transparent; line-height:1px; font-size:1px; mso-hide:all;">${escapeHtml(content.preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>` : ""}
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#e8e8e8; margin:0; padding:0;">
          <tr>
            <td align="center" style="padding:8px 8px 0;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%; max-width:600px; margin:0 auto;">
                <tr>
                  <td style="padding:0; background-color:#08130f;">
                    <img src="${escapeHtml(headerUrl)}" width="600" alt="DesaynClaw" style="display:block; width:100%; max-width:600px; height:auto; border:0; outline:none; text-decoration:none;">
                  </td>
                </tr>
                <tr>
                  <td style="background-color:#ffffff; padding:24px 24px 28px;">
                    <h1 style="margin:0 0 18px; color:#111827; font-size:21px; line-height:1.3; font-weight:700;">
                      ${escapeHtml(content.title)}
                    </h1>

                    <div style="color:#1f2937; font-size:14px; line-height:1.65; margin:0 0 22px;">
                      ${content.body}
                    </div>

                    ${video ? `
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%; margin:2px 0 26px; border:1px solid #e4e4e4; border-radius:10px; background-color:#ffffff; border-collapse:separate; overflow:hidden;">
                      <tr>
                        <td style="padding:0; background-color:#0b0c0d; border-radius:9px 9px 0 0;">
                          <a href="${escapeHtml(video.url)}" target="_blank" style="display:block; color:#ffffff; text-decoration:none;">
                            <img src="${escapeHtml(video.thumbnailUrl)}" width="550" alt="${escapeHtml(video.title)}" style="display:block; width:100%; max-width:550px; height:auto; border:0; border-radius:9px 9px 0 0; outline:none; text-decoration:none;">
                          </a>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:20px 20px 18px; background-color:#ffffff; border-radius:0 0 9px 9px;">
                          ${video.eyebrow ? `<p style="margin:0 0 8px; color:#737373; font-size:10px; line-height:1.3; font-weight:700; letter-spacing:.11em; text-transform:uppercase;">${escapeHtml(video.eyebrow)}</p>` : ""}
                          <h2 style="margin:0 0 7px; color:#111111; font-size:19px; line-height:1.3; font-weight:700; letter-spacing:-.02em;">${escapeHtml(video.title)}</h2>
                          <p style="margin:0 0 16px; color:#606060; font-size:13px; line-height:1.55;">${escapeHtml(video.description)}</p>
                          <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                            <tr>
                              <td bgcolor="#111111" style="border-radius:6px;">
                                <a href="${escapeHtml(video.url)}" target="_blank" style="display:inline-block; padding:11px 16px; color:#ffffff; font-size:12px; line-height:1; font-weight:700; text-decoration:none;">
                                  &#9654;&nbsp;&nbsp;${escapeHtml(video.actionLabel || "Watch video")}
                                </a>
                              </td>
                              ${video.duration ? `<td style="padding-left:12px; color:#858585; font-size:11px; line-height:1.3; white-space:nowrap;">${escapeHtml(video.duration)}</td>` : ""}
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>
                    ` : ""}

                    ${details?.length ? `
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border:1px solid #e5e7eb; background-color:#fafafa; margin:0 0 24px;">
                      <tr>
                        <td colspan="2" style="padding:14px 16px 8px; color:#6b7280; font-size:11px; line-height:1.2; font-weight:700; text-transform:uppercase; letter-spacing:.08em;">
                          ${escapeHtml(content.detailsLabel || "Details")}
                        </td>
                      </tr>
                      ${details.map((item, index) => `
                      <tr>
                        <td style="padding:${index === 0 ? "8px" : "10px"} 16px ${index === details.length - 1 ? "16px" : "10px"}; color:#6b7280; font-size:13px; line-height:1.35; border-top:${index === 0 ? "0" : "1px solid #eeeeee"};">
                          ${escapeHtml(item.label)}
                        </td>
                        <td align="right" style="padding:${index === 0 ? "8px" : "10px"} 16px ${index === details.length - 1 ? "16px" : "10px"}; color:${item.highlight ? "#8a6d00" : "#111827"}; font-size:13px; line-height:1.35; font-weight:700; border-top:${index === 0 ? "0" : "1px solid #eeeeee"};">
                          ${escapeHtml(item.value)}
                        </td>
                      </tr>
                      `).join("")}
                    </table>
                    ` : ""}

                    ${content.cta ? `
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:4px 0 26px;">
                      <tr>
                        <td bgcolor="#f2cf00" style="border-radius:6px;">
                          <a href="${escapeHtml(content.cta.url)}" style="display:inline-block; padding:13px 22px; color:#111111; font-size:13px; line-height:1; font-weight:700; text-decoration:none;">
                            ${escapeHtml(content.cta.label)}
                          </a>
                        </td>
                      </tr>
                    </table>
                    ` : ""}

                    <p style="margin:0 0 16px; color:#374151; font-size:13px; line-height:1.55;">
                      If you have any questions or need help, just reply to this email.
                    </p>

                    <p style="margin:0; color:#111827; font-size:13px; line-height:1.55;">
                      Your growth partner,<br>
                      <strong>The DesaynClaw Team</strong>
                    </p>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding:16px 24px 10px; color:#9ca3af; font-size:11px; line-height:1.5;">
                    DesaynClaw AI-powered design workspace<br>
                    <a href="${SITE_URL}" style="color:#8b8b8b; text-decoration:underline;">desaynclaw.com</a>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding:0 24px 22px; color:#a3a3a3; font-size:11px; line-height:1.5;">
                    &copy; 2026 DesaynClaw. All rights reserved.
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
    `;
}
