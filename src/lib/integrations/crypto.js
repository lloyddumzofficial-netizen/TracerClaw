import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";

function getKey() {
  const raw = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (!raw || raw.trim().length < 24) return null;
  return createHash("sha256").update(raw).digest();
}

export function integrationsCryptoConfigured() {
  return Boolean(getKey());
}

export function encryptSecret(value) {
  const key = getKey();
  if (!key) throw new Error("INTEGRATION_ENCRYPTION_KEY is not configured");

  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptSecret(payload) {
  const key = getKey();
  if (!key) throw new Error("INTEGRATION_ENCRYPTION_KEY is not configured");
  if (!payload || typeof payload !== "string") return "";

  const [version, iv, tag, ciphertext] = payload.split(".");
  if (version !== VERSION || !iv || !tag || !ciphertext) {
    throw new Error("Invalid encrypted integration secret");
  }

  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
