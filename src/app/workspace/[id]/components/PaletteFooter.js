import { Download, FolderDown, Loader2, RotateCcw, Save } from "lucide-react";

export default function PaletteFooter({
  hasEdits,
  isApplying,
  isExportingBitmap,
  hasSvgText,
  onDownloadAll,
  onDownloadSvg,
  onDownloadBitmap,
  onResetLayout,
  onResetColors,
  onRequestApply,
}) {
  return (
    <footer className="palette-footer">
      <div className="palette-footer-state">
        <span>{hasEdits ? "Edited palette ready" : "Original SVG"}</span>
        <small>{hasEdits ? "Review changes before applying to workspace." : "Recolor or merge colors before applying."}</small>
      </div>

      <div className="palette-footer-actions">
        <div className="palette-action-group" aria-label="Export options">
          <button type="button" className="palette-action-secondary" onClick={onDownloadAll}>
            <FolderDown size={15} /> All
          </button>
          <button type="button" className="palette-action-secondary" onClick={onDownloadSvg}>
            <Download size={15} /> SVG
          </button>
          <button type="button" className="palette-action-secondary" onClick={onDownloadBitmap} disabled={isExportingBitmap || !hasSvgText}>
            {isExportingBitmap ? <Loader2 className="animate-spin" size={15} /> : <Download size={15} />}
            PNG
          </button>
        </div>

        <div className="palette-action-group" aria-label="Reset options">
          <button type="button" className="palette-action-quiet" onClick={onResetLayout} title="Reset color map layout">
            Layout
          </button>
          <button type="button" className="palette-action-quiet" onClick={onResetColors} disabled={!hasEdits} title="Reset edited colors">
            <RotateCcw size={14} /> Colors
          </button>
        </div>

        <button type="button" className="palette-action-primary" onClick={onRequestApply} disabled={!hasEdits || isApplying}>
          {isApplying ? <Loader2 className="animate-spin" size={15} /> : <Save size={15} />}
          {isApplying ? "Applying..." : "Apply"}
        </button>
      </div>
    </footer>
  );
}
