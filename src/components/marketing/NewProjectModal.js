"use client";

import { memo, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { Shirt, X, Scissors, ChevronLeft, ArrowRight, Camera } from "lucide-react";

/* ─── SVG Icons ─────────────────────────────────────────────── */
const LogoIcon = ({ size = 38 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <path d="M8 9h8M8 12h5M8 15h3"/>
  </svg>
);

const PatternIcon = ({ size = 38 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 7.5 8.5 3 14 7.5 19.5 3 22 5v5.5L16.5 15 11 10.5 5.5 15 2 12.2V9z" />
    <path d="m2 16 3.5 2.8 5.5-4.5 5.5 4.5 5.5-4.5" />
  </svg>
);

/* ─── Radio option card (details step) ─────────────────────── */
function TraceOptionCard({ value, current, onChange, title, description }) {
  const active = current === value;
  return (
    <div
      className={`new-project-trace-option${active ? " is-active" : ""}`}
      onClick={() => onChange(value)}
      style={{
        display: "flex", alignItems: "flex-start", gap: "13px",
        padding: "13px 16px",
        border: active ? "1.5px solid rgba(255,255,255,0.5)" : "1.5px solid #2e2e2e",
        borderRadius: "10px", cursor: "pointer",
        background: active
          ? "linear-gradient(135deg, rgba(255,255,255,0.075), rgba(255,255,255,0.018))"
          : "rgba(255,255,255,0.02)",
        transition: "all 0.18s ease",
        boxShadow: active ? "0 0 0 1px rgba(255,255,255,0.08) inset" : "none",
      }}
      onMouseEnter={(e) => {
        if (!active) {
          e.currentTarget.style.borderColor = "#4a4a4a";
          e.currentTarget.style.background = "rgba(255,255,255,0.04)";
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          e.currentTarget.style.borderColor = "#2e2e2e";
          e.currentTarget.style.background = "rgba(255,255,255,0.02)";
        }
      }}
    >
      {/* Radio dot */}
      <div className="new-project-trace-radio" style={{
        width: 18, height: 18, borderRadius: "50%", flexShrink: 0, marginTop: 2,
        border: active ? "5px solid #161616" : "1.5px solid #505050",
        background: active ? "#f0f0ed" : "transparent",
        outline: active ? "2px solid rgba(255,255,255,0.72)" : "none",
        transition: "all 0.18s ease",
        boxShadow: active ? "0 0 0 3px rgba(255,255,255,0.04)" : "none",
      }} />
      <div>
        <p style={{ margin: "0 0 3px 0", color: active ? "#fff" : "#bbb", fontSize: "13px", fontWeight: 600, transition: "color 0.18s" }}>{title}</p>
        <p style={{ margin: 0, fontSize: "11.5px", color: "#666", lineHeight: 1.6 }}>{description}</p>
      </div>
    </div>
  );
}

/* ─── Category card (step 1) ────────────────────────────────── */
function CategoryCard({ onClick, icon, agentName, title, description, badge, thumbnail, thumbnailContent, thumbnailFit = "cover", thumbnailPosition = "center" }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      className="new-project-category-card"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "relative",
        display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", gap: 16,
        padding: "28px 20px 28px",
        border: hovered ? "1.5px solid rgba(255,255,255,0.38)" : "1.5px solid #282828",
        borderRadius: 0, cursor: "pointer",
        background: hovered
          ? "linear-gradient(160deg, rgba(255,255,255,0.075) 0%, rgba(255,255,255,0.018) 100%)"
          : "linear-gradient(160deg, rgba(255,255,255,0.025) 0%, rgba(255,255,255,0.01) 100%)",
        transition: "all 0.22s ease",
        textAlign: "center",
        aspectRatio: "auto",
        boxShadow: hovered
          ? "0 0 0 1px rgba(255,255,255,0.07) inset, 0 8px 32px rgba(0,0,0,0.4)"
          : "0 2px 12px rgba(0,0,0,0.2)",
        transform: hovered ? "translateY(-3px)" : "translateY(0)",
        overflow: "hidden",
      }}
    >
      <div className={`new-project-category-thumbnail${thumbnailFit === "contain" ? " is-contain" : ""}`} aria-hidden="true">
        {thumbnailContent || (
          <Image
            src={thumbnail}
            alt=""
            fill
            sizes="(max-width: 820px) 45vw, 245px"
            style={{ objectPosition: thumbnailPosition }}
          />
        )}
      </div>
      <div className="new-project-category-fade" aria-hidden="true" />

      {/* Radial glow blob on hover */}
      <div className="new-project-category-glow" style={{
        position: "absolute", top: "38%", left: "50%",
        transform: "translate(-50%, -50%)",
        width: 120, height: 120,
        background: "radial-gradient(circle, rgba(255,255,255,0.11) 0%, transparent 70%)",
        pointerEvents: "none", borderRadius: "50%",
        opacity: hovered ? 1 : 0,
        transition: "opacity 0.25s ease",
      }} />

      {badge && (
        <div className="new-project-category-badge" style={{
          position: "absolute", top: 10, right: 10,
          background: "linear-gradient(180deg, #fff 0%, #eceef1 52%, #c5c8cf 100%)",
          color: "#000", fontSize: "9px", fontWeight: 800,
          padding: "3px 7px", borderRadius: 5,
          letterSpacing: "0.8px",
          boxShadow: "0 5px 14px rgba(0,0,0,0.34), inset 0 1px 0 #fff",
        }}>
          <span className="new-project-category-badge-dot" aria-hidden="true" />
          {badge}
        </div>
      )}

      {/* Icon */}
      <div className="new-project-category-icon" style={{
        color: "rgba(242,242,238,0.82)",
        opacity: hovered ? 1 : 0.8,
        transition: "all 0.22s ease",
        transform: hovered ? "scale(1.1)" : "scale(1)",
        filter: hovered ? "drop-shadow(0 5px 14px rgba(255,255,255,0.14))" : "none",
      }}>
        {icon}
      </div>

      {/* Text */}
      <div className="new-project-category-copy">
        <span className="new-project-category-agent">{agentName}</span>
        <p className="new-project-category-title" style={{
          margin: "0 0 6px 0",
          color: hovered ? "#fff" : "#ddd",
          fontSize: "14px", fontWeight: 700,
          letterSpacing: "-0.2px",
          transition: "color 0.22s",
        }}>
          {title}
        </p>
        <p className="new-project-category-description" style={{
          margin: 0, fontSize: "11px",
          color: hovered ? "#888" : "#555",
          lineHeight: 1.65, transition: "color 0.22s",
          maxWidth: 160,
        }}>
          {description}
        </p>
      </div>

      {/* Arrow cue */}
      <div className="new-project-category-arrow" style={{
        position: "absolute",
        transition: "all 0.22s ease",
      }}>
        <span>Open workspace</span>
        <ArrowRight size={13} strokeWidth={2.2} />
      </div>
    </div>
  );
}

