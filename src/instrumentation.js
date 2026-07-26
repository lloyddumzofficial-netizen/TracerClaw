import * as Sentry from "@sentry/nextjs";
import { validateProductionEnv } from "@/lib/healthChecks";

export async function register() {
  validateProductionEnv();

  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;

  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
