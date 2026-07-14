"use client";

import { memo, useRef, useState, useEffect } from "react";
import { CheckCircle, X, FolderDown, Download } from "lucide-react";

/** Fetches SVG text and injects inline for reliable cross-browser SVG rendering */
function InlineSVG({ url, style }) {
  const [svgHtml, setSvgHtml] = useState(null);
  useEffect(() => {
    if (!url) { setSvgHtml(null); return; }
    setSvgHtml(null);
    fetch(url)
      .then(r => r.text())
      .then(text => {
        const safe = text
          .replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/\son\w+="[^"]*"/gi, '')
          .replace(/\son\w+='[^']*'/gi, '');
        if (safe.includes('<svg')) {
          const scaled = safe.replace(/<svg([^>]*?)>/i, (_, attrs) => {
            let clean = attrs;
            const wMatch = attrs.match(/\swidth=["']([^"']+)["']/i);
            const hMatch = attrs.match(/\sheight=["']([^"']+)["']/i);
            const vMatch = attrs.match(/\sviewBox=["']([^"']+)["']/i);

            clean = clean.replace(/\s+width=["'][^"']*["']/gi, '')
                         .replace(/\s+height=["'][^"']*["']/gi, '');

            if (!vMatch && wMatch && hMatch) {
              const w = parseFloat(wMatch[1].replace(/px/i, ''));
              const h = parseFloat(hMatch[1].replace(/px/i, ''));
              if (!isNaN(w) && !isNaN(h)) {
                clean += ` viewBox="0 0 ${w} ${h}"`;
              }
            }
            return `<svg${clean} style="width:100%;height:100%;display:block;" preserveAspectRatio="xMidYMid meet">`;
          });
          setSvgHtml(scaled);
        }
      })
      .catch(err => console.error('[InlineSVG] fetch failed:', err));
  }, [url]);
  if (!svgHtml) return null;
  return <div style={{ ...style, overflow: 'hidden' }} dangerouslySetInnerHTML={{ __html: svgHtml }} />;
}

/**
 * CompareModal — Before/After slider comparison modal.
 * DOM-direct clip-path manipulation for zero-lag slider dragging.
 */
