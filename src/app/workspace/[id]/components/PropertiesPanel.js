"use client";

import { memo, useState } from "react";
import { Download, Monitor, ChevronDown, FolderDown, Loader2, Palette, X, Sparkles } from "lucide-react";
import FeedbackWidget from "./FeedbackWidget";

/**
 * PropertiesPanel — Right sidebar.
 * Matches the "AI TRACE SETTINGS" design from the workspace screenshot.
 */
const PropertiesPanel = memo(function PropertiesPanel({
  project,
  traceState,
  isSavingCrop,
  userCredits,
  consoleRef,
  onExecuteTrace,
  onDownloadSvg,
  onDownloadRaster,
  onDownloadAll,
  onOpenCompare,
  onOpenPalettePreview,
  onOpenCrop,
  onOpenRemoveBg,
  onOpenTopUp,
}) {
  const [vectorColors, setVectorColors] = useState("auto");
  const [svgEngine, setSvgEngine] = useState("standard");
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const creditCost = svgEngine === "precision" ? 2 : 1;
  const noCredits = userCredits !== null && userCredits < creditCost;
  const isCropped = project?.original_image_url?.includes("crop") || project?.generated_image_url;
  const isBusy = traceState !== "idle" || isSavingCrop;
  const [downloading, setDownloading] = useState(null);

  const handleDownloadClick = async (type, handler) => {
    if (downloading) return;
    setDownloading(type);
    try {
      await handler();
    } finally {
      setDownloading(null);
    }
  };

  const traceButtonLabel = isSavingCrop
    ? "Saving Crop..."
    : traceState !== "idle"
    ? "Processing..."
    : noCredits
    ? "Get More Credits"
    : !isCropped
    ? "Crop Image First"
    : `Run Auto-Trace  (-${creditCost} Credit${creditCost > 1 ? "s" : ""})`;

  const canTrace = !isBusy && (noCredits || isCropped);
  const secondaryActionGridStyle = {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: "7px",
  };
  const secondaryActionLabelStyle = {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "20px",
    minWidth: "74px",
    lineHeight: 1.12,
    textAlign: "center",
  };

  return (
    <aside style={{
      width: "280px",
      background: "#181818",
      borderLeft: "1px solid #2a2a2a",
      display: "flex",
      flexDirection: "column",
      flexShrink: 0,
      minHeight: 0,
      height: "100%",
      overflowY: "auto",
      scrollbarGutter: "stable",
    }}>

      {/* ── Header ─────────────────────────────────────────── */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "11px 14px",
        borderBottom: "1px solid #2a2a2a",
        background: "#1e1e1e",
        flexShrink: 0,
      }}>
        <span style={{ fontSize: "10px", fontWeight: "700", color: "#aaa", letterSpacing: "1.5px", textTransform: "uppercase" }}>
          AI TRACE SETTINGS
        </span>
        <X size={13} color="#444" style={{ cursor: "pointer" }} />
      </div>

      {/* ── Vector Engine ───────────────────────────────────── */}
      <div style={{ padding: "16px 14px", borderBottom: "1px solid #2a2a2a" }}>
        <label style={{ fontSize: "10px", color: "#666", textTransform: "uppercase", letterSpacing: "1px", display: "block", marginBottom: "8px", fontWeight: "600" }}>
          Color Detail
        </label>
        <div style={{ position: "relative" }}>
          <select
            value={vectorColors}
            onChange={(e) => setVectorColors(e.target.value)}
            style={{
              width: "100%",
              background: "#242424",
              border: "1px solid #383838",
              color: "#ddd",
              padding: "8px 32px 8px 10px",
              fontSize: "12px",
              appearance: "none",
              cursor: "pointer",
              outline: "none",
              transition: "border-color 0.2s",
            }}
            onFocus={e => e.target.style.borderColor = "#FFD700"}
            onBlur={e => e.target.style.borderColor = "#383838"}
          >
            <option value="auto"  style={{ background: "#242424" }}>Auto (Precision Balance)</option>
            <option value="16"    style={{ background: "#242424" }}>16 Colors (High Details)</option>
            <option value="8"     style={{ background: "#242424" }}>8 Colors (Medium Details)</option>
            <option value="4"     style={{ background: "#242424" }}>4 Colors (Merges Shadows)</option>
            <option value="2"     style={{ background: "#242424" }}>2 Colors (Solid / Line Art)</option>
          </select>
          <ChevronDown size={12} style={{ position: "absolute", right: "10px", top: "50%", transform: "translateY(-50%)", color: "#666", pointerEvents: "none" }} />
        </div>
        <p style={{ marginTop: "8px", fontSize: "10px", color: "#555", lineHeight: 1.5 }}>
          Automatically balances detail and performance for the best vector output.
        </p>

        <label style={{ fontSize: "10px", color: "#666", textTransform: "uppercase", letterSpacing: "1px", display: "block", margin: "14px 0 8px", fontWeight: "600" }}>
          SVG Mode
        </label>
        <div style={{ display: "grid", gap: "7px" }}>
          <button
            type="button"
            className="svg-engine-option"
            onClick={() => setSvgEngine("standard")}
            style={engineButtonStyle(svgEngine === "standard")}
          >
            <span>
              <strong>Standard SVG</strong>
              <small>Fast daily export</small>
            </span>
            <b>1</b>
          </button>
          <button
            type="button"
            className="svg-engine-option"
            onClick={() => setSvgEngine("precision")}
            style={engineButtonStyle(svgEngine === "precision")}
          >
            <span>
              <strong><Sparkles size={11} /> Precision SVG</strong>
              <small>Premium clean curves</small>
            </span>
            <b>2</b>
          </button>
        </div>
        <p style={{ marginTop: "8px", fontSize: "10px", color: "#555", lineHeight: 1.5 }}>
          Precision is best for logos, marks, and clean artwork that needs tighter SVG paths.
        </p>
      </div>

      {/* ── Advanced Settings (collapsible) ────────────────── */}
      <div style={{ borderBottom: "1px solid #2a2a2a" }}>
        <button
          onClick={() => setAdvancedOpen(v => !v)}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "10px 14px",
            background: "none",
            border: "none",
            color: "#777",
            cursor: "pointer",
            fontSize: "11px",
            fontWeight: "600",
            letterSpacing: "0.5px",
            transition: "color 0.15s",
          }}
          onMouseOver={e => e.currentTarget.style.color = "#ccc"}
          onMouseOut={e => e.currentTarget.style.color = "#777"}
        >
          Advanced Settings
          <ChevronDown size={12} style={{ transform: advancedOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s" }} />
        </button>

        {advancedOpen && (
          <div style={{ padding: "0 14px 14px" }}>
            <div style={{ background: "rgba(255,68,68,0.05)", borderLeft: "2px solid #ff4444", padding: "8px 10px", marginBottom: "8px", fontSize: "10.5px", color: "#ff8888", display: "flex", gap: "8px", alignItems: "flex-start", lineHeight: 1.4 }}>
              <span style={{ fontWeight: "bold", background: "rgba(255,68,68,0.2)", borderRadius: "50%", width: "14px", height: "14px", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>!</span>
              <span>If image shows front AND back of a shirt, use the Crop Tool to isolate one side, or AI will fail.</span>
            </div>
          </div>
        )}
      </div>

      {/* ── ACTIONS ────────────────────────────────────────── */}
      <div style={{ padding: "12px 12px 10px", borderBottom: "1px solid #2a2a2a", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "9px" }}>
          <span style={{ fontSize: "10px", fontWeight: "700", color: "#aaa", letterSpacing: "1.5px", textTransform: "uppercase" }}>ACTIONS</span>
        </div>

        {/* Warning if not cropped */}
        {!advancedOpen && (
          <div style={{ background: "rgba(255,68,68,0.05)", borderLeft: "2px solid #ff4444", padding: "7px 9px", marginBottom: "9px", fontSize: "9.5px", color: "#ff8888", display: "flex", gap: "7px", alignItems: "flex-start", lineHeight: 1.35 }}>
            <span style={{ fontWeight: "bold", background: "rgba(255,68,68,0.2)", borderRadius: "50%", width: "13px", height: "13px", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: "9px" }}>!</span>
            <span>If image shows front AND back of a shirt, use Crop Tool to isolate one side.</span>
          </div>
        )}

        {/* Primary: Export SVG — big yellow button */}
        <button
          onClick={() => handleDownloadClick('svg', onDownloadSvg)}
          disabled={!project?.svg_url || !!downloading}
          style={{
            width: "100%",
            background: project?.svg_url && !downloading ? "#FFD700" : "rgba(255,215,0,0.08)",
            border: "1px solid " + (project?.svg_url ? "#FFD700" : "#383838"),
            color: project?.svg_url && !downloading ? "#000" : "#555",
            padding: "11px 14px",
            fontSize: "12px",
            fontWeight: "700",
            textTransform: "uppercase",
            letterSpacing: "1px",
            cursor: project?.svg_url && !downloading ? "pointer" : "not-allowed",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
            marginBottom: "7px",
            transition: "all 0.2s",
          }}
          onMouseOver={e => { if (project?.svg_url && !downloading) e.currentTarget.style.background = "#FFC800"; }}
          onMouseOut={e => { if (project?.svg_url && !downloading) e.currentTarget.style.background = "#FFD700"; }}
        >
          {downloading === 'svg' ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} strokeWidth={2.5} />}
          Export as SVG
        </button>

        <div style={secondaryActionGridStyle}>
          {/* Download All ZIP */}
          <button
            onClick={() => handleDownloadClick('all', onDownloadAll)}
            disabled={!project?.original_image_url || !!downloading}
            style={secondaryBtnStyle(!!project?.original_image_url && !downloading)}
            onMouseOver={e => { if (project?.original_image_url && !downloading) e.currentTarget.style.borderColor = "#555"; }}
            onMouseOut={e => { if (project?.original_image_url && !downloading) e.currentTarget.style.borderColor = "#2e2e2e"; }}
          >
            {downloading === 'all' ? <Loader2 size={13} className="animate-spin" /> : <FolderDown size={13} />}
            <span style={secondaryActionLabelStyle}>
              <span>Download All</span>
              <span>(ZIP)</span>
            </span>
          </button>

          {/* Export 4K PNG */}
          <button
            onClick={() => handleDownloadClick('raster', onDownloadRaster)}
            disabled={!project?.upscaled_image_url || !!downloading}
            style={secondaryBtnStyle(!!project?.upscaled_image_url && !downloading)}
            onMouseOver={e => { if (project?.upscaled_image_url && !downloading) e.currentTarget.style.borderColor = "#555"; }}
            onMouseOut={e => { if (project?.upscaled_image_url && !downloading) e.currentTarget.style.borderColor = "#2e2e2e"; }}
          >
            {downloading === 'raster' ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
            <span style={secondaryActionLabelStyle}>
              <span>Export as</span>
              <span>PNG</span>
            </span>
          </button>

          {/* Before / After Compare */}
          <button
            onClick={onOpenPalettePreview}
            disabled={!project?.svg_url}
            style={secondaryBtnStyle(!!project?.svg_url)}
            onMouseOver={e => { if (project?.svg_url) e.currentTarget.style.borderColor = "#555"; }}
            onMouseOut={e => { if (project?.svg_url) e.currentTarget.style.borderColor = "#2e2e2e"; }}
          >
            <Palette size={13} />
            <span style={secondaryActionLabelStyle}>
              <span>Palette</span>
              <span>Preview</span>
            </span>
          </button>

          <button
            onClick={onOpenCompare}
            disabled={!project?.svg_url}
            style={secondaryBtnStyle(!!project?.svg_url)}
            onMouseOver={e => { if (project?.svg_url) e.currentTarget.style.borderColor = "#555"; }}
            onMouseOut={e => { if (project?.svg_url) e.currentTarget.style.borderColor = "#2e2e2e"; }}
          >
            <Monitor size={13} />
            <span style={secondaryActionLabelStyle}>
              <span>Before / After</span>
              <span>Compare</span>
            </span>
          </button>
        </div>

        {/* Run Auto-Trace — show only before SVG is done */}
        {!project?.svg_url && (
          <button
            onClick={() => {
              if (isBusy) return;
              if (noCredits) { onOpenTopUp?.(); return; }
              if (isCropped) onExecuteTrace(vectorColors, svgEngine);
            }}
            disabled={isBusy || (!isCropped && !noCredits)}
            style={{
              width: "100%",
              background: isBusy
                ? "rgba(255,215,0,0.08)"
                : (noCredits || isCropped)
                  ? "#FFD700"
                  : "#2a2a2a",
              border: "1px solid " + (
                isBusy ? "#333" :
                (noCredits || isCropped) ? "#FFD700" : "#3a3a3a"
              ),
              color: isBusy
                ? "#666"
                : (noCredits || isCropped)
                  ? "#000"
                  : "#555",
              padding: "12px 16px",
              fontSize: "11px",
              fontWeight: "800",
              textTransform: "uppercase",
              letterSpacing: "1.5px",
              whiteSpace: "nowrap",
              cursor: canTrace ? "pointer" : "not-allowed",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
              marginTop: "7px",
              opacity: isBusy ? 0.6 : 1,
              transition: "all 0.2s",
            }}
            onMouseOver={e => {
              if (!isBusy && (noCredits || isCropped)) {
                e.currentTarget.style.background = "#FFC800";
              }
            }}
            onMouseOut={e => {
              if (!isBusy && (noCredits || isCropped)) {
                e.currentTarget.style.background = "#FFD700";
              }
            }}
          >
            {traceButtonLabel}
          </button>
        )}
      </div>

      {/* ── Feedback Widget ─────────────────────────────────── */}
      {project?.svg_url && (
        <div style={{ padding: "10px 12px", borderBottom: "1px solid #2a2a2a", flexShrink: 0 }}>
          <FeedbackWidget
            projectId={project.id}
            initialRating={project.rating}
          />
        </div>
      )}

      {/* ── Console area ────────────────────────────────────── */}
      <div className="console-area" ref={consoleRef} style={{ flex: 1 }} />
    </aside>
  );
});

// Secondary button style helper
function secondaryBtnStyle(active) {
  return {
    width: "100%",
    background: "#1e1e1e",
    border: "1px solid #2e2e2e",
    color: active ? "#bbb" : "#444",
    minHeight: "42px",
    padding: "6px 6px",
    fontSize: "9.8px",
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: "0.5px",
    lineHeight: 1.18,
    textAlign: "center",
    cursor: active ? "pointer" : "not-allowed",
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    opacity: active ? 1 : 0.4,
    transition: "all 0.2s",
  };
}

function engineButtonStyle(active) {
  return {
    width: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "10px",
    background: active ? "rgba(255,215,0,0.12)" : "#202020",
    border: "1px solid " + (active ? "#FFD700" : "#333"),
    color: active ? "#fff" : "#aaa",
    padding: "9px 10px",
    cursor: "pointer",
    textAlign: "left",
    transition: "all 0.2s",
  };
}

export default PropertiesPanel;
