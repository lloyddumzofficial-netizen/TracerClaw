"use client";

import { memo, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Shirt, X, ChevronLeft, ArrowRight } from "lucide-react";
import useDialogFocus from "@/hooks/useDialogFocus";
import modalStyles from "./NewProjectModal.module.css";
import WorkspaceCategoryArtwork from "./WorkspaceCategoryArtwork";

function activateOnKeyboard(event, activate) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    activate();
  }
}

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
      className={`new-project-trace-option ${modalStyles.keyboardOption}${active ? " is-active" : ""}`}
      onClick={() => onChange(value)}
      role="button"
      tabIndex={0}
      aria-label={title}
      aria-pressed={active}
      onKeyDown={event => activateOnKeyboard(event, () => onChange(value))}
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
function CategoryCard({ onClick, artwork, agentName, title, description, badge }) {
  return (
    <div
      className={`${modalStyles.categoryCard} ${modalStyles.keyboardOption}`}
      data-workspace-card={artwork}
      onClick={onClick}
      role="button"
      tabIndex={0}
      aria-label={title}
      onKeyDown={event => activateOnKeyboard(event, onClick)}
    >
      {badge && <span className={modalStyles.badge} data-badge={badge.toLowerCase()}>{badge}</span>}
      <div className={modalStyles.artwork}>
        <WorkspaceCategoryArtwork variant={artwork} />
      </div>
      <div className={modalStyles.cardCopy}>
        <span className={modalStyles.agentLabel}>{agentName}</span>
        <h3 className={modalStyles.cardTitle}>{title}</h3>
        <p className={modalStyles.cardDescription}>{description}</p>
      </div>
      <span className={modalStyles.cardAction} aria-hidden="true">
        Open workspace <ArrowRight size={13} strokeWidth={2} />
      </span>
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
  const dialogRef = useRef(null);

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

  useDialogFocus(show && mounted, dialogRef, handleClose);
  useEffect(() => {
    if (!show || !mounted) return;
    const selector = step === "details" ? "input:not([disabled])" : "[data-workspace-card]";
    dialogRef.current?.querySelector(selector)?.focus({ preventScroll: true });
  }, [show, mounted, step]);
  if (!show || !mounted) return null;

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
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={step === "category" ? "Choose a workspace" : "New project details"}
        tabIndex={-1}
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
          type="button"
          aria-label="Close workspace chooser"
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
                artwork="garment"
                agentName="Panel Agent"
                title="Garment Extract"
                description="Extract clean production artwork from garment mockups."
              />
              <CategoryCard
                onClick={() => handleCategorySelect("logo")}
                artwork="logo"
                agentName="Vector Agent"
                title="Logo Vectorizer"
                description="Convert logos and wordmarks into accurate editable vectors."
              />
              <CategoryCard
                onClick={() => handleCategorySelect("pattern")}
                artwork="pattern"
                agentName="Motif Agent"
                title="Pattern Rebuilder"
                description="Reconstruct flat patterns as clean, editable SVG files."
              />
              <CategoryCard
                onClick={() => handleCategorySelect("bg_remover")}
                artwork="bg_remover"
                agentName="Cutout Agent"
                title="Background Remover"
                description="Create clean transparent cutouts for products and graphics."
                badge="AI"
              />
              <CategoryCard
                onClick={() => handleCategorySelect("mockup_studio")}
                artwork="mockup_studio"
                agentName="Form Agent"
                title="Mockup Studio"
                description="Build polished garment previews from production panels."
                badge="NEW"
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
