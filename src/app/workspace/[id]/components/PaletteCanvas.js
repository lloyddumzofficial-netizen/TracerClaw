import { Loader2, Maximize2, Minus, Plus } from "lucide-react";

export default function PaletteCanvas({
  svgUrl,
  sanitizedSvg,
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
  return (
    <div className="palette-artboard">
      <div className="palette-view-controls" aria-label="Palette preview zoom controls">
        <button onClick={() => onZoom(viewZoom - 0.2)} title="Zoom out"><Minus size={14} /></button>
        <span>{Math.round(viewZoom * 100)}%</span>
        <button onClick={() => onZoom(viewZoom + 0.2)} title="Zoom in"><Plus size={14} /></button>
        <button onClick={onResetView} title="Reset view"><Maximize2 size={14} /></button>
      </div>
      <div
        className="palette-canvas"
        onWheel={onWheel}
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
                className="palette-svg-preview"
                style={{ transform: `translate3d(${viewPan.x}px, ${viewPan.y}px, 0) scale(${viewZoom})` }}
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
