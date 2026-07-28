import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

function isLocalhostEvent(event) {
  const headers = event?.request?.headers || {};
  const host = headers.host || headers.Host;
  const urls = [
    event?.request?.url,
    host ? `http://${host}` : null,
  ].filter(Boolean);

  return urls.some((url) => {
    try {
      const hostname = new URL(url).hostname;
      return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
    } catch {
      return false;
    }
  });
}

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.NODE_ENV || "production",
    release: process.env.NEXT_PUBLIC_SENTRY_RELEASE || undefined,
    tracesSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE || 0.05),
    beforeSend(event) {
      if (isLocalhostEvent(event)) return null;
      return event;
    },
  });
}
