"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

/**
 * Route-level error boundary. Keeps the root layout mounted so a failure inside
 * one page (a modal, a canvas, a failed dynamic import) no longer blanks the
 * whole application.
 */
export default function Error({ error, reset }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <main style={{ minHeight: "100vh", background: "#0a0a0a", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", padding: "48px", fontFamily: "var(--font-manrope), 'Segoe UI', Arial, sans-serif" }}>
      <div style={{ maxWidth: "520px", textAlign: "center" }}>
        <h1 style={{ margin: "0 0 12px", fontSize: "28px", color: "#FFD700" }}>Something went wrong</h1>
        <p style={{ color: "#aaa", lineHeight: 1.6, margin: "0 0 24px" }}>
          This page could not be displayed. The issue has been reported automatically.
        </p>
        <div style={{ display: "flex", gap: "12px", justifyContent: "center", flexWrap: "wrap" }}>
          <button
            onClick={() => reset()}
            style={{ padding: "12px 24px", border: "none", borderRadius: "6px", background: "#FFD700", color: "#000", fontWeight: 600, fontSize: "15px", cursor: "pointer" }}
          >
            Try again
          </button>
          <a
            href="/"
            style={{ padding: "12px 24px", border: "1px solid #555", borderRadius: "6px", background: "#333", color: "#fff", fontWeight: 600, fontSize: "15px", textDecoration: "none" }}
          >
            Back to home
          </a>
        </div>
      </div>
    </main>
  );
}
