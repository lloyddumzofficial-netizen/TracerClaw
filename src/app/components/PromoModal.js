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
          maxWidth: "640px", 
          width: "95%", 
          padding: 0, 
          borderRadius: "0", 
          overflow: "hidden", 
          background: "#0a0a0a", 
          position: "relative",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.7)",
          border: "1px solid #222"
        }}
      >
        {/* Close Button */}
        <button 
          onClick={handleClose} 
          style={{ 
            position: "absolute", 
            top: "16px", 
            right: "16px", 
            background: "#000", 
            border: "1px solid #333", 
            color: "#fff", 
            borderRadius: "0", 
            width: "32px", 
            height: "32px", 
            display: "flex", 
            alignItems: "center", 
            justifyContent: "center", 
            cursor: "pointer",
            zIndex: 10,
            transition: "all 0.2s"
          }}
          onMouseOver={(e) => { e.currentTarget.style.background = "#222"; e.currentTarget.style.borderColor = "#555"; }}
          onMouseOut={(e) => { e.currentTarget.style.background = "#000"; e.currentTarget.style.borderColor = "#333"; }}
        >
          <X size={16} />
        </button>

        {/* Promo Image */}
        <img 
          src="/a-clean--minimal-social-media-promotional-banner-f-01.jpg" 
          alt="Limited Time Offer" 
          style={{ width: "100%", height: "auto", display: "block", borderBottom: "1px solid #222" }} 
        />

        {/* Action Area */}
        <div style={{ padding: "32px 40px", display: "flex", flexDirection: "column", gap: "20px", textAlign: "center" }}>
          <div>
            <h3 style={{ margin: "0 0 8px 0", fontSize: "22px", color: "#fff", fontWeight: "600", letterSpacing: "-0.5px" }}>Get SubliBatch Pro V4</h3>
            <p style={{ margin: 0, color: "#888", fontSize: "14px", lineHeight: "1.6", fontWeight: "400" }}>
              Unlock the ultimate automation tool for Photoshop. Speed up your workflow with multi-template outputs and anti-crash technology.
            </p>
          </div>
          
          <button 
            className="btn-primary" 
            onClick={handleBuy}
            style={{ 
              background: "#FFD700", 
              color: "#000", 
              fontWeight: "700", 
              fontSize: "15px",
              letterSpacing: "1px",
              padding: "18px", 
              borderRadius: "0", 
              display: "flex", 
              justifyContent: "center", 
              alignItems: "center", 
              gap: "10px",
              border: "none",
              cursor: "pointer",
              textTransform: "uppercase",
              transition: "transform 0.1s, background 0.2s"
            }}
            onMouseOver={(e) => { e.currentTarget.style.background = "#E5B800"; }}
            onMouseOut={(e) => { e.currentTarget.style.background = "#FFD700"; }}
            onMouseDown={(e) => { e.currentTarget.style.transform = "scale(0.98)"; }}
            onMouseUp={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
          >
            <ShoppingCart size={18} />
            BUY NOW - ₱850
          </button>
          
          <button 
            onClick={handleClose} 
            style={{ 
              background: "transparent", 
              border: "none", 
              color: "#555", 
              fontSize: "13px", 
              cursor: "pointer", 
              textDecoration: "none",
              transition: "color 0.2s"
            }}
            onMouseOver={(e) => e.currentTarget.style.color = "#888"}
            onMouseOut={(e) => e.currentTarget.style.color = "#555"}
          >
            I'll pass for now
          </button>
        </div>
      </div>
    </div>
  );
});

export default PromoModal;
