"use client";

import { memo } from "react";
import { Shirt } from "lucide-react";

const OnboardingModal = memo(function OnboardingModal({ show, onClose }) {
  if (!show) return null;

  return (
    <div className="modal-overlay" style={{ zIndex: 9999 }}>
      <div 
        className="modal-content" 
        style={{ maxWidth: "500px", padding: "40px", textAlign: "center", background: "#0a0a0a", border: "1px solid #222", borderRadius: "0" }} 
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ marginBottom: "32px" }}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: "20px" }}>
            <div style={{ background: "#111", border: "1px solid #333", borderRadius: "50%", width: "72px", height: "72px", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Shirt size={32} color="#FFD700" />
            </div>
          </div>
          <h2 style={{ margin: "0 0 10px", fontWeight: "800", fontSize: "24px", color: "#fff", letterSpacing: "-0.5px" }}>Congratulations! You received 1 Free Credit.</h2>
          <p style={{ color: "#888", fontSize: "14px", margin: 0, lineHeight: "1.5" }}>Welcome to DesaynClaw! Before you start, let's quickly go over how it works.</p>
        </div>

        {/* How it works */}
        <div style={{ background: "#111", border: "1px solid #222", borderRadius: "0", padding: "24px", textAlign: "left", marginBottom: "24px" }}>
          <p style={{ margin: "0 0 20px", fontWeight: "700", color: "#FFD700", fontSize: "12px", letterSpacing: "1px", textTransform: "uppercase" }}>How DesaynClaw Works</p>
          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            <div style={{ display: "flex", gap: "16px", alignItems: "flex-start" }}>
              <div style={{ minWidth: "24px", height: "24px", background: "#1a1a1a", border: "1px solid #333", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: "800", color: "#fff" }}>1</div>
              <div>
                <p style={{ margin: "0 0 4px", color: "#fff", fontWeight: "700", fontSize: "14px" }}>Upload any image</p>
                <p style={{ margin: 0, color: "#666", fontSize: "13px", lineHeight: "1.4" }}>Take a picture of a shirt, mockup, or sketch.</p>
              </div>
            </div>
            <div style={{ display: "flex", gap: "16px", alignItems: "flex-start" }}>
              <div style={{ minWidth: "24px", height: "24px", background: "#1a1a1a", border: "1px solid #333", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: "800", color: "#fff" }}>2</div>
              <div>
                <p style={{ margin: "0 0 4px", color: "#fff", fontWeight: "700", fontSize: "14px" }}>AI generates the vector</p>
                <p style={{ margin: 0, color: "#666", fontSize: "13px", lineHeight: "1.4" }}>Our proprietary AI models extract and vectorize the design.</p>
              </div>
            </div>
            <div style={{ display: "flex", gap: "16px", alignItems: "flex-start" }}>
              <div style={{ minWidth: "24px", height: "24px", background: "#1a1a1a", border: "1px solid #333", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: "800", color: "#fff" }}>3</div>
              <div>
                <p style={{ margin: "0 0 4px", color: "#fff", fontWeight: "700", fontSize: "14px" }}>Download your SVG</p>
                <p style={{ margin: 0, color: "#666", fontSize: "13px", lineHeight: "1.4" }}>Import directly into Photoshop, Illustrator, or any design software.</p>
              </div>
            </div>
          </div>
        </div>

        {/* Credit explainer */}
        <div style={{ background: "#1a1a1a", border: "1px solid #333", borderRadius: "0", padding: "24px", marginBottom: "32px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", marginBottom: "12px" }}>
            <p style={{ margin: 0, fontWeight: "800", color: "#fff", fontSize: "15px" }}>1 Credit = 1 AI Generation</p>
          </div>
          <p style={{ margin: "0 0 8px", color: "#aaa", fontSize: "13px", textAlign: "center", lineHeight: "1.5" }}>
            You have been granted <strong style={{ color: "#FFD700" }}>1 Free Credit</strong> to test the platform.
          </p>
          <p style={{ margin: 0, color: "#666", fontSize: "12px", textAlign: "center" }}>
            Once depleted, you can top up for as low as ₱35 per credit.
          </p>
        </div>

        <button 
          className="start-btn" 
          onClick={onClose}
          style={{ width: "100%", padding: "16px", fontSize: "15px", fontWeight: "800", background: "#FFD700", color: "#000", border: "none", borderRadius: "0", cursor: "pointer", transition: "opacity 0.2s" }}
          onMouseOver={e => e.target.style.opacity = "0.9"}
          onMouseOut={e => e.target.style.opacity = "1"}
        >
          Start Using DesaynClaw
        </button>
      </div>
    </div>
  );
});

export default OnboardingModal;
