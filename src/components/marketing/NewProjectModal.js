"use client";

import { memo, useState } from "react";
import { Shirt, X, Scissors } from "lucide-react";

const LogoIcon = () => (
  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <path d="M8 9h8M8 12h5M8 15h3"/>
  </svg>
);

function TraceOptionCard({ value, current, onChange, title, description }) {
  const active = current === value;
  return (
    <div
      onClick={() => onChange(value)}
      style={{
        display: "flex", alignItems: "flex-start", gap: "12px",
        padding: "12px 15px",
        border: active ? "2px solid #FFD700" : "2px solid #444",
        borderRadius: "8px", cursor: "pointer",
        background: active ? "rgba(255,215,0,0.08)" : "transparent",
        transition: "all 0.15s",
      }}
    >
      <div style={{
        width: 18, height: 18, borderRadius: "50%", flexShrink: 0, marginTop: 2,
        border: active ? "5px solid #1a1a1a" : "2px solid #555",
        background: active ? "#FFD700" : "transparent",
        outline: active ? "2px solid #FFD700" : "none",
        transition: "all 0.15s",
      }} />
      <div>
        <p style={{ margin: "0 0 2px 0", color: active ? "#fff" : "#ccc", fontSize: "13px", fontWeight: 600 }}>{title}</p>
        <p style={{ margin: 0, fontSize: "11px", color: "#888", lineHeight: 1.5 }}>{description}</p>
      </div>
    </div>
  );
}

