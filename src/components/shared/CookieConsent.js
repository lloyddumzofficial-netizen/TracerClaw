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
    dismiss();
  };

  const decline = () => {
    localStorage.setItem("cookie_consent", "declined");
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
        background: "#1a1a1a",
        border: "1px solid #333",
        borderRadius: "16px",
        padding: "20px 24px",
        boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        gap: "16px",
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
      <div style={{ flexShrink: 0, background: "rgba(255,215,0,0.1)", padding: "10px", borderRadius: "10px" }}>
        <Cookie size={22} color="#FFD700" />
      </div>

      {/* Text */}
      <div style={{ flex: 1, minWidth: "200px" }}>
        <p style={{ margin: 0, color: "#ddd", fontSize: "14px", lineHeight: "1.6" }}>
          We use essential cookies and local storage to manage your session, remember your preferences, and keep the app working.
          {" "}
          <a href="/privacy" style={{ color: "#FFD700", textDecoration: "underline", whiteSpace: "nowrap" }}>
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
            border: "1px solid #444",
            color: "#888",
            padding: "8px 18px",
            borderRadius: "8px",
            fontSize: "13px",
            cursor: "pointer",
            transition: "all 0.2s",
            whiteSpace: "nowrap",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#666"; e.currentTarget.style.color = "#bbb"; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#444"; e.currentTarget.style.color = "#888"; }}
        >
          Decline
        </button>
        <button
          onClick={accept}
          style={{
            background: "#FFD700",
            border: "none",
            color: "#000",
            padding: "8px 20px",
            borderRadius: "8px",
            fontSize: "13px",
            fontWeight: "700",
            cursor: "pointer",
            transition: "all 0.2s",
            whiteSpace: "nowrap",
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = "#e6c200"}
          onMouseLeave={(e) => e.currentTarget.style.background = "#FFD700"}
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
