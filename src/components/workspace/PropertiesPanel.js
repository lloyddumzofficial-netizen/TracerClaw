"use client";

import Image from "next/image";
import { memo, useState, useEffect } from "react";
import {
  Loader2,
  Sparkles,
  X,
  ChevronDown,
  AlertCircle,
  Download,
  Palette,
  SplitSquareHorizontal,
  CheckCircle2
} from "lucide-react";
import GoogleDriveMark from "./integrations/GoogleDriveMark";
import { getGoogleDriveConnectUrl, getIntegrationStatus } from "@/lib/integrations/clientApi";
import { getTraceResumePlan } from "@/lib/traceResume";

const GOOGLE_DRIVE_RECONNECT_REQUIRED = "GOOGLE_DRIVE_RECONNECT_REQUIRED";

const GARMENT_AGENT = {
  name: "Maya", number: "01", role: "Panel extraction",
  label: "Maya, your garment panel agent",
  headline: ["Clean panels.", "Ready to produce."],
  description: "Maya isolates garment artwork while preserving the shapes, colors, and layout you designed.",
  image: "/tool-agent-cutouts/yellow-v2/01-garment-agent.png",
};

const LOGO_AGENT = {
  name: "Victor", number: "02", role: "Logo vectorization",
  label: "Victor, your logo vector agent",
  headline: ["Sharp logos.", "At every scale."],
  description: "Victor turns logos and wordmarks into clean, scalable SVG artwork.",
  image: "/tool-agent-cutouts/yellow-v2/02-logo-agent.png",
};

/* ─── Custom Icons ──────────────────────────────────────────────────────── */

const IconColorRings = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="9" r="5" />
    <circle cx="8" cy="14" r="5" />
    <circle cx="16" cy="14" r="5" />
  </svg>
);

const IconBezier = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    {/* The curved arc */}
    <path d="M5 14c4-8 10-8 14 0" />
    {/* Left node and handle */}
    <circle cx="5" cy="14" r="1.5" />
    <path d="M5 15.5v3.5" />
    <circle cx="5" cy="20" r="1" />
    {/* Right node and handle */}
    <circle cx="19" cy="14" r="1.5" />
    <path d="M19 15.5v3.5" />
    <circle cx="19" cy="20" r="1" />
  </svg>
);

const IconFileZip = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 22h14a2 2 0 0 0 2-2V7.5L14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2z" />
    <polyline points="14 2 14 8 20 8" />
    <path d="M10 12v2" />
    <path d="M10 16v2" />
    <path d="M14 12v6" />
    <path d="M10 12h4" />
    <path d="M10 14h4" />
  </svg>
);