/* ─── Main Modal ─────────────────────────────────────────────── */
const NewProjectModal = memo(function NewProjectModal({
  show,
  projectName,
  setProjectName,
  traceType,
  setTraceType,
  initialCategory = null,
  isUploading,
  onClose,
  onSelectImage,
  onSelectBgRemover,
  onSelectMockupStudio,
}) {
  const [step, setStep] = useState("category");
  const [category, setCategory] = useState(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!show || !initialCategory) return;

    setCategory(initialCategory);
    if (initialCategory === "logo") {
      setTraceType("logo");
    } else if (initialCategory === "pattern") {
      setTraceType("pattern_clean");
    } else {
      setTraceType("mockup_erase");
    }
    setStep("details");
  }, [initialCategory, setTraceType, show]);

  if (!show || !mounted) return null;

  const handleCategorySelect = (cat) => {
    setCategory(cat);
    if (cat === "bg_remover") {
      // Skip details step — trigger file upload immediately
      onSelectBgRemover?.();
      handleClose();
      return;
    }
    if (cat === "mockup_studio") {
      onSelectMockupStudio?.();
      handleClose();
      return;
    }
    if (cat === "logo") {
      setTraceType("logo");
    } else if (cat === "pattern") {
      setTraceType("pattern_clean");
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

  return createPortal(
    <div
      className="modal-overlay"
      onClick={handleClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2147483000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        background: "rgba(0, 0, 0, 0.92)",
        backdropFilter: "blur(10px)",
      }}
    >
      <div
        className="modal-content new-project-modal"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: step === "category" ? 1280 : 480,
          position: "relative",
          transition: "max-width 0.32s cubic-bezier(0.4,0,0.2,1)",
          width: "calc(100vw - 32px)",
          padding: "26px 26px 24px",
          background: "linear-gradient(160deg, #1e1e1e 0%, #151515 100%)",
          border: "1px solid #282828",
          borderRadius: 0,
          boxShadow: "0 24px 80px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.03) inset",
        }}
      >
        {/* Close button */}
        <button
          onClick={handleClose}
          style={{
            position: "absolute", top: 14, right: 14,
            background: "none", border: "1.5px solid transparent",
            color: "#505050", cursor: "pointer",
            display: "flex", borderRadius: "8px", padding: 5,
            transition: "all 0.2s ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = "#ccc";
            e.currentTarget.style.borderColor = "#333";
            e.currentTarget.style.background = "rgba(255,255,255,0.05)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = "#505050";
            e.currentTarget.style.borderColor = "transparent";
            e.currentTarget.style.background = "none";
          }}
        >
          <X size={16} />
        </button>

        {/* ── STEP 1: Category ─────────────────────────────── */}
        {step === "category" && (
          <>
            <div style={{ marginBottom: 22 }}>
              <h2 style={{ margin: "0 0 5px 0", fontSize: "19px", fontWeight: 700, letterSpacing: "-0.4px", color: "#fff" }}>
                What are you creating?
              </h2>
              <p style={{ margin: 0, color: "#4a4a4a", fontSize: "12.5px" }}>
                Choose a workspace to get started.
              </p>
            </div>

            <div className="new-project-category-grid" style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 13 }}>
              <CategoryCard
                onClick={() => handleCategorySelect("garment")}
                icon={<Shirt size={38} strokeWidth={1.2} />}
                agentName="Panel Agent"
                title="Garment Extract"
                description="Extract clean production artwork from garment mockups."
                thumbnail="/tool-agent-cutouts/yellow-v2/01-garment-agent.png"
                thumbnailFit="contain"
                thumbnailPosition="center top"
              />
              <CategoryCard
                onClick={() => handleCategorySelect("logo")}
                icon={<LogoIcon size={38} />}
                agentName="Vector Agent"
                title="Logo Vectorizer"
                description="Convert logos and wordmarks into accurate editable vectors."
                thumbnail="/tool-agent-cutouts/yellow-v2/02-logo-agent.png"
                thumbnailFit="contain"
                thumbnailPosition="center top"
              />
              <CategoryCard
                onClick={() => handleCategorySelect("pattern")}
                icon={<PatternIcon size={38} />}
                agentName="Motif Agent"
                title="Pattern Rebuilder"
                description="Reconstruct flat patterns as clean, editable SVG files."
                thumbnail="/tool-agent-cutouts/yellow-v2/03-pattern-agent.png"
                thumbnailFit="contain"
                thumbnailPosition="center top"
              />
              <CategoryCard
                onClick={() => handleCategorySelect("bg_remover")}
                icon={<Scissors size={38} strokeWidth={1.2} />}
                agentName="Cutout Agent"
                title="Background Remover"
                description="Create clean transparent cutouts for products and graphics."
                badge="AI"
                thumbnail="/tool-agent-cutouts/yellow-v2/04-bg-remover-agent.png"
                thumbnailFit="contain"
                thumbnailPosition="center top"
              />
              <CategoryCard
                onClick={() => handleCategorySelect("mockup_studio")}
                icon={<Camera size={38} strokeWidth={1.2} />}
                agentName="Form Agent"
                title="Mockup Studio"
                description="Build polished garment previews from production panels."
                badge="NEW"
                thumbnail="/tool-agent-cutouts/yellow-v2/05-mockup-agent.png"
                thumbnailFit="contain"
                thumbnailPosition="center top"
              />
            </div>

          </>
        )}

        {/* ── STEP 2: Details ──────────────────────────────── */}
        {step === "details" && (
          <>
            <button
              onClick={handleBack}
              style={{
                background: "none", border: "none", color: "#555", cursor: "pointer",
                fontSize: "11px", padding: "0 0 18px 0",
                display: "flex", alignItems: "center", gap: 5,
                textTransform: "uppercase", letterSpacing: "0.8px", fontWeight: 700,
                transition: "color 0.18s",
              }}
              onMouseEnter={(e) => e.currentTarget.style.color = "#bbb"}
              onMouseLeave={(e) => e.currentTarget.style.color = "#555"}
            >
              <ChevronLeft size={13} strokeWidth={2.5} />
              Back
            </button>

            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 22 }}>
              <div className="new-project-detail-icon" style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 34, height: 34, borderRadius: 9,
                background: "rgba(255,255,255,0.06)",
                color: "#ecece8", flexShrink: 0,
              }}>
                {category === "logo"
                  ? <LogoIcon size={17} />
                  : category === "pattern"
                    ? <PatternIcon size={17} />
                    : <Shirt size={17} strokeWidth={1.5} />}
              </div>
              <h2 style={{ margin: 0, fontSize: "17px", fontWeight: 700, letterSpacing: "-0.3px", color: "#fff" }}>
                {category === "logo" ? "Logo Vectorizer" : category === "pattern" ? "Pattern Rebuilder" : "Garment Extract"}
              </h2>
            </div>

            <div className="form-group" style={{ marginBottom: 18 }}>
              <label style={{
                display: "block", marginBottom: 8, color: "#555",
                fontSize: "10.5px", textTransform: "uppercase", letterSpacing: "1px", fontWeight: 700,
              }}>
                Project Name
              </label>
              <input
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                className="modal-input"
                placeholder="e.g. Guardians Jersey 2025"
                autoFocus
              />
            </div>

            {category === "garment" && (
              <div className="form-group" style={{ marginBottom: 18 }}>
                <label style={{
                  display: "block", marginBottom: 10, color: "#555",
                  fontSize: "10.5px", textTransform: "uppercase", letterSpacing: "1px", fontWeight: 700,
                }}>
                  Extraction Mode
                </label>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <TraceOptionCard
                    value="mockup_erase"
                    current={traceType}
                    onChange={setTraceType}
                    title="Clean Pattern Only (Recommended)"
                    description="Most-used mode. Removes logos, text, and numbers, then rebuilds the clean pattern underneath."
                  />
                  <TraceOptionCard
                    value="mockup_preserve"
                    current={traceType}
                    onChange={setTraceType}
                    title="Keep Complete Design"
                    description="Best for customer mockups. Keeps names, numbers, logos, text, badges, and all visible artwork."
                  />
                </div>
              </div>
            )}

            {category === "logo" && (
              <div className="new-project-logo-note" style={{
                background: "rgba(255,255,255,0.035)",
                border: "1px solid rgba(255,255,255,0.13)",
                borderRadius: 10, padding: "11px 14px", marginBottom: 18,
              }}>
                <p style={{ margin: 0, fontSize: "11.5px", color: "#777", lineHeight: 1.65 }}>
                  Works for{" "}
                  <strong>icons, emblems, combined logos, and text-only wordmarks.</strong>{" "}
                  All text and colors will be preserved exactly as in the reference.
                </p>
              </div>
            )}

            {category === "pattern" && (
              <div className="form-group" style={{ marginBottom: 18 }}>
                <label style={{
                  display: "block", marginBottom: 10, color: "#555",
                  fontSize: "10.5px", textTransform: "uppercase", letterSpacing: "1px", fontWeight: 700,
                }}>
                  Retrace Mode
                </label>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <TraceOptionCard
                    value="pattern_clean"
                    current={traceType}
                    onChange={setTraceType}
                    title="Clean Pattern Only (Recommended)"
                    description="Removes text, names, numbers, logos, badges, sponsors, and branding while rebuilding the underlying pattern."
                  />
                  <TraceOptionCard
                    value="pattern_preserve"
                    current={traceType}
                    onChange={setTraceType}
                    title="Keep Complete Design"
                    description="Preserves the full flat artwork, including text, logos, gradients, colors, graphics, positions, and proportions."
                  />
                </div>
              </div>
            )}

            <div className="modal-actions">
              <button className="btn-cancel" onClick={handleClose}>Cancel</button>
              <button className="btn-primary" onClick={onSelectImage} disabled={isUploading}>
                {isUploading ? "Uploading…" : "Select Image & Create →"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
});

export default NewProjectModal;
