"use client";

import { memo, useEffect, useState } from "react";
import { X, ShoppingCart } from "lucide-react";

const MESSENGER_URL = "https://m.me/105884602605306";
const STORAGE_KEY   = "sublibatch_seen_timestamp";
const ONE_DAY_MS    = 86400000; // 24 hours in ms
const PRIVACY_KEY   = "ai_disclaimer_seen";

/**
 * SublibatchModal
 * ─────────────────
 * Shows a full-image promotional popup once per day.
 * Uses localStorage to track when it was last dismissed —
 * completely free, no server round-trip, no cookies.
 *
 * Appears 1.5 s after mount so the page has time to settle.
 */
const SublibatchModal = memo(function SublibatchModal() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    let timer;

    const schedulePromo = () => {
      if (!localStorage.getItem(PRIVACY_KEY)) return;

      const lastSeen = localStorage.getItem(STORAGE_KEY);
      const now = Date.now();

      if (!lastSeen || now - parseInt(lastSeen, 10) > ONE_DAY_MS) {
        timer = setTimeout(() => setShow(true), 1500);
      }
    };

    schedulePromo();
    window.addEventListener("desaynclaw:data-privacy-accepted", schedulePromo);

    return () => {
      clearTimeout(timer);
      window.removeEventListener("desaynclaw:data-privacy-accepted", schedulePromo);
    };
  }, []);

  const handleClose = () => {
    localStorage.setItem(STORAGE_KEY, Date.now().toString());
    setShow(false);
  };

  const handleBuy = () => {
    window.open(MESSENGER_URL, "_blank", "noopener,noreferrer");
    handleClose();
  };

  if (!show) return null;

  return (
    <div
      onClick={handleClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 99990,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.88)",
        backdropFilter: "blur(10px)",
        padding: "20px",
        animation: "sublibatch-fade-in 0.35s ease",
      }}
    >
      {/* ── Modal card ── */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "relative",
          maxWidth: "720px",
          width: "100%",
          borderRadius: "4px",
          overflow: "hidden",
          boxShadow: "0 32px 64px -16px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,215,0,0.15)",
          animation: "sublibatch-slide-up 0.38s cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      >
        {/* ── Close ── */}
        <button
          onClick={handleClose}
          aria-label="Close promotion"
          style={{
            position: "absolute",
            top: "12px",
            right: "12px",
            background: "rgba(0,0,0,0.55)",
            border: "1px solid rgba(255,255,255,0.18)",
            color: "#fff",
            borderRadius: "50%",
            width: "34px",
            height: "34px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            zIndex: 10,
            transition: "background 0.2s, transform 0.15s",
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.background = "rgba(0,0,0,0.85)";
            e.currentTarget.style.transform = "scale(1.1)";
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.background = "rgba(0,0,0,0.55)";
            e.currentTarget.style.transform = "scale(1)";
          }}
        >
          <X size={16} />
        </button>

        {/* ── Promo image ── */}
        <img
          src="/sublibatch4.jpg"
          alt="SUBLIBATCH 4 — Limited Offer"
          style={{ width: "100%", height: "auto", display: "block" }}
        />

        {/* ── Buy Now bar ── */}
        <div
          style={{
            background: "#111",
            borderTop: "1px solid rgba(255,215,0,0.2)",
            padding: "16px 24px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px",
            flexWrap: "wrap",
          }}
        >
          <span style={{ color: "#aaa", fontSize: "13px", lineHeight: "1.5" }}>
            Limited batch — order now before slots fill up!
          </span>
          <button
            onClick={handleBuy}
            style={{
              background: "linear-gradient(135deg, #FFD700 0%, #FFA500 100%)",
              color: "#000",
              border: "none",
              padding: "11px 28px",
              borderRadius: "6px",
              fontSize: "14px",
              fontWeight: "800",
              letterSpacing: "0.8px",
              textTransform: "uppercase",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              whiteSpace: "nowrap",
              boxShadow: "0 4px 16px rgba(255,215,0,0.3)",
              transition: "transform 0.15s, box-shadow 0.15s",
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.transform = "translateY(-1px)";
              e.currentTarget.style.boxShadow = "0 6px 24px rgba(255,215,0,0.45)";
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.transform = "translateY(0)";
              e.currentTarget.style.boxShadow = "0 4px 16px rgba(255,215,0,0.3)";
            }}
          >
            <ShoppingCart size={16} />
            Buy Now
          </button>
        </div>
      </div>

      {/* ── Keyframe animations injected inline ── */}
      <style>{`
        @keyframes sublibatch-fade-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes sublibatch-slide-up {
          from { opacity: 0; transform: translateY(32px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0)    scale(1);    }
        }
      `}</style>
    </div>
  );
});

export default SublibatchModal;
