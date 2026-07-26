"use client";

import { memo, useCallback, useEffect, useRef } from "react";
import { CheckCircle, X, FolderDown, Download } from "lucide-react";
import SafeInlineSVG from "@/components/shared/SafeInlineSVG";

/**
 * CompareModal — Before/After slider.
 *
 * Cost notes, because this opens automatically after every generation:
 *
 *  - The AFTER image loads STRAIGHT FROM R2, not through /api/proxy. Proxying it
 *    spent a serverless invocation and billed Vercel egress to stream what can
 *    be a 17-20MP upscaled PNG, every single time the modal opened. R2 egress is
 *    free and the BEFORE image already loaded this way. If a direct load ever
 *    fails (an old fal.media URL, a CORS quirk) it falls back to the proxy once.
 *  - The slider writes to the DOM directly, batched into one rAF per frame, with
 *    element references captured on open instead of two getElementById calls on
 *    every mousemove.
 *
 * Mouse events, not pointer events, are used deliberately. The workspace is
 * desktop-only (DesktopRequiredNotice gates it), so pointer events would add no
 * users while changing the input path of a modal that now opens automatically
 * after every generation.
 */
const CompareModal = memo(function CompareModal({
  show,
  project,
  onClose,
  onDownloadAll,
  onDownloadSvg,
}) {
  const containerRef = useRef(null);
  const overlayRef = useRef(null);
  const lineRef = useRef(null);
  const draggingRef = useRef(false);
  const frameRef = useRef(0);
  const rafIdRef = useRef(0);
  const pendingRef = useRef(null);

  // One DOM write per frame, no matter how fast the mouse moves.
  const paint = useCallback(() => {
    frameRef.current = 0;
    const pct = pendingRef.current;
    if (pct == null) return;
    if (overlayRef.current) overlayRef.current.style.clipPath = `inset(0 ${100 - pct}% 0 0)`;
    if (lineRef.current) lineRef.current.style.left = `${pct}%`;
  }, []);

  const setPositionFromEvent = useCallback((clientX) => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    if (!rect.width) return;
    pendingRef.current = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));

    if (frameRef.current) return;
    // Mark as scheduled BEFORE requesting the frame. Assigning the rAF id after
    // the call would leave a stale non-zero id if the callback ever ran before
    // the assignment completed, and the slider would freeze after one move.
    frameRef.current = 1;
    rafIdRef.current = requestAnimationFrame(paint);
  }, [paint]);

  useEffect(() => {
    if (!show) return undefined;
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = 0;
      frameRef.current = 0;
      pendingRef.current = null;
      draggingRef.current = false;
    };
  }, [show, onClose]);

  if (!show || !project) return null;

  const rasterAfter = project.upscaled_image_url || project.generated_image_url;

  // Direct R2 first; proxy only if that genuinely fails.
  const onRasterError = (event) => {
    const img = event.currentTarget;
    if (img.dataset.viaProxy === "1") return;
    img.dataset.viaProxy = "1";
    img.src = `/api/proxy?url=${encodeURIComponent(rasterAfter)}`;
  };

  return (
    <div
      className="modal-overlay"
      onMouseMove={(e) => { if (draggingRef.current) setPositionFromEvent(e.clientX); }}
      onMouseUp={() => { draggingRef.current = false; }}
      onMouseLeave={() => { draggingRef.current = false; }}
    >
      <div className="modal-content" style={{ maxWidth: "1400px", width: "fit-content", padding: "0", overflow: "hidden" }}>
        {/* Header */}
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #2a2a2a", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <CheckCircle size={18} color="#888" />
            <span style={{ fontWeight: "700", fontSize: "15px", color: "#fff" }}>Generation Complete!</span>
            <span style={{ color: "#666", fontSize: "12px", marginLeft: "10px" }}>Drag slider to compare</span>
          </div>
          <button className="icon-btn-small" onClick={onClose} aria-label="Close comparison"><X size={16} /></button>
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
            ref={containerRef}
            id="compare-container"
            style={{
              position: "relative",
              overflow: "hidden", cursor: "ew-resize", userSelect: "none",
              boxShadow: "0 0 20px rgba(0,0,0,0.5)",
              maxWidth: "100%",
            }}
            onMouseDown={(e) => {
              draggingRef.current = true;
              setPositionFromEvent(e.clientX);
            }}
          >
            {/* INVISIBLE PLACEHOLDER dictating the exact aspect ratio of the original.
                Same src as the BEFORE layer, so the browser serves it from cache. */}
            <img
              src={project.original_image_url}
              style={{ display: "block", height: "80vh", width: "auto", maxWidth: "85vw", objectFit: "contain", opacity: 0, pointerEvents: "none" }}
              alt=""
              aria-hidden="true"
              decoding="async"
            />

            {/* AFTER layer */}
            {rasterAfter ? (
              <img
                src={rasterAfter}
                onError={onRasterError}
                style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none", objectFit: "contain" }}
                alt="After"
                decoding="async"
              />
            ) : (
              <SafeInlineSVG
                url={project.svg_url ? `/api/proxy?url=${encodeURIComponent(project.svg_url)}` : null}
                style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none" }}
              />
            )}

            {/* BEFORE layer — stretched to fill */}
            <div
              ref={overlayRef}
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
                decoding="async"
                style={{ width: "100%", height: "100%", objectFit: "fill", pointerEvents: "none" }}
              />
            </div>

            {/* Slider Line */}
            <div
              ref={lineRef}
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
            <div style={{ position: "absolute", bottom: "14px", right: "14px", background: "rgba(0,0,0,0.75)", padding: "4px 10px", borderRadius: "4px", color: "#aaa", fontSize: "11px", pointerEvents: "none", letterSpacing: "0.5px" }}>
              {rasterAfter ? "AI UPSCALED (AFTER)" : "VECTOR (AFTER)"}
            </div>
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
