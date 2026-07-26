"use client";

import { memo } from "react";
import { Columns2, Eraser, ImageMinus, Palette, Scissors } from "lucide-react";

const WorkspaceCommandBar = memo(function WorkspaceCommandBar({
  activeTool,
  isBusy,
  hasProject,
  hasSvg,
  onSelectTool,
  onOpenCrop,
  onOpenErase,
  onOpenRemoveBg,
  onOpenCompare,
  onOpenPalettePreview,
}) {
  const openTool = (tool, handler) => {
    onSelectTool?.(tool);
    handler?.();
  };

  return (
    <div className="workspace-command-bar">
      <div className="workspace-command-group">
        <span className="workspace-command-label">Edit</span>
        <div className="workspace-command-btns">
        <button
          className={`workspace-command-btn is-accent ${activeTool === "crop" ? "is-active" : ""}`}
          onClick={() => openTool("crop", onOpenCrop)}
          disabled={!hasProject || isBusy}
          title="Crop pattern region"
        >
          <Scissors size={13} />
          Crop
        </button>
        <button
          className={`workspace-command-btn ${activeTool === "erase" ? "is-active" : ""}`}
          onClick={() => openTool("erase", onOpenErase)}
          disabled={!hasProject || isBusy}
          title="Erase noise manually"
        >
          <Eraser size={13} />
          Erase
        </button>
        <button
          className={`workspace-command-btn ${activeTool === "remove-bg" ? "is-active" : ""}`}
          onClick={() => openTool("remove-bg", onOpenRemoveBg)}
          disabled={!hasProject || isBusy}
          title="Remove background"
        >
          <ImageMinus size={13} />
          Remove BG
        </button>
        </div>
      </div>

      <div className="workspace-command-group">
        <span className="workspace-command-label">View</span>
        <div className="workspace-command-btns">
        <button
          className="workspace-command-btn"
          onClick={onOpenCompare}
          disabled={!hasSvg}
          title="Compare before and after"
        >
          <Columns2 size={13} />
          Compare
        </button>
        <button
          className="workspace-command-btn"
          onClick={onOpenPalettePreview}
          disabled={!hasSvg}
          title="Open Palette Studio"
        >
          <Palette size={13} />
          Palette
        </button>
        </div>
      </div>

      <div className="workspace-command-spacer" />
    </div>
  );
});

export default WorkspaceCommandBar;
