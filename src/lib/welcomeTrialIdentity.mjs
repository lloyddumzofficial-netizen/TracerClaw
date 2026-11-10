import { createHmac } from "node:crypto";

// Keep hashes compatible between the callback and the offline backfill script.
export function canonicalTrialEmail(email) {
  const normalized = String(email || "").trim().toLowerCase();
  const [local, domain] = normalized.split("@");
  if (!local || !domain || normalized.split("@").length !== 2) return "";
  if (domain === "gmail.com" || domain === "googlemail.com") {
    return `${local.split("+")[0].replaceAll(".", "")}@gmail.com`;
  }
  return normalized;
}

export function trialFingerprint(kind, value, secret) {
  if (!secret || secret.length < 32) throw new Error("Trial signing secret is not configured");
  return createHmac("sha256", secret).update(`welcome-trial:${kind}:${value}`).digest("hex");
}
