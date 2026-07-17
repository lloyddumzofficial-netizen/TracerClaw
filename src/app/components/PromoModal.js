"use client";

import { memo, useEffect, useState } from "react";
import { X, ShoppingCart } from "lucide-react";

/**
 * PromoModal — A lightweight promotional popup that displays a banner.
 * Uses localStorage so it doesn't spam the user on every reload.
 */
const PromoModal = memo(function PromoModal({ onBuyClick }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    // Only show if they haven't closed it in the last 24 hours
    const lastSeen = localStorage.getItem("promo_seen_timestamp");
    const now = Date.now();

    // Show after 2 seconds for a nice effect
    if (!lastSeen || now - parseInt(lastSeen) > 86400000) { // 24 hours
      const timer = setTimeout(() => {
        setShow(true);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, []);

  const handleClose = () => {
    setShow(false);
    localStorage.setItem("promo_seen_timestamp", Date.now().toString());
  };

  const handleBuy = () => {
    if (onBuyClick) onBuyClick();
    handleClose();
  };

  if (!show) return null;

  return (
    <div className="modal-overlay" style={{ zIndex: 9999, display: "flex", justifyContent: "center", alignItems: "center", backgroundColor: "rgba(0,0,0,0.85)", backdropFilter: "blur(8px)" }}>
      <div
        className="modal-content"
        style={{
          maxWidth: "900px",
          width: "95%",
          padding: 0,
          borderRadius: "0",
          overflow: "hidden",
          background: "transparent",
          position: "relative",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.7)",
          border: "none"
        }}
      >
        {/* Close Button */}
        <button
          onClick={handleClose}
          style={{
            position: "absolute",
            top: "16px",
            right: "16px",
            background: "rgba(0,0,0,0.5)",
            border: "1px solid rgba(255,255,255,0.2)",
            color: "#fff",
            borderRadius: "50%",
            width: "32px",
            height: "32px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            zIndex: 10,
            transition: "all 0.2s"
          }}
          onMouseOver={(e) => { e.currentTarget.style.background = "rgba(0,0,0,0.8)"; }}
          onMouseOut={(e) => { e.currentTarget.style.background = "rgba(0,0,0,0.5)"; }}
        >
          <X size={16} />
        </button>

        {/* Promo Image ONLY */}
        <img
          src="/DESAYNCLAW.jpg"
          alt="Announcement"
          style={{ width: "100%", height: "auto", display: "block" }}
        />
      </div>
    </div>
  );
});

export default PromoModal;
