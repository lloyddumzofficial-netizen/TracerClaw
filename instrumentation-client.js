import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

function isLocalhostEvent(event) {
  const urls = [
    event?.request?.url,
    typeof window !== "undefined" ? window.location?.href : null,
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

function isZaloInjectedBrowserError(event, hint) {
  const message = [
    event?.message,
    event?.exception?.values?.[0]?.value,
    hint?.originalException?.message,
  ]
    .filter(Boolean)
    .join(" ");

  if (!/zaloJSV2/i.test(message)) return false;

  const userAgent =
    event?.request?.headers?.["User-Agent"] ||
    event?.request?.headers?.["user-agent"] ||
    (typeof navigator !== "undefined" ? navigator.userAgent : "");

  return /zalo/i.test(userAgent);
}

if (dsn) {
  const integrations = [];

  if (typeof Sentry.browserTracingIntegration === "function") {
    integrations.push(Sentry.browserTracingIntegration());
  }

  if (typeof Sentry.replayIntegration === "function") {
    integrations.push(
      Sentry.replayIntegration({
        maskAllText: true,
        blockAllMedia: true,
      })
    );
  }

  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.NODE_ENV || "production",
    release: process.env.NEXT_PUBLIC_SENTRY_RELEASE || undefined,
    tracesSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE || 0.05),
    replaysSessionSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_REPLAYS_SESSION_SAMPLE_RATE || 0),
    replaysOnErrorSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE || 0.1),
    integrations,
    beforeSend(event, hint) {
      if (isLocalhostEvent(event)) return null;
      if (isZaloInjectedBrowserError(event, hint)) return null;
      return event;
    },
  });

  if (typeof window !== "undefined") {
    window.Sentry = Sentry;
  }
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
