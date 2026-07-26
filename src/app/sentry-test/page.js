"use client";

import * as Sentry from "@sentry/nextjs";
import { useState } from "react";

export default function SentryTestPage() {
  const [sent, setSent] = useState(false);

  const sendTestError = () => {
    const error = new Error("DesaynClaw Sentry browser test error");
    Sentry.captureException(error, {
      tags: { source: "sentry-test-page" },
      extra: { route: "/sentry-test" },
    });
    setSent(true);
  };

  const throwUnhandledError = () => {
    throw new Error("DesaynClaw Sentry unhandled browser test error");
  };

  return (
    <main style={{ minHeight: "100vh", background: "#0a0a0a", color: "#fff", padding: "48px", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ maxWidth: "720px" }}>
        <h1 style={{ margin: "0 0 12px", fontSize: "32px" }}>Sentry Test</h1>
        <p style={{ color: "#aaa", lineHeight: 1.6 }}>
          Use this page after deployment to confirm browser errors arrive in Sentry.
        </p>
        <div style={{ display: "flex", gap: "12px", marginTop: "24px", flexWrap: "wrap" }}>
          <button onClick={sendTestError} style={{ padding: "12px 16px", border: "1px solid #444", background: "#FFD700", color: "#000", fontWeight: 700, cursor: "pointer" }}>
            Capture Test Error
          </button>
          <button onClick={throwUnhandledError} style={{ padding: "12px 16px", border: "1px solid #444", background: "#1a1a1a", color: "#fff", fontWeight: 700, cursor: "pointer" }}>
            Throw Unhandled Error
          </button>
        </div>
        {sent && <p style={{ color: "#4ade80", marginTop: "18px" }}>Test exception captured. Check Sentry Issues for the test error.</p>}
      </div>
    </main>
  );
}
