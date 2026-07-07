"use client";

import { memo } from "react";
import { CreditCard } from "lucide-react";

const NoCreditsModal = memo(function NoCreditsModal({ show, onClose, onTopUp }) {
  if (!show) return null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" style={{ maxWidth: "400px", textAlign: "center", padding: "30px" }} onClick={e => e.stopPropagation()}>
        <div style={{ marginBottom: "16px", display: "flex", justifyContent: "center" }}>
          <CreditCard size={48} color="#FFD700" strokeWidth={1.5} />
        </div>
        <h3 style={{ margin: "0 0 10px", color: "#fff", fontWeight: "700", fontSize: "20px" }}>0 Traces Remaining</h3>
        <p style={{ color: "#aaa", fontSize: "14px", marginBottom: "24px", lineHeight: 1.5 }}>
          You don't have enough credits to run this generation. Please top up your account to continue.
        </p>
        <div style={{ display: "flex", gap: "10px" }}>
          <button
            onClick={onClose}
            style={{ flex: 1, padding: "12px", background: "transparent", color: "#888", border: "1px solid #333", borderRadius: "8px", cursor: "pointer", fontWeight: "600" }}
          >
            Close
          </button>
          <button
            onClick={() => { onClose(); onTopUp(); }}
            style={{ flex: 1, padding: "12px", background: "var(--accent)", color: "#000", border: "none", borderRadius: "6px", cursor: "pointer", fontWeight: "800", fontSize: "13px" }}
            onMouseOver={e => e.currentTarget.style.opacity = "0.9"}
            onMouseOut={e => e.currentTarget.style.opacity = "1"}
          >
            Top Up Now
          </button>
        </div>
      </div>
    </div>
  );
});

export default NoCreditsModal;
