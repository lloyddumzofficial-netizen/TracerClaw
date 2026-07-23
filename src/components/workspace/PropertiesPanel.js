"use client";

import { memo, useState } from "react";
import { Download, Monitor, ChevronDown, FolderDown, Loader2, Palette, X, Sparkles, Check } from "lucide-react";


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
  const canUsePaletteStudio = Boolean(project?.svg_url);
  const isLogoWorkspace = project?.trace_type === "logo";
  const cropWarningCopy = isLogoWorkspace
    ? "For best logo vectors, crop tightly around the mark and remove empty background."
    : "If image shows front AND back of a shirt, use Crop Tool to isolate one side.";
  const handoffItems = [
    { label: "Input", value: isCropped ? "Cropped reference" : "Original upload" },
    { label: "Artwork", value: project?.generated_image_url ? "Flat extracted" : "Not generated" },
    { label: "Raster", value: project?.upscaled_image_url ? "HD PNG available" : "Not generated" },
    { label: "Vector", value: project?.svg_url ? "SVG available" : "Not generated" },
    { label: "Review", value: canUsePaletteStudio ? "Palette Studio ready" : "Workspace tools" },
  ];

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
            <option value="auto" style={{ background: "#242424" }}>Auto (Precision Balance)</option>
            <option value="16" style={{ background: "#242424" }}>16 Colors (High Details)</option>
            <option value="8" style={{ background: "#242424" }}>8 Colors (Medium Details)</option>
            <option value="4" style={{ background: "#242424" }}>4 Colors (Merges Shadows)</option>
            <option value="2" style={{ background: "#242424" }}>2 Colors (Solid / Line Art)</option>
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
            onMouseOver={e => { if (svgEngine !== "standard") { e.currentTarget.style.borderColor = "#444"; e.currentTarget.style.color = "#aaa"; } }}
            onMouseOut={e => { if (svgEngine !== "standard") { e.currentTarget.style.borderColor = "#282828"; e.currentTarget.style.color = "#777"; } }}
          >
            <span>
              <strong>Standard SVG</strong>
              <small>1 Credit • Includes Palette Studio</small>
            </span>
            <b style={{ border: "none", color: svgEngine === "standard" ? "#FFD700" : "#555" }}>1</b>
          </button>
          <button
            type="button"
            className="svg-engine-option"
            onClick={() => setSvgEngine("precision")}
            style={engineButtonStyle(svgEngine === "precision")}
            onMouseOver={e => { if (svgEngine !== "precision") { e.currentTarget.style.borderColor = "#444"; e.currentTarget.style.color = "#aaa"; } }}
            onMouseOut={e => { if (svgEngine !== "precision") { e.currentTarget.style.borderColor = "#282828"; e.currentTarget.style.color = "#777"; } }}
          >
            <span>
              <strong><Sparkles size={11} /> Precision SVG</strong>
              <small>2 Credits • Cleaner paths + smoother Palette Studio</small>
            </span>
            <b style={{ border: "none", color: svgEngine === "precision" ? "#FFD700" : "#555" }}>2</b>
          </button>
        </div>
        <p style={{ marginTop: "8px", fontSize: "10px", color: "#555", lineHeight: 1.5 }}>
          {isLogoWorkspace
            ? "Precision is best for logos with small text, circles, and tight curves."
            : "Precision is best for logos, marks, and clean artwork that needs tighter SVG paths."}
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
              <span>{cropWarningCopy}</span>
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
            <span>{cropWarningCopy}</span>
          </div>
        )}

        {/* Primary: Export SVG — ghost yellow outline button */}
        <button
          onClick={() => handleDownloadClick('svg', onDownloadSvg)}
          disabled={!project?.svg_url || !!downloading}
          style={{
            width: "100%",
            background: project?.svg_url && !downloading ? "rgba(255, 215, 0, 0.12)" : "rgba(255, 255, 255, 0.02)",
            border: "1px solid " + (project?.svg_url && !downloading ? "#FFD700" : "#2a2a2a"),
            color: project?.svg_url && !downloading ? "#FFD700" : "#555",
            padding: "11px 14px",
            fontSize: "12px",
            fontWeight: "900",
            textTransform: "uppercase",
            letterSpacing: "1.5px",
            cursor: project?.svg_url && !downloading ? "pointer" : "not-allowed",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
            marginBottom: "7px",
            transition: "all 0.2s",
          }}
          onMouseOver={e => { 
            if (project?.svg_url && !downloading) {
              e.currentTarget.style.background = "#FFD700";
              e.currentTarget.style.color = "#000";
            }
          }}
          onMouseOut={e => { 
            if (project?.svg_url && !downloading) {
              e.currentTarget.style.background = "rgba(255, 215, 0, 0.12)";
              e.currentTarget.style.color = "#FFD700";
            }
          }}
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
            onMouseOver={e => { if (project?.original_image_url && !downloading) { e.currentTarget.style.color = "#fff"; e.currentTarget.style.background = "#242424"; e.currentTarget.style.borderColor = "#444"; } }}
            onMouseOut={e => { if (project?.original_image_url && !downloading) { e.currentTarget.style.color = "#b8b8b8"; e.currentTarget.style.background = "#1c1c1c"; e.currentTarget.style.borderColor = "#282828"; } }}
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
            onMouseOver={e => { if (project?.upscaled_image_url && !downloading) { e.currentTarget.style.color = "#fff"; e.currentTarget.style.background = "#242424"; e.currentTarget.style.borderColor = "#444"; } }}
            onMouseOut={e => { if (project?.upscaled_image_url && !downloading) { e.currentTarget.style.color = "#b8b8b8"; e.currentTarget.style.background = "#1c1c1c"; e.currentTarget.style.borderColor = "#282828"; } }}
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
            title={canUsePaletteStudio ? "Open Palette Studio" : "Generate SVG first"}
            style={secondaryBtnStyle(canUsePaletteStudio)}
            onMouseOver={e => { if (canUsePaletteStudio) { e.currentTarget.style.color = "#fff"; e.currentTarget.style.background = "#242424"; e.currentTarget.style.borderColor = "#444"; } }}
            onMouseOut={e => { if (canUsePaletteStudio) { e.currentTarget.style.color = "#b8b8b8"; e.currentTarget.style.background = "#1c1c1c"; e.currentTarget.style.borderColor = "#282828"; } }}
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
            onMouseOver={e => { if (project?.svg_url) { e.currentTarget.style.color = "#fff"; e.currentTarget.style.background = "#242424"; e.currentTarget.style.borderColor = "#444"; } }}
            onMouseOut={e => { if (project?.svg_url) { e.currentTarget.style.color = "#b8b8b8"; e.currentTarget.style.background = "#1c1c1c"; e.currentTarget.style.borderColor = "#282828"; } }}
          >
            <Monitor size={13} />
            <span style={secondaryActionLabelStyle}>
              <span>Before / After</span>
              <span>Compare</span>
            </span>
          </button>
        </div>

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
                ? "transparent"
                : (noCredits || isCropped)
                  ? "rgba(255, 215, 0, 0.12)"
                  : "rgba(255, 255, 255, 0.02)",
              border: "1px solid " + (
                isBusy ? "#2a2a2a" :
                  (noCredits || isCropped) ? "#FFD700" : "#2a2a2a"
              ),
              color: isBusy
                ? "#555"
                : (noCredits || isCropped)
                  ? "#FFD700"
                  : "#555",
              padding: "12px 16px",
              fontSize: "11px",
              fontWeight: "900",
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
                e.currentTarget.style.background = "#FFD700";
                e.currentTarget.style.color = "#000";
              }
            }}
            onMouseOut={e => {
              if (!isBusy && (noCredits || isCropped)) {
                e.currentTarget.style.background = "rgba(255, 215, 0, 0.12)";
                e.currentTarget.style.color = "#FFD700";
              }
            }}
          >
            {traceButtonLabel}
          </button>
        )}
      </div>

      {/* ── Output details + Console area ───────────────── */}
      <div style={{
        display: "flex",
        flexDirection: "column",
        background: "#171717",
        borderTop: "1px solid #2a2a2a",
        flexShrink: 0,
      }}>
        <div style={{
          padding: "13px 12px 12px",
          borderBottom: "1px solid #262626",
          background: "linear-gradient(180deg, #1b1b1b, #171717)",
        }}>
          <div style={{ marginBottom: "12px" }}>
            <span style={{ display: "block", fontSize: "10px", fontWeight: "800", color: "#e1e1e1", letterSpacing: "1.2px", textTransform: "uppercase" }}>
              Output Details
            </span>
            <small style={{ display: "block", marginTop: "4px", color: "#6d6d6d", fontSize: "10px", lineHeight: 1.35 }}>
              Clean production snapshot for this workspace.
            </small>
          </div>

          <div style={{
            display: "flex",
            flexDirection: "column",
            gap: "6px",
            background: "transparent",
            padding: "8px 0 4px",
          }}>
            {handoffItems.map((item, index) => {
              const isActive = item.value !== "Not generated";
              return (
                <div key={item.label} style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  minHeight: "22px",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "7px", width: "70px", flexShrink: 0 }}>
                    <div style={{ width: "10px", display: "flex", justifyContent: "center" }}>
                      {isActive ? (
                        <Check size={11} color="#FFD700" strokeWidth={3.5} />
                      ) : (
                        <div style={{ width: "4px", height: "1px", background: "#444" }} />
                      )}
                    </div>
                    <span style={{
                      color: isActive ? "#999" : "#555",
                      fontSize: "9px",
                      fontWeight: "800",
                      letterSpacing: "1px",
                      textTransform: "uppercase",
                    }}>
                      {item.label}
                    </span>
                  </div>
                  <div style={{ flex: 1, borderBottom: "1px dotted #333" }} />
                  <span style={{
                    color: isActive ? "#fff" : "#444",
                    fontSize: "9.5px",
                    fontWeight: "500",
                    fontFamily: "var(--font-geist-mono), monospace",
                    whiteSpace: "nowrap",
                  }}>
                    {item.value}
                  </span>
                </div>
              );
            })}
          </div>

          <p style={{
            margin: "10px 0 0",
            color: "#666",
            fontSize: "10px",
            lineHeight: 1.45,
          }}>
            Export files from the action buttons above after reviewing the output.
          </p>
        </div>
      </div>
    </aside>
  );
});

// Secondary button style helper
function secondaryBtnStyle(active) {
  return {
    width: "100%",
    background: "#1c1c1c",
    border: "1px solid #282828",
    color: active ? "#b8b8b8" : "#555",
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
    transition: "color 0.2s",
  };
}

function engineButtonStyle(active) {
  return {
    width: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "10px",
    background: active ? "rgba(255, 215, 0, 0.08)" : "#1c1c1c",
    border: "1px solid " + (active ? "#FFD700" : "#282828"),
    color: active ? "#fff" : "#777",
    padding: "9px 10px",
    cursor: "pointer",
    textAlign: "left",
    transition: "all 0.2s",
  };
}

export default PropertiesPanel;
