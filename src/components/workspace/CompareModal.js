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
  const isPatternWorkspace = project.trace_type === "pattern";
  const outputLabel = isPatternWorkspace
    ? "Retraced output"
    : rasterAfter
      ? "Processed output"
      : "Vector output";

  // Direct R2 first; proxy only if that genuinely fails.
  const onRasterError = (event) => {
    const img = event.currentTarget;
    if (img.dataset.viaProxy === "1") return;
    img.dataset.viaProxy = "1";
    img.src = `/api/proxy?url=${encodeURIComponent(rasterAfter)}`;
  };

  return (
    <div
      className="modal-overlay compare-modal-overlay"
      onMouseMove={(e) => { if (draggingRef.current) setPositionFromEvent(e.clientX); }}
      onMouseUp={() => { draggingRef.current = false; }}
      onMouseLeave={() => { draggingRef.current = false; }}
    >
      <div className="modal-content compare-modal-shell">
        {/* Header */}
        <div className="compare-modal-header">
          <div className="compare-modal-heading">
            <span className="compare-modal-status"><CheckCircle size={14} /> Output ready</span>
            <div>
              <strong>Review the final artwork</strong>
              <span>Drag across the image to inspect the source and result.</span>
            </div>
          </div>
          <button className="compare-modal-close" onClick={onClose} aria-label="Close comparison"><X size={16} /></button>
        </div>

        {/* Slider Compare Area */}
        <div
          className="compare-modal-stage"
        >
          <div
            ref={containerRef}
            id="compare-container"
            className="compare-modal-canvas"
            onMouseDown={(e) => {
              draggingRef.current = true;
              setPositionFromEvent(e.clientX);
            }}
          >
            {/* INVISIBLE PLACEHOLDER dictating the exact aspect ratio of the original.
                Same src as the BEFORE layer, so the browser serves it from cache. */}
            <img
              src={project.original_image_url}
              className="compare-modal-placeholder"
              alt=""
              aria-hidden="true"
              decoding="async"
            />

            {/* AFTER layer */}
            {rasterAfter ? (
              <img
                src={rasterAfter}
                onError={onRasterError}
                className="compare-modal-image"
                alt="After"
                decoding="async"
              />
            ) : (
              <SafeInlineSVG
                url={project.svg_url ? `/api/proxy?url=${encodeURIComponent(project.svg_url)}` : null}
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
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
                className="compare-modal-image compare-modal-before-image"
              />
            </div>

            {/* Slider Line */}
            <div
              ref={lineRef}
              id="compare-slider-line"
              className="compare-modal-divider"
            >
              <div className="compare-modal-divider-handle">
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6" /></svg>
              </div>
            </div>

            {/* Labels */}
            <div className="compare-modal-label is-source">Source</div>
            <div className="compare-modal-label is-output">{outputLabel}</div>
          </div>
        </div>

        {/* Download actions */}
        <div className="compare-modal-actions">
          <div className="compare-modal-export-copy">
            <span>Export package</span>
            <strong>Production files are ready</strong>
          </div>
          <div className="compare-modal-action-buttons">
          <button
            onClick={() => { onDownloadAll(); onClose(); }}
            className="compare-modal-download-primary"
          >
            <FolderDown size={15} /> Download All (ZIP)
          </button>
          <button
            onClick={onDownloadSvg}
            className="compare-modal-download-secondary"
          >
            <Download size={15} /> SVG Only
          </button>
          <button
            onClick={onClose}
            className="compare-modal-dismiss"
          >
            Close
          </button>
          </div>
        </div>
      </div>
    </div>
  );
});

export default CompareModal;
