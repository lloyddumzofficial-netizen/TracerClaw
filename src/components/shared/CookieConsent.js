"use client";

import { useState, useEffect } from "react";
import { X, Cookie } from "lucide-react";

export default function CookieConsent() {
  const [visible, setVisible] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const consent = localStorage.getItem("cookie_consent");
    if (!consent) {
      // Slight delay so it doesn't pop up on initial render flash
      const t = setTimeout(() => setVisible(true), 1500);
      return () => clearTimeout(t);
    }
  }, []);

  const accept = () => {
    localStorage.setItem("cookie_consent", "accepted");
    window.dispatchEvent(new CustomEvent("desaynclaw:cookie-consent", { detail: "accepted" }));
    dismiss();
  };

  const decline = () => {
    localStorage.setItem("cookie_consent", "declined");
    window.dispatchEvent(new CustomEvent("desaynclaw:cookie-consent", { detail: "declined" }));
    dismiss();
  };

  const dismiss = () => {
    setLeaving(true);
    setTimeout(() => setVisible(false), 400);
  };

  if (!visible) return null;

  return (
    <div
      style={{
        position: "fixed",
        bottom: "20px",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 99998,
        maxWidth: "680px",
        width: "calc(100% - 40px)",
        background: "linear-gradient(180deg, rgba(255,255,255,0.028), rgba(255,255,255,0.01)), #151515",
        border: "1px solid rgba(255,255,255,0.13)",
        borderRadius: "6px",
        padding: "16px 18px",
        boxShadow: "0 18px 60px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.04)",
        display: "flex",
        alignItems: "center",
        gap: "14px",
        flexWrap: "wrap",
        animation: leaving ? "slideDown 0.4s ease forwards" : "slideUp 0.4s ease",
      }}
    >
      <style>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translateX(-50%) translateY(30px); }
          to   { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
        @keyframes slideDown {
          from { opacity: 1; transform: translateX(-50%) translateY(0); }
          to   { opacity: 0; transform: translateX(-50%) translateY(30px); }
        }
      `}</style>

      {/* Icon */}
      <div style={{
        flexShrink: 0,
        width: "38px",
        height: "38px",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(255,255,255,0.045)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: "5px"
      }}>
        <Cookie size={18} color="rgba(255,215,0,0.82)" />
      </div>

      {/* Text */}
      <div style={{ flex: 1, minWidth: "200px" }}>
        <p style={{ margin: 0, color: "rgba(255,255,255,0.72)", fontSize: "13.5px", lineHeight: "1.55", fontWeight: 400 }}>
          We use essential cookies and local storage to manage your session, remember your preferences, and keep the app working.
          {" "}
          <a href="/privacy" style={{ color: "rgba(255,215,0,0.9)", textDecoration: "none", borderBottom: "1px solid rgba(255,215,0,0.45)", whiteSpace: "nowrap" }}>
            Privacy Policy
          </a>
        </p>
      </div>

      {/* Buttons */}
      <div style={{ display: "flex", gap: "10px", flexShrink: 0, alignItems: "center" }}>
        <button
          onClick={decline}
          style={{
            background: "transparent",
            border: "1px solid rgba(255,255,255,0.14)",
            color: "rgba(255,255,255,0.56)",
            padding: "8px 18px",
            borderRadius: "5px",
            fontSize: "13px",
            cursor: "pointer",
            transition: "all 0.2s",
            whiteSpace: "nowrap",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.24)"; e.currentTarget.style.color = "rgba(255,255,255,0.78)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.14)"; e.currentTarget.style.color = "rgba(255,255,255,0.56)"; }}
        >
          Decline
        </button>
        <button
          onClick={accept}
          style={{
            background: "#f4f4f4",
            border: "1px solid #f4f4f4",
            color: "#050505",
            padding: "8px 20px",
            borderRadius: "5px",
            fontSize: "13px",
            fontWeight: "600",
            cursor: "pointer",
            transition: "all 0.2s",
            whiteSpace: "nowrap",
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = "#ffffff"}
          onMouseLeave={(e) => e.currentTarget.style.background = "#f4f4f4"}
        >
          Accept All
        </button>

        {/* Close X */}
        <button
          onClick={dismiss}
          style={{ background: "none", border: "none", color: "#555", cursor: "pointer", padding: "4px", display: "flex", alignItems: "center", transition: "color 0.2s" }}
          onMouseEnter={(e) => e.currentTarget.style.color = "#aaa"}
          onMouseLeave={(e) => e.currentTarget.style.color = "#555"}
          aria-label="Dismiss cookie banner"
        >
          <X size={18} />
        </button>
      </div>
    </div>
  );
}
