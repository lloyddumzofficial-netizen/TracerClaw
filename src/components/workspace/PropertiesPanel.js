"use client";

import { memo, useState, useEffect, useRef } from "react";
import {
  Loader2,
  Sparkles,
  X,
  ChevronDown,
  AlertCircle,
  Download,
  Palette,
  SplitSquareHorizontal,
  CheckCircle2,
  HelpCircle,
  ExternalLink
} from "lucide-react";

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
  const [downloading, setDownloading] = useState(null);

  // ── Live processing timer ──────────────────────────────────────────────────
  const [elapsedSec, setElapsedSec] = useState(0);
  const [finalSec, setFinalSec] = useState(null);
  const timerRef = useRef(null);
  const startTimeRef = useRef(null);

  useEffect(() => {
    const isProcessing = traceState !== "idle";
    if (isProcessing) {
      // Start fresh timer when processing begins
      if (!timerRef.current) {
        startTimeRef.current = Date.now();
        setElapsedSec(0);
        setFinalSec(null);
        timerRef.current = setInterval(() => {
          setElapsedSec(Math.floor((Date.now() - startTimeRef.current) / 1000));
        }, 1000);
      }
    } else {
      // Processing finished — freeze the timer
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
        setFinalSec(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }
    }
    return () => { };
  }, [traceState]);

  // Cleanup on unmount
  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  const stepsDone = traceState === "step2" ? 1 : traceState === "step3" ? 2 : traceState === "idle" && finalSec !== null ? 3 : 0;
  const isProcessing = traceState !== "idle";
  const steps = [
    { label: "Neural Extract", active: traceState === "step1" },
    { label: "Upscale", active: traceState === "step2" },
    { label: "Vectorize", active: traceState === "step3" },
  ];
  const fmtTime = (s) => s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;

  const creditCost = svgEngine === "precision" ? 2 : 1;
  const noCredits = userCredits !== null && userCredits < creditCost;
  const isCropped = project?.original_image_url?.includes("crop") || project?.generated_image_url;
  const isBusy = traceState !== "idle" || isSavingCrop;
  const hasSvg = Boolean(project?.svg_url);          // ← permanent gate: SVG already exists
  const canUsePaletteStudio = hasSvg;
  const isLogoWorkspace = project?.trace_type === "logo";

  const cropWarningCopy = isLogoWorkspace
    ? "Crop tightly around the mark and remove empty background."
    : "If image shows front AND back of a shirt, use Crop Tool to isolate one side.";

  const handleDownloadClick = async (type, handler) => {
    if (downloading) return;
    setDownloading(type);
    try { await handler(); } finally { setDownloading(null); }
  };

  const traceButtonLabel = hasSvg
    ? "SVG Generated"
    : isSavingCrop
      ? "Saving Crop…"
      : traceState !== "idle"
        ? "Processing…"
        : noCredits
          ? "Get More Credits"
          : !isCropped
            ? "Crop Image First"
            : `Run Auto-Trace  (−${creditCost} Credit${creditCost > 1 ? "s" : ""})`;

  const canTrace = !isBusy && !hasSvg && (noCredits || isCropped);

  const exportDetails = [
    { label: "File Format", value: "SVG", gold: false },
    { label: "Max Vectors", value: "Unlimited", gold: false },
    { label: "Color Mode", value: "Full Color", gold: false },
    { label: "Max Size", value: "50 MP", gold: false },
    { label: "Credits Required", value: `${creditCost} Credit`, gold: true },
  ];

  return (
    <aside style={{
      width: "280px",
      background: "#161616",
      borderLeft: "1px solid #222",
      display: "flex",
      flexDirection: "column",
      flexShrink: 0,
      height: "100%",
      overflow: "hidden",
      fontFamily: "var(--font-inter, 'Inter', sans-serif)",
    }}>

      <style>{`
        .pp-card {
          width: 100%; display: flex; align-items: center; gap: 12px;
          background: transparent; border: 1px solid #333; color: #71717a;
          padding: 10px 12px; cursor: pointer; text-align: left;
          transition: border-color .15s, color .15s, background .15s;
          border-radius: 0;
        }
        .pp-card.on { border-color: #FFD700; color: #e4e4e7; background: rgba(255, 215, 0, 0.04); }
        .pp-card:not(.on):hover { border-color: #555; color: #a1a1aa; }

        .pp-sec {
          background: transparent; border: 1px solid #333; color: #a1a1aa;
          min-height: 52px; padding: 6px;
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
          border: none; color: #000; padding: 12px 14px;
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
          text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;
        }
        .pp-desc {
          font-size: 10px; color: #52525b; line-height: 1.5; margin-top: 8px;
        }

        .pp-warn {
          background: rgba(239, 68, 68, 0.05); border: 1px solid rgba(239, 68, 68, 0.2);
          padding: 10px; display: flex; gap: 8px; align-items: flex-start;
          border-radius: 0;
        }
        .pp-warn span {
          font-size: 10px; color: #ef4444; line-height: 1.4;
        }

        .pp-row { display: flex; align-items: center; gap: 6px; height: 18px; margin-bottom: 2px;}
        .pp-row-lbl {
          font-size: 10px; color: #a1a1aa; white-space: nowrap;
        }
        .pp-row-val {
          font-size: 10px; font-weight: 500; white-space: nowrap;
        }
        .pp-row-dot { flex: 1; border-bottom: 1px dotted #333; margin: 0 4px; }

        @keyframes pp-spin { to { transform: rotate(360deg); } }
        .pp-spin { animation: pp-spin .9s linear infinite; display: inline-flex; }
        @keyframes pp-shimmer { 0% { left: -100%; } 100% { left: 200%; } }
      `}</style>

      {/* ── HEADER ───────────────────────────────────────── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "14px 16px", borderBottom: "1px solid #222", flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <Sparkles size={14} color="#e4e4e7" />
          <span style={{
            fontSize: "11px", fontWeight: "600",
            color: "#fff", letterSpacing: "1px", textTransform: "uppercase",
          }}>AI Trace Settings</span>
        </div>
        <button style={{ background: "none", border: "none", cursor: "pointer", padding: "2px", display: "flex" }}
          onClick={() => { }} aria-label="Close panel">
          <X size={14} color="#71717a" />
        </button>
      </div>

      {/* ── COLOR DETAIL ─────────────────────────────────── */}
      <div style={{ padding: "14px 16px", flexShrink: 0 }}>
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
      <div style={{ padding: "0 16px 14px", flexShrink: 0 }}>
        <span className="pp-lbl">SVG Mode</span>
        <div style={{ display: "grid", gap: "8px" }}>

          {/* Standard */}
          <button type="button" className={`pp-card${svgEngine === "standard" ? " on" : ""}`}
            onClick={() => setSvgEngine("standard")}>
            <div style={{ color: svgEngine === "standard" ? "#FFD700" : "#a1a1aa", flexShrink: 0, display: "flex" }}>
              <IconBezier />
            </div>
            <div style={{ flex: 1, textAlign: "left" }}>
              <div style={{ fontSize: "11px", fontWeight: "700", textTransform: "uppercase", color: svgEngine === "standard" ? "#e4e4e7" : "#a1a1aa", marginBottom: "2px" }}>
                Standard SVG
              </div>
              <div style={{ fontSize: "9px", color: "#71717a" }}>
                1 Credit • Includes Palette Studio
              </div>
            </div>
            <div style={{
              width: "22px", height: "22px", border: "1px solid", borderColor: svgEngine === "standard" ? "#FFD700" : "#333",
              background: "transparent", color: svgEngine === "standard" ? "#FFD700" : "#a1a1aa",
              fontSize: "11px", fontWeight: "600", display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0
            }}>1</div>
          </button>

          {/* Precision */}
          <button type="button" className={`pp-card${svgEngine === "precision" ? " on" : ""}`}
            onClick={() => setSvgEngine("precision")}>
            <div style={{ color: svgEngine === "precision" ? "#FFD700" : "#a1a1aa", flexShrink: 0, display: "flex" }}>
              <Sparkles size={16} />
            </div>
            <div style={{ flex: 1, textAlign: "left" }}>
              <div style={{ fontSize: "11px", fontWeight: "700", textTransform: "uppercase", color: svgEngine === "precision" ? "#e4e4e7" : "#a1a1aa", marginBottom: "2px" }}>
                Precision SVG
              </div>
              <div style={{ fontSize: "9px", color: "#71717a" }}>
                2 Credits • Cleaner paths + smoother Palette Studio
              </div>
            </div>
            <div style={{
              width: "22px", height: "22px", border: "1px solid", borderColor: svgEngine === "precision" ? "#FFD700" : "#333",
              background: "transparent", color: svgEngine === "precision" ? "#FFD700" : "#a1a1aa",
              fontSize: "11px", fontWeight: "600", display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0
            }}>2</div>
          </button>
        </div>

        <p className="pp-desc">
          {isLogoWorkspace
            ? "Precision is best for logos with small text, circles, and tight curves."
            : "Precision is best for logos, marks, and clean artwork that needs tighter SVG paths."}
        </p>
      </div>

      {/* ── ADVANCED SETTINGS ────────────────────────────── */}
      <div style={{ padding: "0 16px 14px", flexShrink: 0 }}>
        <button onClick={() => setAdvancedOpen(v => !v)}
          style={{
            width: "100%", display: "flex", alignItems: "center",
            justifyContent: "space-between", padding: "10px 12px",
            background: "transparent", border: "1px solid #333",
            color: "#e4e4e7", cursor: "pointer",
            fontSize: "9px", fontWeight: "600",
            letterSpacing: "0.5px", textTransform: "uppercase", transition: "border-color .15s",
          }}
          onMouseOver={e => e.currentTarget.style.borderColor = "#444"}
          onMouseOut={e => e.currentTarget.style.borderColor = "#333"}
        >
          <span>Advanced Settings</span>
          <ChevronDown size={14} style={{ transform: advancedOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
        </button>
        {advancedOpen && (
          <div style={{ paddingTop: "8px" }}>
            <div className="pp-warn"><AlertCircle size={14} color="#ef4444" style={{ flexShrink: 0, marginTop: "1px" }} /><span>{cropWarningCopy}</span></div>
          </div>
        )}
      </div>

      {/* ── ACTIONS ──────────────────────────────────────── */}
      <div style={{ padding: "0 16px 14px", flexShrink: 0 }}>
        <span className="pp-lbl">Actions</span>

        {/* ── RUN AUTO-TRACE — always visible ── */}
        <button
          onClick={() => {
            if (isBusy) return;
            if (noCredits) { onOpenTopUp?.(); return; }
            if (isCropped) onExecuteTrace(vectorColors, svgEngine);
          }}
          disabled={isBusy || hasSvg || (!isCropped && !noCredits)}
          style={{
            width: "100%", padding: "9px 14px", marginBottom: "10px",
            fontSize: "10px", fontWeight: "700",
            textTransform: "uppercase", letterSpacing: "1px",
            cursor: (isBusy || hasSvg || (!isCropped && !noCredits)) ? "not-allowed" : "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
            transition: "all .2s ease",
            background: hasSvg
              ? "transparent"
              : isBusy
                ? "transparent"
                : (noCredits || isCropped)
                  ? "#FFD700"
                  : "rgba(255,215,0,0.06)",
            border: "2px solid " + (
              hasSvg ? "#2a2a2a"
              : isBusy ? "#333"
              : (noCredits || isCropped) ? "#FFD700"
              : "#FFD70066"
            ),
            color: hasSvg
              ? "#3f3f46"
              : isBusy
                ? "#555"
                : (noCredits || isCropped)
                  ? "#000"
                  : "#FFD70099",
            boxShadow: (!hasSvg && !isBusy && (noCredits || isCropped))
              ? "0 0 18px rgba(255,215,0,0.25), inset 0 1px 0 rgba(255,255,255,0.15)"
              : "none",
            opacity: hasSvg ? 0.45 : 1,
          }}
          onMouseOver={e => {
            if (!isBusy && !hasSvg && (noCredits || isCropped)) {
              e.currentTarget.style.background = "#f0c900";
              e.currentTarget.style.boxShadow = "0 0 28px rgba(255,215,0,0.4)";
              e.currentTarget.style.transform = "translateY(-1px)";
            }
          }}
          onMouseOut={e => {
            e.currentTarget.style.background = hasSvg ? "transparent" : isBusy ? "transparent" : (noCredits || isCropped) ? "#FFD700" : "rgba(255,215,0,0.06)";
            e.currentTarget.style.boxShadow = (!hasSvg && !isBusy && (noCredits || isCropped)) ? "0 0 18px rgba(255,215,0,0.25), inset 0 1px 0 rgba(255,255,255,0.15)" : "none";
            e.currentTarget.style.transform = "none";
          }}
        >
          {hasSvg
            ? <CheckCircle2 size={15} color="#3f3f46" />
            : isBusy
              ? <span className="pp-spin"><Loader2 size={15} /></span>
              : <Sparkles size={15} />}
          {traceButtonLabel}
        </button>

        {/* Warning — only when Advanced is closed */}
        {!advancedOpen && (
          <div className="pp-warn" style={{ marginBottom: "10px" }}>
            <AlertCircle size={14} color="#ef4444" style={{ flexShrink: 0, marginTop: "1px" }} /><span>{cropWarningCopy}</span>
          </div>
        )}

        {/* Export as SVG */}
        <button className="pp-svg-btn"
          onClick={() => handleDownloadClick("svg", onDownloadSvg)}
          disabled={!project?.svg_url || !!downloading}
          style={{ marginBottom: "8px" }}>
          {downloading === "svg"
            ? <span className="pp-spin"><Loader2 size={16} /></span>
            : <Download size={16} />}
          Export as SVG
        </button>

        {/* 2×2 grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
          <button className="pp-sec"
            onClick={() => handleDownloadClick("all", onDownloadAll)}
            disabled={!project?.original_image_url || !!downloading}>
            {downloading === "all" ? <span className="pp-spin"><Loader2 size={15} /></span> : <IconFileZip />}
            <span>Download<br />All (ZIP)</span>
          </button>
          <button className="pp-sec"
            onClick={() => handleDownloadClick("raster", onDownloadRaster)}
            disabled={!project?.upscaled_image_url || !!downloading}>
            {downloading === "raster" ? <span className="pp-spin"><Loader2 size={15} /></span> : <Download size={15} />}
            <span>Export<br />as PNG</span>
          </button>
          <button className="pp-sec"
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
      </div>

      {/* ── EXPORT DETAILS ───────────────────────────────── */}
      <div style={{ padding: "0 16px 14px", flexShrink: 0 }}>
        <span className="pp-lbl">Export Details</span>
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          {exportDetails.map(({ label, value, gold }) => (
            <div key={label} className="pp-row">
              <CheckCircle2 size={12} color="#FFD700" />
              <span className="pp-row-lbl">{label}</span>
              <div className="pp-row-dot" />
              <span className="pp-row-val" style={{ color: gold ? "#FFD700" : "#e4e4e7", fontWeight: gold ? "600" : "400" }}>
                {value}
              </span>
            </div>
          ))}

          {/* ── Processing Time — live progress ── */}
          <div style={{ marginTop: "6px", paddingTop: "6px", borderTop: "1px solid #222" }}>
            <div className="pp-row" style={{ marginBottom: "6px" }}>
              <span className="pp-row-lbl" style={{ fontSize: "9px" }}>Processing Time</span>
              <div className="pp-row-dot" />
              <span style={{
                fontSize: "10px", fontWeight: "600", fontVariantNumeric: "tabular-nums",
                color: isProcessing ? "#FFD700" : finalSec !== null ? "#e4e4e7" : "#52525b",
                minWidth: "32px", textAlign: "right",
              }}>
                {isProcessing
                  ? `${fmtTime(elapsedSec)}…`
                  : finalSec !== null
                    ? fmtTime(finalSec)
                    : "10 – 30 sec"}
              </span>
            </div>

            {/* Step pills */}
            <div style={{ display: "flex", gap: "4px" }}>
              {steps.map((step, i) => {
                const done = i < stepsDone;
                const active = step.active;
                return (
                  <div key={step.label} style={{
                    flex: 1, display: "flex", flexDirection: "column",
                    alignItems: "center", gap: "3px",
                  }}>
                    <div style={{
                      width: "100%", height: "4px", borderRadius: "2px",
                      background: done
                        ? "#FFD700"
                        : active
                          ? "linear-gradient(90deg, #FFD700 40%, #333 100%)"
                          : "#2a2a2a",
                      transition: "background 0.4s ease",
                      boxShadow: done ? "0 0 6px rgba(255,215,0,0.5)" : active ? "0 0 4px rgba(255,215,0,0.3)" : "none",
                      position: "relative", overflow: active ? "hidden" : "visible",
                    }}>
                      {active && (
                        <div style={{
                          position: "absolute", top: 0, left: "-100%", width: "60%", height: "100%",
                          background: "linear-gradient(90deg, transparent, rgba(255,215,0,0.6), transparent)",
                          animation: "pp-shimmer 1.2s ease-in-out infinite",
                        }} />
                      )}
                    </div>
                    <span style={{
                      fontSize: "7.5px", fontWeight: "600", letterSpacing: "0.3px",
                      textTransform: "uppercase",
                      color: done ? "#FFD700" : active ? "#a1a1aa" : "#3f3f46",
                      transition: "color 0.3s",
                    }}>{step.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ── HELP FOOTER ──────────────────────────────────── */}
      <div style={{
        padding: "16px",
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px",
        background: "transparent", borderTop: "1px solid #222", flexShrink: 0,
        marginTop: "auto",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <HelpCircle size={18} color="#FFD700" />
          <div>
            <div style={{ fontSize: "10px", fontWeight: "600", color: "#e4e4e7", marginBottom: "2px" }}>
              Need help?
            </div>
            <div style={{ fontSize: "9px", color: "#a1a1aa" }}>
              View guide or contact support.
            </div>
          </div>
        </div>
        <button
          onClick={() => window.open("https://help.desaynclaw.com", "_blank")}
          style={{
            background: "transparent", border: "1px solid #333", color: "#a1a1aa",
            fontSize: "8px", fontWeight: "700", letterSpacing: "0.5px",
            textTransform: "uppercase", padding: "6px 10px", cursor: "pointer",
            display: "flex", alignItems: "center", gap: "6px",
            transition: "all .15s"
          }}
          onMouseOver={e => e.currentTarget.style.borderColor = "#555"}
          onMouseOut={e => e.currentTarget.style.borderColor = "#333"}
        >
          View Guide <ExternalLink size={10} />
        </button>
      </div>

    </aside>
  );
});

export default PropertiesPanel;