const NewProjectModal = memo(function NewProjectModal({
  show,
  projectName,
  setProjectName,
  traceType,
  setTraceType,
  isUploading,
  onClose,
  onSelectImage,
  onSelectBgRemover,
}) {
  const [step, setStep] = useState("category");
  const [category, setCategory] = useState(null);

  if (!show) return null;

  const handleCategorySelect = (cat) => {
    setCategory(cat);
    if (cat === "bg_remover") {
      // Skip details step — trigger file upload immediately
      onSelectBgRemover?.();
      handleClose();
      return;
    }
    if (cat === "logo") {
      setTraceType("logo");
    } else {
      setTraceType("mockup_erase");
    }
    setStep("details");
  };

  const handleBack = () => {
    setStep("category");
    setCategory(null);
  };

  const handleClose = () => {
    setStep("category");
    setCategory(null);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: step === "category" ? 800 : 480, position: "relative", transition: "max-width 0.3s ease", width: "100%" }}>

        <button
          onClick={handleClose}
          style={{ position: "absolute", top: 14, right: 14, background: "none", border: "none", color: "#666", cursor: "pointer", display: "flex", borderRadius: "50%", padding: 4, transition: "all 0.2s" }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "#fff"; e.currentTarget.style.background = "rgba(255,255,255,0.08)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "#666"; e.currentTarget.style.background = "none"; }}
        >
          <X size={18} />
        </button>

        {step === "category" && (
          <>
            <h2 style={{ margin: "0 0 6px 0" }}>What are you tracing?</h2>
            <p style={{ margin: "0 0 24px 0", color: "#888", fontSize: "13px" }}>Choose a category to get started.</p>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
              <div
                onClick={() => handleCategorySelect("garment")}
                style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, padding: "20px 24px", border: "2px solid #444", borderRadius: 10, cursor: "pointer", background: "transparent", transition: "all 0.18s", textAlign: "center", aspectRatio: "1 / 1" }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#FFD700"; e.currentTarget.style.background = "rgba(255,215,0,0.06)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#444"; e.currentTarget.style.background = "transparent"; }}
              >
                <div style={{ color: "#FFD700" }}><Shirt size={40} strokeWidth={1.2} /></div>
                <div>
                  <p style={{ margin: "0 0 4px 0", color: "#fff", fontSize: "15px", fontWeight: 700 }}>Garment Workspace</p>
                  <p style={{ margin: 0, fontSize: "11px", color: "#888", lineHeight: 1.5 }}>Jerseys, shirts, mockups — extract the flat pattern as SVG.</p>
                </div>
              </div>

              <div
                onClick={() => handleCategorySelect("logo")}
                style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, padding: "20px 24px", border: "2px solid #444", borderRadius: 10, cursor: "pointer", background: "transparent", transition: "all 0.18s", textAlign: "center", aspectRatio: "1 / 1" }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#FFD700"; e.currentTarget.style.background = "rgba(255,215,0,0.06)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#444"; e.currentTarget.style.background = "transparent"; }}
              >
                <div style={{ color: "#FFD700" }}><LogoIcon /></div>
                <div>
                  <p style={{ margin: "0 0 4px 0", color: "#fff", fontSize: "15px", fontWeight: 700 }}>Logo Workspace</p>
                  <p style={{ margin: 0, fontSize: "11px", color: "#888", lineHeight: 1.5 }}>Icons, emblems, wordmarks — vectorize with exact color and text.</p>
                </div>
              </div>

              <div
                onClick={() => handleCategorySelect("bg_remover")}
                style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, padding: "20px 24px", border: "2px solid #444", borderRadius: 10, cursor: "pointer", background: "transparent", transition: "all 0.18s", textAlign: "center", position: "relative", aspectRatio: "1 / 1" }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#FFD700"; e.currentTarget.style.background = "rgba(255,215,0,0.06)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#444"; e.currentTarget.style.background = "transparent"; }}
              >
                <div style={{ position: "absolute", top: 8, right: 8, background: "#FFD700", color: "#000", fontSize: "9px", fontWeight: 800, padding: "2px 6px", borderRadius: 4, letterSpacing: "0.5px" }}>AI</div>
                <div style={{ color: "#FFD700" }}><Scissors size={40} strokeWidth={1.2} /></div>
                <div>
                  <p style={{ margin: "0 0 4px 0", color: "#fff", fontSize: "15px", fontWeight: 700 }}>BG Remover Studio</p>
                  <p style={{ margin: 0, fontSize: "11px", color: "#888", lineHeight: 1.5 }}>Remove backgrounds instantly with AI — perfect for products &amp; portraits.</p>
                </div>
              </div>
            </div>
          </>
        )}

        {step === "details" && (
          <>
            <button
              onClick={handleBack}
              style={{ background: "none", border: "none", color: "#888", cursor: "pointer", fontSize: "12px", padding: "0 0 16px 0", display: "flex", alignItems: "center", gap: 6, textTransform: "uppercase", letterSpacing: "0.5px", fontWeight: 600, transition: "color 0.2s" }}
              onMouseEnter={(e) => e.currentTarget.style.color = "#fff"}
              onMouseLeave={(e) => e.currentTarget.style.color = "#888"}
            >
              ← Back
            </button>

            <h2 style={{ margin: "0 0 20px 0" }}>
              {category === "logo" ? "Logo Workspace" : "Garment Workspace"}
            </h2>

            <div className="form-group" style={{ marginBottom: 20 }}>
              <label style={{ display: "block", marginBottom: 8, color: "#aaa", fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.8px" }}>Project Name</label>
              <input
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                className="modal-input"
                placeholder="e.g. Guardians Jersey 2025"
              />
            </div>

            {category === "garment" && (
              <div className="form-group" style={{ marginBottom: 20 }}>
                <label style={{ display: "block", marginBottom: 10, color: "#aaa", fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.8px" }}>Extraction Mode</label>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <TraceOptionCard
                    value="mockup_erase"
                    current={traceType}
                    onChange={setTraceType}
                    title="Extract Pattern Only"
                    description="Removes names, numbers, and logos — outputs a clean background pattern ready for re-printing."
                  />
                  <TraceOptionCard
                    value="mockup_preserve"
                    current={traceType}
                    onChange={setTraceType}
                    title="Keep All Artwork"
                    description="Preserves logos, chest badges, and design art exactly as they appear in the reference."
                  />
                </div>
              </div>
            )}

            {category === "logo" && (
              <div style={{ background: "rgba(255,215,0,0.06)", border: "1px solid rgba(255,215,0,0.2)", borderRadius: 8, padding: "12px 14px", marginBottom: 20 }}>
                <p style={{ margin: 0, fontSize: "12px", color: "#aaa", lineHeight: 1.6 }}>
                  Works for <strong style={{ color: "#FFD700" }}>icons, emblems, combined logos, and text-only wordmarks.</strong> All text and colors will be preserved exactly as in the reference.
                </p>
              </div>
            )}

            <div className="modal-actions">
              <button className="btn-cancel" onClick={handleClose}>Cancel</button>
              <button className="btn-primary" onClick={onSelectImage} disabled={isUploading}>
                {isUploading ? "Uploading..." : "Select Image & Create →"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
});

export default NewProjectModal;
