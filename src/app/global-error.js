"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

/**
 * Root error boundary.
 *
 * Without this file a render error anywhere in the tree produces a blank page,
 * and — more importantly — @sentry/nextjs cannot capture React render errors at
 * all, so the failure never reaches the dashboard. It replaces the root layout
 * when it renders, so it must supply its own <html>/<body>.
 */
export default function GlobalError({ error, reset }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#0a0a0a", color: "#fff", fontFamily: "system-ui, sans-serif" }}>
        <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "48px" }}>
          <div style={{ maxWidth: "520px", textAlign: "center" }}>
            <h1 style={{ margin: "0 0 12px", fontSize: "28px", color: "#FFD700" }}>Something went wrong</h1>
            <p style={{ color: "#aaa", lineHeight: 1.6, margin: "0 0 24px" }}>
              An unexpected error interrupted this page. The issue has been reported automatically.
            </p>
            <button
              onClick={() => reset()}
              style={{ padding: "12px 24px", border: "none", borderRadius: "6px", background: "#FFD700", color: "#000", fontWeight: 700, fontSize: "15px", cursor: "pointer" }}
            >
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
