import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Maximize2, Minus, Plus } from "lucide-react";
import { normalizeColor } from "./PalettePreviewModal.utils";

function getRenderedPaintColors(element) {
  const colors = [];
  ["fill", "stroke", "stop-color"].forEach((attr) => {
    const color = normalizeColor(element.getAttribute(attr));
    if (color) colors.push(color);
  });

  const inlineStyle = element.getAttribute("style") || "";
  for (const match of inlineStyle.matchAll(/(?:fill|stroke|stop-color)\s*:\s*([^;]+)/gi)) {
    const color = normalizeColor(match[1]);
    if (color) colors.push(color);
  }

  const computed = window.getComputedStyle(element);
  ["fill", "stroke", "stopColor"].forEach((prop) => {
    const color = normalizeColor(computed[prop]);
    if (color) colors.push(color);
  });

  return [...new Set(colors)];
}

export default function PaletteCanvas({
  svgUrl,
  sanitizedSvg,
  selectedColor,
  svgDimensions,
  sizeLabel,
  viewZoom,
  viewPan,
  onZoom,
  onResetView,
  onWheel,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onClick,
}) {
  const canvasRef = useRef(null);
  const previewRef = useRef(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !onWheel) return;

    const handleWheel = (event) => onWheel(event);
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleWheel);
  }, [onWheel]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setCanvasSize({ width, height });
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  const previewSize = useMemo(() => {
    if (!svgDimensions || !canvasSize.width || !canvasSize.height) return null;
    const availableWidth = Math.max(120, canvasSize.width - 88);
    const availableHeight = Math.max(120, canvasSize.height - 88);
    const scale = Math.min(
      availableWidth / svgDimensions.width,
      availableHeight / svgDimensions.height
    );

    return {
      width: Math.max(1, Math.round(svgDimensions.width * scale)),
      height: Math.max(1, Math.round(svgDimensions.height * scale)),
    };
  }, [canvasSize, svgDimensions]);

  useEffect(() => {
    const preview = previewRef.current;
    if (!preview) return;

    const previous = preview.querySelectorAll(".dc-palette-focus-hit, .dc-palette-focus-muted");
    previous.forEach((element) => {
      element.classList.remove("dc-palette-focus-hit", "dc-palette-focus-muted");
    });

    const normalizedSelected = normalizeColor(selectedColor);
    if (!normalizedSelected) return;

    preview.querySelectorAll("svg *").forEach((element) => {
      if (element.tagName?.toLowerCase() === "svg") return;
      const colors = getRenderedPaintColors(element);
      if (colors.length === 0) return;
      element.classList.add(colors.includes(normalizedSelected) ? "dc-palette-focus-hit" : "dc-palette-focus-muted");
    });
  }, [sanitizedSvg, selectedColor]);

  return (
    <div className="palette-artboard">
      <div className="palette-view-controls" aria-label="Palette preview zoom controls">
        <button onClick={() => onZoom(viewZoom / 1.35)} title="Zoom out"><Minus size={14} /></button>
        <span>{Math.round(viewZoom * 100)}%</span>
        <button onClick={() => onZoom(viewZoom * 1.35)} title="Zoom in"><Plus size={14} /></button>
        <button onClick={onResetView} title="Reset view"><Maximize2 size={14} /></button>
      </div>
      <div
        ref={canvasRef}
        className="palette-canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={onClick}
      >
        {svgUrl && (
          sanitizedSvg
            ? (
              <div
                ref={previewRef}
                className={`palette-svg-preview${selectedColor ? " is-color-focused" : ""}`}
                style={{
                  ...(previewSize ? {
                    width: `${previewSize.width}px`,
                    height: `${previewSize.height}px`,
                  } : null),
                  transform: `translate3d(${viewPan.x}px, ${viewPan.y}px, 0) scale(${Math.max(0.25, viewZoom)})`,
                }}
                dangerouslySetInnerHTML={{ __html: sanitizedSvg }}
              />
            )
            : <div className="palette-loading"><Loader2 size={18} className="animate-spin" /> Loading SVG</div>
        )}
        <span>{sizeLabel}</span>
      </div>
    </div>
  );
}
