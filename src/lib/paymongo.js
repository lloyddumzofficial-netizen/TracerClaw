export function getPayMongoSecretKey() {
  const secretKey = process.env.PAYMONGO_SECRET_KEY;
  if (!secretKey) {
    throw new Error("PAYMONGO_SECRET_KEY is not configured");
  }
  return secretKey;
}

export function getPayMongoAuthHeader() {
  return `Basic ${Buffer.from(`${getPayMongoSecretKey()}:`).toString("base64")}`;
}

export function getSiteUrl(request) {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/$/, "");
  return new URL(request.url).origin;
}

