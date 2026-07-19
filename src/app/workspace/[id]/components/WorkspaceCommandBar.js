"use client";

import { memo } from "react";
import { Columns2, Download, Eraser, FolderDown, ImageDown, ImageMinus, Scissors } from "lucide-react";

const WorkspaceCommandBar = memo(function WorkspaceCommandBar({
  activeTool,
  isBusy,
  hasProject,
  hasRaster,
  hasSvg,
  hasUpscaled,
  onSelectTool,
  onOpenCrop,
  onOpenErase,
  onOpenRemoveBg,
  onOpenCompare,
  onDownloadSvg,
  onDownloadPng,
  onDownloadZip,
}) {
  const openTool = (tool, handler) => {
    onSelectTool?.(tool);
    handler?.();
  };

  return (
    <div className="workspace-command-bar">
      <div className="workspace-command-group">
        <span className="workspace-command-label">Edit</span>
        <button
          className={`workspace-command-btn is-accent ${activeTool === "crop" ? "is-active" : ""}`}
          onClick={() => openTool("crop", onOpenCrop)}
          disabled={!hasProject || isBusy}
          title="Crop pattern region"
        >
          <Scissors size={14} />
          Crop
        </button>
        <button
          className={`workspace-command-btn ${activeTool === "erase" ? "is-active" : ""}`}
          onClick={() => openTool("erase", onOpenErase)}
          disabled={!hasProject || isBusy}
          title="Erase noise manually"
        >
          <Eraser size={14} />
          Erase
        </button>
        <button
          className={`workspace-command-btn ${activeTool === "remove-bg" ? "is-active" : ""}`}
          onClick={() => openTool("remove-bg", onOpenRemoveBg)}
          disabled={!hasProject || isBusy}
          title="Remove background"
        >
          <ImageMinus size={14} />
          Remove BG
        </button>
      </div>

      <div className="workspace-command-divider" />

      <div className="workspace-command-group">
        <span className="workspace-command-label">View</span>
        <button
          className="workspace-command-btn"
          onClick={onOpenCompare}
          disabled={!hasSvg}
          title="Compare before and after"
        >
          <Columns2 size={14} />
          Compare
        </button>
      </div>

      <div className="workspace-command-spacer" />

      <div className="workspace-command-group">
        <span className="workspace-command-label">Export</span>
        <button
          className="workspace-command-btn is-primary"
          onClick={onDownloadSvg}
          disabled={!hasSvg}
          title="Export vector SVG"
        >
          <Download size={14} />
          SVG
        </button>
        <button
          className="workspace-command-btn"
          onClick={onDownloadPng}
          disabled={!hasUpscaled}
          title="Export high-resolution PNG"
        >
          <ImageDown size={14} />
          PNG
        </button>
        <button
          className="workspace-command-btn"
          onClick={onDownloadZip}
          disabled={!hasRaster && !hasSvg}
          title="Download all project files"
        >
          <FolderDown size={14} />
          ZIP
        </button>
      </div>
    </div>
  );
});

export default WorkspaceCommandBar;