const CompareModal = memo(function CompareModal({
  show,
  project,
  onClose,
  onDownloadAll,
  onDownloadSvg,
}) {
  const isDraggingCompare = useRef(false);

  if (!show || !project) return null;

  return (
    <div
      className="modal-overlay"
      onMouseMove={(e) => {
        if (!isDraggingCompare.current) return;
        const container = document.getElementById("compare-container");
        if (!container) return;
        const rect = container.getBoundingClientRect();
        let newPos = ((e.clientX - rect.left) / rect.width) * 100;
        newPos = Math.max(0, Math.min(100, newPos));
        // DIRECT DOM MANIPULATION — prevents massive lag vs setState
        const overlayImg = document.getElementById("compare-overlay-img");
        const sliderLine = document.getElementById("compare-slider-line");
        if (overlayImg) overlayImg.style.clipPath = `inset(0 ${100 - newPos}% 0 0)`;
        if (sliderLine) sliderLine.style.left = `${newPos}%`;
      }}
      onMouseUp={() => { isDraggingCompare.current = false; }}
      onMouseLeave={() => { isDraggingCompare.current = false; }}
    >
      <div className="modal-content" style={{ maxWidth: "1400px", width: "fit-content", padding: "0", overflow: "hidden" }}>
        {/* Header */}
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #2a2a2a", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <CheckCircle size={18} color="#888" />
            <span style={{ fontWeight: "700", fontSize: "15px", color: "#fff" }}>Generation Complete!</span>
            <span style={{ color: "#666", fontSize: "12px", marginLeft: "10px" }}>Drag slider to compare</span>
          </div>
          <button className="icon-btn-small" onClick={onClose}><X size={16} /></button>
        </div>

        {/* Slider Compare Area */}
        <div
          style={{
            position: "relative", width: "100%", display: "flex", justifyContent: "center",
            background: "repeating-conic-gradient(#1e1e1e 0% 25%, #141414 0% 50%) 0 0 / 20px 20px",
            padding: "0"
          }}
        >
          <div
            id="compare-container"
            style={{
              position: "relative",
              overflow: "hidden", cursor: "ew-resize", userSelect: "none",
              boxShadow: "0 0 20px rgba(0,0,0,0.5)",
              maxWidth: "100%",
            }}
            onMouseDown={(e) => {
              isDraggingCompare.current = true;
              const rect = e.currentTarget.getBoundingClientRect();
              const pct = ((e.clientX - rect.left) / rect.width) * 100;
              const overlayImg = document.getElementById("compare-overlay-img");
              const sliderLine = document.getElementById("compare-slider-line");
              if (overlayImg) overlayImg.style.clipPath = `inset(0 ${100 - pct}% 0 0)`;
              if (sliderLine) sliderLine.style.left = `${pct}%`;
            }}
          >
            {/* INVISIBLE PLACEHOLDER to dictate the exact aspect ratio of the original image */}
            <img
              src={project.original_image_url}
              style={{ display: "block", height: "80vh", width: "auto", maxWidth: "85vw", objectFit: "contain", opacity: 0, pointerEvents: "none" }}
              alt=""
            />

            {/* AFTER layer — SVG inline (most reliable rendering method) */}
            <InlineSVG
              url={project.svg_url ? `/api/proxy?url=${encodeURIComponent(project.svg_url)}` : null}
              style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none" }}
            />

            {/* BEFORE layer — stretched to fill */}
            <div
              id="compare-overlay-img"
              style={{
                position: "absolute", top: 0, left: 0, width: "100%", height: "100%",
                clipPath: "inset(0 50% 0 0)",
                willChange: "clip-path",
                transform: "translateZ(0)",
              }}
            >
              <img
                draggable={false}
                src={project.original_image_url}
                alt="Original"
                style={{ width: "100%", height: "100%", objectFit: "fill", pointerEvents: "none" }}
              />
            </div>

            {/* Slider Line */}
            <div
              id="compare-slider-line"
              style={{
                position: "absolute", top: 0, bottom: 0, left: "50%",
                width: "2px", background: "#555",
                transform: "translateX(-50%) translateZ(0)", pointerEvents: "none", willChange: "left",
              }}
            >
              <div style={{
                position: "absolute", top: "50%", left: "50%",
                transform: "translate(-50%, -50%)",
                width: "36px", height: "36px", background: "#333", borderRadius: "50%",
                display: "flex", alignItems: "center", justifyContent: "center",
                boxShadow: "0 0 12px rgba(0,0,0,0.5)", border: "1px solid #555", gap: "1px",
              }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#aaa" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#aaa" strokeWidth="2"><path d="M9 18l6-6-6-6" /></svg>
              </div>
            </div>

            {/* Labels */}
            <div style={{ position: "absolute", bottom: "14px", left: "14px", background: "rgba(0,0,0,0.75)", padding: "4px 10px", borderRadius: "4px", color: "#aaa", fontSize: "11px", pointerEvents: "none", letterSpacing: "0.5px" }}>ORIGINAL (BEFORE)</div>
            <div style={{ position: "absolute", bottom: "14px", right: "14px", background: "rgba(0,0,0,0.75)", padding: "4px 10px", borderRadius: "4px", color: "#aaa", fontSize: "11px", pointerEvents: "none", letterSpacing: "0.5px" }}>VECTOR (AFTER)</div>
          </div>
        </div>

        {/* Download actions */}
        <div style={{ padding: "14px 20px", borderTop: "1px solid #2a2a2a", display: "flex", gap: "10px" }}>
          <button
            onClick={() => { onDownloadAll(); onClose(); }}
            style={{ flex: 1, padding: "12px", background: "#2a2a2a", color: "#fff", border: "1px solid #444", borderRadius: "6px", fontWeight: "800", fontSize: "13px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}
            onMouseOver={e => e.currentTarget.style.background = "#333"}
            onMouseOut={e => e.currentTarget.style.background = "#2a2a2a"}
          >
            <FolderDown size={15} /> Download All (ZIP)
          </button>
          <button
            onClick={onDownloadSvg}
            style={{ flex: 1, padding: "12px", background: "#111", color: "#e0e0e0", border: "1px solid #444", borderRadius: "6px", fontWeight: "800", fontSize: "13px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}
            onMouseOver={e => { e.currentTarget.style.background = "#1a1a1a"; e.currentTarget.style.color = "#fff"; }}
            onMouseOut={e => { e.currentTarget.style.background = "#111"; e.currentTarget.style.color = "#e0e0e0"; }}
          >
            <Download size={15} /> SVG Only
          </button>
          <button
            onClick={onClose}
            style={{ padding: "11px 16px", background: "transparent", color: "#666", border: "1px solid #333", borderRadius: "8px", cursor: "pointer", fontSize: "13px" }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
});

export default CompareModal;
