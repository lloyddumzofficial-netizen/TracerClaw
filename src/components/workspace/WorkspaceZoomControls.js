"use client";

import { ArrowsOutSimpleIcon as Maximize2, MinusIcon as Minus, PlusIcon as Plus } from "@phosphor-icons/react/ssr";

export default function WorkspaceZoomControls({
  zoom,
  min = 0.25,
  max = 5,
  onZoomOut,
  onZoomIn,
  onFit,
  outputRef,
}) {
  const percentage = Math.round(zoom * 100);

  return (
    <div className="workspace-zoom" role="toolbar" aria-label="Canvas zoom controls">
      <button
        type="button"
        className="workspace-zoom-button"
        onClick={onZoomOut}
        disabled={zoom <= min}
        aria-label="Zoom out"
        title="Zoom out"
      >
        <Minus size={14} aria-hidden="true" />
      </button>

      <output ref={outputRef} className="workspace-zoom-value" aria-live="polite" aria-label={`Zoom ${percentage} percent`}>
        {percentage}%
      </output>

      <button
        type="button"
        className="workspace-zoom-button"
        onClick={onZoomIn}
        disabled={zoom >= max}
        aria-label="Zoom in"
        title="Zoom in"
      >
        <Plus size={14} aria-hidden="true" />
      </button>

      <span className="workspace-zoom-divider" aria-hidden="true" />

      <button
        type="button"
        className="workspace-zoom-fit"
        onClick={onFit}
        aria-label="Fit artwork to canvas"
        title="Fit artwork to canvas"
      >
        <Maximize2 size={13} aria-hidden="true" />
        <span>Fit</span>
      </button>
    </div>
  );
}
