import type { EmailData, EmailTemplateRenderResult } from "./types";

const SITE_URL = "https://desaynclaw.com";
const LOGO_URL = `${SITE_URL}/logo.png`;

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

  return `
      <div style="background-color: #1a1a1a; color: #ffffff; font-family: 'Inter', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 40px 20px; text-align: center;">
        <div style="max-width: 500px; margin: 0 auto; background-color: #262626; border: 1px solid #444444; padding: 40px 30px; border-radius: 8px;">
          <div style="text-align: center; margin-bottom: 24px;">
            <img src="${LOGO_URL}" alt="DesaynClaw Logo" style="max-width: 240px; height: auto; display: inline-block;" />
          </div>
          <hr style="border: 0; border-top: 1px solid #444; margin: 24px 0;">
          <h2 style="font-size: 20px; font-weight: 600; margin-bottom: 12px; color: #ffffff;">${escapeHtml(content.title)}</h2>
          <p style="color: #cccccc; font-size: 15px; line-height: 1.6; margin-bottom: 30px;">
            ${content.body}
          </p>

          ${details?.length ? `
          <div style="background-color: #1a1a1a; border: 1px solid #333333; padding: 20px; border-radius: 6px; margin-bottom: 30px; text-align: left;">
            <p style="margin: 0 0 10px 0; color: #888888; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;">${escapeHtml(content.detailsLabel || "Details")}</p>
            ${details.map((item, index) => `
            <div style="display: flex; justify-content: space-between; margin-bottom: ${index === details.length - 1 ? "0" : "8px"};">
              <span style="color: #aaaaaa; font-size: 14px;">${escapeHtml(item.label)}:</span>
              <strong style="color: ${item.highlight ? "#FFD700" : "#ffffff"}; font-size: ${item.highlight ? "15px" : "14px"};">${escapeHtml(item.value)}</strong>
            </div>
            `).join("")}
          </div>
          ` : ""}

          ${content.cta ? `
          <a href="${escapeHtml(content.cta.url)}" style="display: inline-block; background-color: #FFD700; color: #000000; text-decoration: none; padding: 14px 28px; font-weight: 700; border-radius: 4px; font-size: 15px;">
            ${escapeHtml(content.cta.label)}
          </a>
          ` : ""}

          <p style="color: #666666; font-size: 12px; margin-top: 40px; line-height: 1.5;">
            If you have any questions or need help, just reply to this email.<br>
            &copy; 2026 DesaynClaw. All rights reserved.
          </p>
        </div>
      </div>
    `;
}
