"use client";

import { memo, useState } from "react";
import { Download, Monitor, Settings2, ChevronDown, FolderDown } from "lucide-react";

/**
 * PropertiesPanel — Right sidebar with PROPERTIES, ACTIONS sections and the console.
 * memo'd so it only re-renders when its own props change.
 * The console <div> is written to via DOM ref (consoleRef) — zero re-renders per log line.
 */
const PropertiesPanel = memo(function PropertiesPanel({
  project,
  traceState,
  isSavingCrop,
  userCredits,
  consoleRef,
  onExecuteTrace,
  onDownloadSvg,
  onDownloadAll,
  onOpenCompare,
  onOpenCrop,
  onOpenTopUp,
}) {
  const [vectorColors, setVectorColors] = useState("auto");

  const noCredits = userCredits !== null && userCredits <= 0;
  // If original_image_url contains 'crop', we assume it was cropped.
  const isCropped = project?.original_image_url?.includes("crop") || project?.generated_image_url;
  const isBusy = traceState !== "idle" || isSavingCrop;

  const traceButtonStyle = {
    width: "100%",
    background: noCredits ? "#333" : "linear-gradient(135deg, #FFD700 0%, #E5B800 100%)",
    color: noCredits ? "#666" : "#111",
    border: "none",
    borderRadius: "8px",
    fontWeight: "600",
    boxShadow: noCredits ? "none" : "0 4px 15px rgba(255, 215, 0, 0.2)",
    cursor: noCredits || isBusy ? "not-allowed" : "pointer",
    opacity: isBusy ? 0.7 : 1,
    padding: "12px 16px",
    transition: "all 0.2s"
  };

  const traceButtonLabel = isSavingCrop
    ? "Saving Crop..."
    : traceState !== "idle"
    ? "Processing..."
    : noCredits
    ? "No Credits Remaining"
    : !isCropped
    ? "Crop Image First"
    : "Run Auto-Trace (-1 Credit)";

  return (
    <aside className="properties-panel">

      {/* PROPERTIES section */}
      <div className="panel-section">
        <div className="section-header">
          <span>PROPERTIES</span>
          <Settings2 size={12} />
        </div>
        <div className="section-content">

          <div className="form-group" style={{ marginTop: "16px" }}>
            <label className="form-label" style={{ color: "#aaa", display: "flex", justifyContent: "space-between" }}>
              <span>Vector Colors (Shadow Killer)</span>
              <span style={{ fontSize: "10px", background: "rgba(255,215,0,0.1)", color: "#FFD700", padding: "2px 6px", borderRadius: "10px" }}>BETA</span>
            </label>
            <select 
              value={vectorColors}
              onChange={(e) => setVectorColors(e.target.value)}
              style={{ padding: "8px 12px", fontSize: "12px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", color: "#ddd", marginTop: "6px", borderRadius: "6px", width: "100%", outline: "none", cursor: "pointer", transition: "all 0.2s" }}
            >
              <option value="auto" style={{ background: "#222", color: "#ddd" }}>Auto (Preserve Details)</option>
              <option value="16" style={{ background: "#222", color: "#ddd" }}>16 Colors (High Details)</option>
              <option value="8" style={{ background: "#222", color: "#ddd" }}>8 Colors (Medium Details)</option>
              <option value="4" style={{ background: "#222", color: "#ddd" }}>4 Colors (Merges Shadows)</option>
              <option value="2" style={{ background: "#222", color: "#ddd" }}>2 Colors (Solid / Line Art)</option>
            </select>
            <div style={{ color: "#888", fontSize: "11px", lineHeight: 1.4, marginTop: "4px" }}>
              Limit colors to force the AI to merge shadows and wrinkles into solid shapes. Perfect for messy mockups.
            </div>
          </div>
        </div>
      </div>

      {/* ACTIONS section */}
      <div className="panel-section">
        <div className="section-header">
          <span>ACTIONS</span>
          <ChevronDown size={12} />
        </div>
        <div className="section-content">
          <div style={{ background: "rgba(255, 68, 68, 0.05)", borderLeft: "2px solid #ff4444", borderRadius: "0 4px 4px 0", padding: "8px 10px", marginBottom: "16px", fontSize: "10.5px", color: "#ff8888", display: "flex", gap: "8px", alignItems: "flex-start", lineHeight: 1.4 }}>
            <span style={{ fontWeight: "bold", background: "rgba(255,68,68,0.2)", borderRadius: "50%", width: "14px", height: "14px", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>!</span>
            <span>If image shows front AND back of a shirt, use the Crop Tool to isolate one side, or AI will fail.</span>
          </div>

          {!project?.svg_url && (
            <button
              className="btn-primary"
              style={{ ...traceButtonStyle, opacity: (!isCropped || isBusy) ? 0.5 : 1, cursor: (!isCropped || isBusy || noCredits) ? "not-allowed" : "pointer" }}
              onClick={() => { if (isCropped && !isBusy && !noCredits) onExecuteTrace(vectorColors) }}
              disabled={!isCropped || isBusy}
            >
              {traceButtonLabel}
            </button>
          )}

          <button
            className="btn-primary"
            onClick={onDownloadSvg}
            disabled={!project?.svg_url}
            style={{ marginBottom: "8px", marginTop: "8px", background: "rgba(255, 215, 0, 0.1)", border: "1px solid rgba(255, 215, 0, 0.3)", color: "#FFD700", borderRadius: "8px", padding: "10px 16px", transition: "all 0.2s" }}
            onMouseOver={e => { if(project?.svg_url) e.currentTarget.style.background = "rgba(255, 215, 0, 0.2)"; }}
            onMouseOut={e => { if(project?.svg_url) e.currentTarget.style.background = "rgba(255, 215, 0, 0.1)"; }}
          >
            <Download size={14} /> EXPORT AS SVG
          </button>

          <button
            className="btn-primary"
            onClick={onDownloadAll}
            disabled={!project?.original_image_url}
            style={{ marginBottom: "8px", background: "rgba(255,255,255,0.02)", color: "#aaa", border: "1px solid transparent", borderRadius: "6px", padding: "8px 16px", transition: "all 0.2s", fontSize: "11px", fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.5px" }}
            onMouseOver={e => { if(project?.original_image_url) e.currentTarget.style.background = "rgba(255,255,255,0.06)"; }}
            onMouseOut={e => { if(project?.original_image_url) e.currentTarget.style.background = "rgba(255,255,255,0.02)"; }}
          >
            <FolderDown size={14} /> DOWNLOAD ALL (ZIP)
          </button>

          <button
            className="btn-primary"
            onClick={onOpenCompare}
            disabled={!project?.svg_url}
            style={{ background: "rgba(255,255,255,0.02)", color: "#aaa", border: "1px solid transparent", borderRadius: "6px", padding: "8px 16px", transition: "all 0.2s", fontSize: "11px", fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.5px" }}
            onMouseOver={e => { if(project?.svg_url) e.currentTarget.style.background = "rgba(255,255,255,0.06)"; }}
            onMouseOut={e => { if(project?.svg_url) e.currentTarget.style.background = "rgba(255,255,255,0.02)"; }}
          >
            <Monitor size={14} /> BEFORE/AFTER COMPARE
          </button>
        </div>
      </div>

      {/* Console — written to via DOM ref, zero re-renders per log line */}
      <div className="console-area" ref={consoleRef} />
    </aside>
  );
});

export default PropertiesPanel;
