import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

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
  });

  if (typeof window !== "undefined") {
    window.Sentry = Sentry;
  }
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
