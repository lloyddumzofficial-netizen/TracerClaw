"use client";

import { memo } from "react";
import { Zap, Sparkles, Download } from "lucide-react";

const OnboardingModal = memo(function OnboardingModal({ show, onClose }) {
  if (!show) return null;

  return (
    <div 
      className="modal-overlay" 
      style={{ 
        zIndex: 9999, 
        backdropFilter: "blur(12px)", 
        background: "rgba(0, 0, 0, 0.7)",
        animation: "fadeIn 0.3s ease-out" 
      }}
    >
      <div 
        className="modal-content" 
        style={{ 
          maxWidth: "480px", 
          padding: "40px", 
          textAlign: "left", 
          background: "linear-gradient(180deg, #111111 0%, #0a0a0a 100%)", 
          border: "1px solid rgba(255, 215, 0, 0.2)", 
          borderRadius: "16px",
          boxShadow: "0 24px 48px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05)",
          animation: "slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1)"
        }} 
        onClick={(e) => e.stopPropagation()}
      >
        <style>{`
          @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
          @keyframes slideUp { from { opacity: 0; transform: translateY(20px) scale(0.95); } to { opacity: 1; transform: translateY(0) scale(1); } }
          .premium-btn {
            background: linear-gradient(135deg, #FFD700 0%, #F5A623 100%);
            transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
          }
          .premium-btn:hover {
            transform: translateY(-2px);
            boxShadow: 0 8px 24px rgba(255, 215, 0, 0.3);
            filter: brightness(1.1);
          }
          .premium-btn:active {
            transform: translateY(0);
          }
        `}</style>

        {/* Header */}
        <div style={{ marginBottom: "32px", textAlign: "center" }}>
          <h2 style={{ margin: "0 0 12px", fontWeight: "800", fontSize: "28px", color: "#fff", letterSpacing: "-0.5px" }}>
            Welcome to <span style={{ color: "#FFD700" }}>DesaynClaw</span>
          </h2>
          <p style={{ color: "#a0a0a0", fontSize: "15px", margin: 0, lineHeight: "1.6" }}>
            Transform any sketch, mockup, or image into a pixel-perfect scalable vector in seconds.
          </p>
        </div>

        {/* How it works */}
        <div style={{ display: "flex", flexDirection: "column", gap: "24px", marginBottom: "36px" }}>
          
          <div style={{ display: "flex", gap: "16px", alignItems: "flex-start" }}>
            <div style={{ minWidth: "40px", height: "40px", background: "rgba(255, 215, 0, 0.1)", border: "1px solid rgba(255, 215, 0, 0.2)", borderRadius: "10px", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Zap size={20} color="#FFD700" />
            </div>
            <div>
              <p style={{ margin: "0 0 6px", color: "#fff", fontWeight: "700", fontSize: "15px" }}>1. Upload Your Image</p>
              <p style={{ margin: 0, color: "#888", fontSize: "14px", lineHeight: "1.5" }}>Take a picture of a shirt, drop a sketch, or upload any raster logo.</p>
            </div>
          </div>

          <div style={{ display: "flex", gap: "16px", alignItems: "flex-start" }}>
            <div style={{ minWidth: "40px", height: "40px", background: "rgba(255, 215, 0, 0.1)", border: "1px solid rgba(255, 215, 0, 0.2)", borderRadius: "10px", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Sparkles size={20} color="#FFD700" />
            </div>
            <div>
              <p style={{ margin: "0 0 6px", color: "#fff", fontWeight: "700", fontSize: "15px" }}>2. AI Magic Extraction</p>
              <p style={{ margin: 0, color: "#888", fontSize: "14px", lineHeight: "1.5" }}>Our proprietary neural engine flattens, cleans, and vectorizes the design instantly.</p>
            </div>
          </div>

          <div style={{ display: "flex", gap: "16px", alignItems: "flex-start" }}>
            <div style={{ minWidth: "40px", height: "40px", background: "rgba(255, 215, 0, 0.1)", border: "1px solid rgba(255, 215, 0, 0.2)", borderRadius: "10px", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Download size={20} color="#FFD700" />
            </div>
            <div>
              <p style={{ margin: "0 0 6px", color: "#fff", fontWeight: "700", fontSize: "15px" }}>3. Export and Design</p>
              <p style={{ margin: 0, color: "#888", fontSize: "14px", lineHeight: "1.5" }}>Download a flawless SVG, ready to drop into Photoshop or Illustrator.</p>
            </div>
          </div>

        </div>

        {/* Credit explainer */}
        <div style={{ background: "rgba(255, 255, 255, 0.03)", border: "1px solid rgba(255, 255, 255, 0.05)", borderRadius: "12px", padding: "20px", marginBottom: "32px", textAlign: "center" }}>
          <p style={{ margin: "0 0 8px", fontWeight: "700", color: "#e0e0e0", fontSize: "14px", textTransform: "uppercase", letterSpacing: "1px" }}>
            1 Credit = 1 AI Generation
          </p>
          <p style={{ margin: 0, color: "#888", fontSize: "13px", lineHeight: "1.5" }}>
            Top up credits to start generating. Plans start at <strong style={{ color: "#FFD700" }}>₱35 per credit</strong>.
          </p>
        </div>

        <button 
          className="start-btn premium-btn" 
          onClick={onClose}
          style={{ width: "100%", padding: "16px", fontSize: "16px", fontWeight: "800", color: "#000", border: "none", borderRadius: "12px", cursor: "pointer" }}
        >
          START CREATING NOW
        </button>
      </div>
    </div>
  );
});

export default OnboardingModal;