/* ─── Component ───────────────────────────────────────────────────────────── */
const PropertiesPanel = memo(function PropertiesPanel({
  project,
  traceState,
  isSavingCrop,
  userCredits,
  consoleRef,
  onExecuteTrace,
  onDownloadSvg,
  onSaveToDrive,
  onDownloadAll,
  onOpenCompare,
  onOpenPalettePreview,
  onOpenCrop,
  onOpenTopUp,
  onClose,
  closeButtonRef,
}) {
  const [vectorColors, setVectorColors] = useState("auto");
  const [svgEngine, setSvgEngine] = useState("standard");
  const [downloading, setDownloading] = useState(null);
  const [actionMessage, setActionMessage] = useState("");
  const [integrationStatus, setIntegrationStatus] = useState({ loading: true });
  const [driveRequiresReconnect, setDriveRequiresReconnect] = useState(false);

  const isPatternWorkspace = project?.trace_type === "pattern";
  const agent = project?.trace_type === "logo" ? LOGO_AGENT : GARMENT_AGENT;

  const standardPlan = getTraceResumePlan(project, "standard");
  const precisionPlan = getTraceResumePlan(project, "precision");
  const retrySvgOnly = standardPlan.resumeVectorization;
  const resumeFromExtract = standardPlan.resumeUpscale;
  const resumeSavedOutput = retrySvgOnly || resumeFromExtract;
  const standardCreditCost = standardPlan.creditCost;
  const precisionCreditCost = precisionPlan.creditCost;
  const creditCost = svgEngine === "precision" ? precisionCreditCost : standardCreditCost;
  const noCredits = userCredits !== null && userCredits < creditCost;
  const isCropped = project?.original_image_url?.includes("crop") || project?.generated_image_url || project?.upscaled_image_url;
  const isBusy = traceState !== "idle" || isSavingCrop;
  const hasSvg = Boolean(project?.svg_url);          // ← permanent gate: SVG already exists
  const canUsePaletteStudio = hasSvg;
  const isLogoWorkspace = project?.trace_type === "logo";

  const cropWarningCopy = isPatternWorkspace
    ? "Crop to the exact artwork boundary before retracing."
    : isLogoWorkspace
    ? "Crop tightly around the mark and remove empty background."
    : "If image shows front AND back of a shirt, use Crop Tool to isolate one side.";
  const hasCurrentDriveExport = String(project?.google_drive_export_signature || "").startsWith("gdrive:v2:");
  const driveFolderUrl = hasCurrentDriveExport ? project?.google_drive_folder_url || "" : "";
  const projectReadyForDrive = Boolean(project?.svg_url || project?.upscaled_image_url || project?.generated_image_url || project?.zip_url);
  const driveStatusLoading = integrationStatus?.loading === true;
  const driveConnected = Boolean(integrationStatus?.googleDrive?.connected);
  const driveConfigured = integrationStatus?.configured?.googleDrive !== false;
  const driveButtonDisabled = driveStatusLoading || !driveConfigured || Boolean(downloading) || (driveConnected && !driveFolderUrl && (!onSaveToDrive || !projectReadyForDrive));

  useEffect(() => {
    let cancelled = false;

    const loadIntegrationStatus = async () => {
      try {
        const data = await getIntegrationStatus();
        if (!cancelled) {
          setIntegrationStatus({ ...data, loading: false });
          setDriveRequiresReconnect(false);
        }
      } catch {
        if (!cancelled) setIntegrationStatus({ loading: false });
      }
    };

    loadIntegrationStatus();
    window.addEventListener("focus", loadIntegrationStatus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", loadIntegrationStatus);
    };
  }, []);

  const handleDownloadClick = async (type, handler, successMessage = "") => {
    if (downloading) return;
    setDownloading(type);
    setActionMessage("");
    try {
      const result = await handler();
      if (successMessage) {
        const count = result?.files?.length;
        setActionMessage(result?.persistenceWarning || (count ? `${successMessage} (${count} files).` : successMessage));
      }
    } catch (error) {
      const needsDriveSetup = error?.code === "GOOGLE_DRIVE_API_DISABLED";
      const needsDriveReconnect =
        error?.code === GOOGLE_DRIVE_RECONNECT_REQUIRED ||
        /expired|revoked|not connected/i.test(error?.message || "");

      if (needsDriveReconnect) {
        setDriveRequiresReconnect(true);
        setIntegrationStatus((current) => ({
          ...current,
          googleDrive: {
            ...(current?.googleDrive || {}),
            connected: false,
            email: null,
            connectedAt: null,
          },
        }));
      }

      setActionMessage(needsDriveSetup
        ? "Google Drive API is disabled in Google Cloud. Enable it, wait a minute, then retry."
        : needsDriveReconnect
          ? "Google Drive session expired. Please reconnect Google Drive, then save again."
        : error?.message || "Action failed. Please try again.");
    } finally {
      setDownloading(null);
    }
  };

  const handleDriveClick = () => {
    if (driveFolderUrl) {
      window.open(driveFolderUrl, "_blank", "noopener,noreferrer");
      return;
    }
    setDriveRequiresReconnect(false);
    if (!driveConfigured) {
      setActionMessage("Google Drive is not configured on the server yet.");
      return;
    }
    if (!driveConnected) {
      const nextPath = `${window.location.pathname}${window.location.search || ""}`;
      window.location.href = getGoogleDriveConnectUrl(nextPath);
      return;
    }
    handleDownloadClick("drive", onSaveToDrive, "Saved to Google Drive");
  };

  const driveButtonLabel = driveFolderUrl
    ? <>Open Drive<br />Folder</>
    : downloading === "drive"
      ? <>Saving to<br />Drive</>
      : driveStatusLoading
        ? <>Checking<br />Drive</>
        : !driveConfigured
          ? <>Google Drive<br />Unavailable</>
          : !driveConnected
            ? driveRequiresReconnect
              ? <>Reconnect<br />Google Drive</>
              : <>Connect<br />Google Drive</>
            : <>Save to<br />Google Drive</>;

  const traceButtonLabel = hasSvg
    ? "SVG Generated"
    : isSavingCrop
      ? "Saving Crop…"
      : traceState !== "idle"
        ? "Processing…"
        : noCredits
          ? "Get More Claws"
          : !isCropped
            ? "Crop Image First"
              : retrySvgOnly
                ? creditCost === 0 ? "Retry SVG — No Claws" : "Retry Precision SVG  (−1 Claw)"
                : resumeFromExtract
                  ? creditCost === 0 ? "Resume HD + SVG — No Claws" : "Resume HD + Precision SVG  (−1 Claw)"
                : `${isPatternWorkspace ? "Run Pattern Retrace" : "Run Auto-Trace"}  (−${creditCost} Claw${creditCost > 1 ? "s" : ""})`;

  return (
    <aside className="workspace-properties-panel" style={{
      width: "280px",
      background: "#161616",
      borderLeft: "1px solid #222",
      display: "flex",
      flexDirection: "column",
      justifyContent: "flex-start",
      flexShrink: 0,
      height: "100%",
      overflow: "hidden",
      fontFamily: "var(--font-manrope), 'Segoe UI', Arial, sans-serif",
    }}>

      <style>{`
        .pp-card {
          width: 100%; display: flex; align-items: center; gap: 12px;
          background: transparent; border: 1px solid #333; color: #71717a;
          padding: 8px 12px; cursor: pointer; text-align: left;
          transition: border-color .15s, color .15s, background .15s;
          border-radius: 0;
        }
        .pp-card.on { border-color: #FFD700; color: #e4e4e7; background: rgba(255, 215, 0, 0.04); }
        .pp-card:not(.on):hover { border-color: #555; color: #a1a1aa; }

        .pp-sec {
          background: transparent; border: 1px solid #333; color: #a1a1aa;
          min-height: 42px; padding: 4px;
          font-size: 9px; font-weight: 600;
          text-transform: uppercase; letter-spacing: 0.5px;
          cursor: pointer; display: flex; flex-direction: column;
          align-items: center; justify-content: center; gap: 6px;
          transition: all .15s; line-height: 1.3; text-align: center;
          border-radius: 0;
        }
        .pp-sec:not(:disabled):hover { background: #222; border-color: #444; color: #e4e4e7; }
        .pp-sec:disabled { opacity: 0.3; cursor: not-allowed; }

        .pp-svg-btn {
          width: 100%;
          background: #FFD700;
          border: none; color: #000; padding: 8px 14px;
          font-size: 11px; font-weight: 700; text-transform: uppercase;
          letter-spacing: 1.5px; cursor: pointer; display: flex;
          align-items: center; justify-content: center; gap: 8px;
          transition: all .15s ease;
          border-radius: 0;
        }
        .pp-svg-btn:not(:disabled):hover {
          background: #f0c900;
          transform: translateY(-1px);
        }
        .pp-svg-btn:disabled {
          background: #2a2a2a; color: #555;
          cursor: not-allowed; transform: none;
        }

        .pp-trace-btn {
          width: 100%; min-height: 42px; margin-bottom: 6px; padding: 9px 14px;
          display: flex; align-items: center; justify-content: center; gap: 8px;
          color: #050505; background: #ffd700; border: 1px solid #ffd700;
          border-radius: 4px; box-shadow: 0 0 16px rgba(255, 215, 0, 0.18);
          font-family: inherit; font-size: 10px; font-weight: 700;
          line-height: 1; letter-spacing: .06em; text-transform: uppercase;
          cursor: pointer; transition: background .15s ease, border-color .15s ease, transform .15s ease, box-shadow .15s ease;
        }
        .pp-trace-btn:hover:not(:disabled) {
          background: #f0c900; border-color: #f0c900;
          box-shadow: 0 0 22px rgba(255, 215, 0, 0.28); transform: translateY(-1px);
        }
        .pp-trace-btn:disabled {
          color: #555; background: #242424; border-color: #333;
          box-shadow: none; cursor: not-allowed; transform: none;
        }

        .pp-sel-wrap { position: relative; display: flex; align-items: center; }
        .pp-sel-ico { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); pointer-events: none; z-index: 1; color: #a1a1aa; }
        .pp-sel {
          width: 100%; background: transparent; border: 1px solid #333; color: #e4e4e7;
          padding: 8px 30px 8px 34px;
          font-size: 11px; font-weight: 600; appearance: none;
          cursor: pointer; outline: none; transition: border-color .15s;
          border-radius: 0;
        }
        .pp-sel:focus { border-color: #FFD700; }
        .pp-sel-arr { position: absolute; right: 10px; top: 50%; transform: translateY(-50%); color: #a1a1aa; pointer-events: none; }

        .pp-lbl {
          display: block;
          font-size: 9px; font-weight: 600; color: #71717a;
          text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;
        }
        .pp-desc {
          font-size: 10px; color: #52525b; line-height: 1.3; margin-top: 4px;
        }

        .pp-warn {
          background: rgba(239, 68, 68, 0.05); border: 1px solid rgba(239, 68, 68, 0.2);
          padding: 8px; display: flex; gap: 8px; align-items: flex-start;
          border-radius: 0;
        }
        .pp-warn span {
          font-size: 10px; color: #ef4444; line-height: 1.4;
        }

        .pp-row { display: flex; align-items: center; gap: 6px; height: 16px; margin-bottom: 0px;}
        .pp-row-lbl {
          font-size: 10px; color: #a1a1aa; white-space: nowrap;
        }
        .pp-row-val {
          font-size: 10px; font-weight: 500; white-space: nowrap;
        }
        .pp-row-dot { flex: 1; border-bottom: 1px dotted #333; margin: 0 4px; }

        .pp-scroll-region {
          flex: 1 1 auto; min-height: 0; overflow: hidden;
          display: flex; flex-direction: column; justify-content: space-between;
        }

        @keyframes pp-spin { to { transform: rotate(360deg); } }
        .pp-spin { animation: pp-spin .9s linear infinite; display: inline-flex; }
        @keyframes pp-shimmer { 0% { left: -100%; } 100% { left: 200%; } }

        @media (max-height: 840px) {
          .pp-scroll-region { justify-content: flex-start; }
          .pp-color-section { padding: 6px 12px !important; }
          .pp-mode-section, .pp-actions-section { padding: 0 12px 6px !important; }
          .pp-card { padding: 6px 9px; gap: 9px; }
          .pp-desc { margin-top: 3px; font-size: 9px; line-height: 1.25; }
          .pp-trace-btn { min-height: 36px; margin-bottom: 4px; padding-block: 7px; }
          .pp-warn { padding: 6px; }
          .pp-warn span { font-size: 9px; line-height: 1.25; }
          .pp-svg-btn { padding-block: 6px; }
          .pp-sec { min-height: 36px; padding: 3px; gap: 3px; }
        }

        @media (max-height: 700px) {
          .pp-desc { display: none; }
          .pp-color-section { padding-block: 5px !important; }
          .pp-card { padding-block: 5px; }
          .pp-plan-meta { font-size: 8px !important; }
          .pp-warn { margin-bottom: 4px !important; }
          .pp-sec { min-height: 32px; }
        }
      `}</style>

      {/* ── HEADER ───────────────────────────────────────── */}
      <div className="pp-header" style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "8px 14px", borderBottom: "1px solid #222", flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <Sparkles size={14} color="#e4e4e7" />
          <span style={{
            fontSize: "11px", fontWeight: "600",
            color: "#fff", letterSpacing: "1px", textTransform: "uppercase",
          }}>{isPatternWorkspace ? "AI Retrace Settings" : "AI Trace Settings"}</span>
        </div>
        <button ref={closeButtonRef} type="button" style={{ background: "none", border: "none", cursor: "pointer", padding: "5px", display: "flex", minWidth: 28, minHeight: 28 }}
          onClick={onClose} aria-label="Close panel" aria-expanded="true">
          <X size={14} color="#71717a" />
        </button>
      </div>

      <div className="pp-scroll-region">
      {/* ── COLOR DETAIL ─────────────────────────────────── */}
      <div className="pp-section pp-color-section" style={{ padding: "8px 14px", flexShrink: 0 }}>
        <span className="pp-lbl">Color Detail</span>
        <div className="pp-sel-wrap">
          <span className="pp-sel-ico"><IconColorRings /></span>
          <select value={vectorColors} onChange={e => setVectorColors(e.target.value)} className="pp-sel">
            <option value="auto" style={{ background: "#161616" }}>Auto (Precision Balance)</option>
            <option value="16" style={{ background: "#161616" }}>16 Colors (High Details)</option>
            <option value="8" style={{ background: "#161616" }}>8 Colors (Medium Details)</option>
            <option value="4" style={{ background: "#161616" }}>4 Colors (Merges Shadows)</option>
            <option value="2" style={{ background: "#161616" }}>2 Colors (Solid / Line Art)</option>
          </select>
          <span className="pp-sel-arr"><ChevronDown size={14} /></span>
        </div>
        <p className="pp-desc">Automatically balances detail and performance for the best vector output.</p>
      </div>

      {/* ── SVG MODE ─────────────────────────────────────── */}
      <div className="pp-section pp-mode-section" style={{ padding: "0 14px 8px", flexShrink: 0 }}>
        <span className="pp-lbl">SVG Mode</span>
        <div style={{ display: "grid", gap: "6px" }}>

          {/* Standard */}
          <button type="button" className={`pp-card${svgEngine === "standard" ? " on" : ""}`}
            onClick={() => setSvgEngine("standard")}>
            <div className="pp-plan-icon" style={{ color: svgEngine === "standard" ? "#FFD700" : "#a1a1aa", flexShrink: 0, display: "flex" }}>
              <IconBezier />
            </div>
            <div style={{ flex: 1, textAlign: "left" }}>
              <div className="pp-plan-title" style={{ fontSize: "11px", fontWeight: "700", textTransform: "uppercase", color: svgEngine === "standard" ? "#e4e4e7" : "#a1a1aa", marginBottom: "2px" }}>
                Standard SVG
              </div>
              <div className="pp-plan-meta" style={{ fontSize: "9px", color: "#71717a" }}>
                {resumeSavedOutput ? "No extra Claws • Resume saved output" : "1 Claw • Includes Palette Studio"}
              </div>
            </div>
            <div className="pp-plan-cost" style={{
              width: "22px", height: "22px", border: "1px solid", borderColor: svgEngine === "standard" ? "#FFD700" : "#333",
              background: "transparent", color: svgEngine === "standard" ? "#FFD700" : "#a1a1aa",
              fontSize: "11px", fontWeight: "600", display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0
            }}>{standardCreditCost}</div>
          </button>

          {/* Precision */}
          <button type="button" className={`pp-card${svgEngine === "precision" ? " on" : ""}`}
            onClick={() => setSvgEngine("precision")}>
            <div className="pp-plan-icon" style={{ color: svgEngine === "precision" ? "#FFD700" : "#a1a1aa", flexShrink: 0, display: "flex" }}>
              <Sparkles size={16} />
            </div>
            <div style={{ flex: 1, textAlign: "left" }}>
              <div className="pp-plan-title" style={{ fontSize: "11px", fontWeight: "700", textTransform: "uppercase", color: svgEngine === "precision" ? "#e4e4e7" : "#a1a1aa", marginBottom: "2px" }}>
                Precision SVG
              </div>
              <div className="pp-plan-meta" style={{ fontSize: "9px", color: "#71717a" }}>
                {precisionCreditCost} Claw{precisionCreditCost > 1 ? "s" : ""} • Cleaner paths + smoother Palette Studio
              </div>
            </div>
            <div className="pp-plan-cost" style={{
              width: "22px", height: "22px", border: "1px solid", borderColor: svgEngine === "precision" ? "#FFD700" : "#333",
              background: "transparent", color: svgEngine === "precision" ? "#FFD700" : "#a1a1aa",
              fontSize: "11px", fontWeight: "600", display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0
            }}>{precisionCreditCost}</div>
          </button>
        </div>

        <p className="pp-desc">
          {isPatternWorkspace
            ? "Precision is best for detailed patterns, small lettering, and tightly registered shapes."
            : isLogoWorkspace
            ? "Precision is best for logos with small text, circles, and tight curves."
            : "Precision is best for logos, marks, and clean artwork that needs tighter SVG paths."}
        </p>
      </div>

      {/* ── ACTIONS ──────────────────────────────────────── */}
      <div className="pp-section pp-actions-section" style={{ padding: "0 14px 8px", flexShrink: 0 }}>
        <span className="pp-lbl">Actions</span>

        {/* ── RUN AUTO-TRACE — always visible ── */}
        <button
          className="pp-trace-btn"
          onClick={() => {
            if (isBusy) return;
            if (noCredits) { onOpenTopUp?.(); return; }
            if (isCropped) onExecuteTrace(vectorColors, svgEngine);
          }}
          disabled={isBusy || hasSvg || (!isCropped && !noCredits)}
          aria-busy={isBusy}
        >
          {hasSvg
            ? <CheckCircle2 size={15} />
            : isBusy
              ? <span className="pp-spin"><Loader2 size={15} /></span>
              : null}
          {traceButtonLabel}
        </button>

        {noCredits && !hasSvg && <p role="status" style={{ margin: "6px 0", color: "#929591", fontSize: 11, lineHeight: 1.4 }}>
          Requires {creditCost} Claw{creditCost === 1 ? "" : "s"}. Your balance: {userCredits} Claw{userCredits === 1 ? "" : "s"}.
        </p>}

        <div className="pp-warn" style={{ marginBottom: "6px" }}>
          <AlertCircle size={14} color="#ef4444" style={{ flexShrink: 0, marginTop: "1px" }} /><span>{cropWarningCopy}</span>
        </div>

        {/* Export as SVG */}
        <button className="pp-svg-btn"
          onClick={() => handleDownloadClick("svg", onDownloadSvg)}
          disabled={!project?.svg_url || !!downloading}
          style={{ marginBottom: "6px" }}>
          {downloading === "svg"
            ? <span className="pp-spin"><Loader2 size={16} /></span>
            : <Download size={16} />}
          Export as SVG
        </button>

        {/* 2×2 grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
          <button className="pp-sec"
            onClick={() => handleDownloadClick("all", onDownloadAll)}
            disabled={!project?.original_image_url || !!downloading}>
            {downloading === "all" ? <span className="pp-spin"><Loader2 size={15} /></span> : <IconFileZip />}
            <span>Download<br />All (ZIP)</span>
          </button>
          <button className="pp-sec"
            onClick={handleDriveClick}
            disabled={driveButtonDisabled}>
            {downloading === "drive"
              ? <span className="pp-spin"><Loader2 size={15} /></span>
              : <GoogleDriveMark className="pp-google-drive-icon" size={17} />}
            <span>{driveButtonLabel}</span>
          </button>
          <button className="pp-sec"
            // Anchor target for the "Palette Studio ready" nudge, which measures
            // this button's position instead of using fixed offsets.
            data-palette-preview-anchor="true"
            onClick={onOpenPalettePreview}
            disabled={!project?.svg_url}
            title={canUsePaletteStudio ? "Open Palette Studio" : "Generate SVG first"}>
            <Palette size={15} />
            <span>Palette<br />Preview</span>
          </button>
          <button className="pp-sec"
            onClick={onOpenCompare}
            disabled={!project?.svg_url}>
            <SplitSquareHorizontal size={15} />
            <span>Before /<br />After Compare</span>
          </button>
        </div>
        {actionMessage && (
          <div className="pp-action-message" role="status">{actionMessage}</div>
        )}
      </div>

      <aside className="pp-agent-card" aria-label={agent.label}>
        <div className="pp-agent-card-copy">
          <div className="pp-agent-identity">
            <span>{agent.number}</span>
            <div>
              <b>{agent.name}</b>
              <small>{agent.role}</small>
            </div>
          </div>
          <strong className="pp-agent-headline">{agent.headline[0]}<br />{agent.headline[1]}</strong>
          <p>{agent.description}</p>
        </div>
        <div className="pp-agent-portrait" aria-hidden="true">
          <Image
            src={agent.image}
            alt=""
            fill
            sizes="150px"
          />
        </div>
      </aside>
      </div>

    </aside>
  );
});

export default PropertiesPanel;
