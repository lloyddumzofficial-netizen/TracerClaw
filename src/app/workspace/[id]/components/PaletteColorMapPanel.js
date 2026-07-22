import { GitCompareArrows, GitMerge, Layers3, Loader2, Pencil, Split } from "lucide-react";
import PaletteRecolorPanel from "./PaletteRecolorPanel";
import {
  DEFAULT_BUBBLE_LAYOUT,
  MAX_CLUSTER_CHILDREN,
  getClusterChildPosition,
} from "./PalettePreviewModal.utils";

export default function PaletteColorMapPanel({
  featured,
  paletteClusters,
  bubbleLayout,
  selectedColor,
  mergeTargetColor,
  dragMergeColor,
  paletteMode,
  hasEdits,
  visiblePalette,
  loading,
  selectedItem,
  hexInput,
  mergeGroups,
  editHistory,
  editorRef,
  largeSvgWarning,
  onStartBubbleDrag,
  onMoveBubble,
  onStopBubbleDrag,
  onMergePaletteColors,
  onSetMergeTargetColor,
  onSetDragMergeColor,
  onSelectColor,
  onSetPaletteMode,
  onCompare,
  onSplitSelectedColor,
  onFocusRecolorControls,
  onUpdateSelectedColor,
  onSetHexInput,
}) {
  return (
    <aside className="palette-side">
      <div className="palette-side-head">
        <div>
          <span>Color Map</span>
          <small>{paletteMode === "merge" ? "Merge mode: drag one swatch onto another color." : "Inspect colors, arrange bubbles, then edit or merge."}</small>
        </div>
        <strong>{hasEdits ? "Edited" : "Original"}</strong>
      </div>

      <div className="palette-clusters" aria-label="Detected color clusters">
        {featured.map((item, index) => {
          const clusterMembers = paletteClusters[index] || [item];
          const visualChildren = clusterMembers
            .slice(1)
            .map(child => ({ color: child.color, count: child.count }))
            .slice(0, MAX_CLUSTER_CHILDREN);
          const hiddenChildren = Math.max(0, clusterMembers.length - 1 - visualChildren.length);

          return (
            <div
              key={item.color}
              className={`palette-cluster palette-cluster-${index}${item.color === selectedColor ? " active" : ""}${item.color === mergeTargetColor ? " merge-target" : ""}`}
              style={{
                backgroundColor: item.color,
                width: `${bubbleLayout[index]?.size || DEFAULT_BUBBLE_LAYOUT[index].size}px`,
                height: `${bubbleLayout[index]?.size || DEFAULT_BUBBLE_LAYOUT[index].size}px`,
                left: `${bubbleLayout[index]?.x ?? DEFAULT_BUBBLE_LAYOUT[index].x}%`,
                top: `${bubbleLayout[index]?.y ?? DEFAULT_BUBBLE_LAYOUT[index].y}%`,
              }}
              onPointerDown={(event) => onStartBubbleDrag(event, index)}
              onPointerMove={(event) => onMoveBubble(event, index)}
              onPointerUp={(event) => onStopBubbleDrag(event, index)}
              onPointerCancel={(event) => onStopBubbleDrag(event, index)}
              onDragOver={(event) => {
                if (paletteMode !== "merge") return;
                if (!dragMergeColor || dragMergeColor === item.color) return;
                event.preventDefault();
                onSetMergeTargetColor(item.color);
              }}
              onDragLeave={() => {
                if (mergeTargetColor === item.color) onSetMergeTargetColor(null);
              }}
              onDrop={(event) => {
                if (paletteMode !== "merge") return;
                event.preventDefault();
                onMergePaletteColors(dragMergeColor || event.dataTransfer.getData("text/plain"), item.color);
                onSetDragMergeColor(null);
                onSetMergeTargetColor(null);
              }}
              onClick={() => onSelectColor(item.color)}
              title={`${item.color} · ${item.count} paths`}
            >
              <span className="palette-cluster-index">{index + 1}</span>
              <span className="palette-cluster-count">{item.count}</span>
              {visualChildren.map((child, childIndex) => {
                const pos = getClusterChildPosition(childIndex);
                return (
                  <button
                    key={`${item.color}-${child.color}`}
                    type="button"
                    className={`palette-cluster-child${child.color === selectedColor ? " active" : ""}`}
                    style={{
                      backgroundColor: child.color,
                      left: `${pos.left}%`,
                      top: `${pos.top}%`,
                    }}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelectColor(child.color);
                    }}
                    title={`${child.color} · ${child.count} paths`}
                  />
                );
              })}
              {hiddenChildren > 0 && <span className="palette-cluster-more">+{hiddenChildren}</span>}
            </div>
          );
        })}
      </div>

      <div className="palette-tools">
        <button onClick={onCompare}><GitCompareArrows size={18} /> <span>Compare</span></button>
        <button className={paletteMode === "merge" ? "active" : ""} onClick={() => onSetPaletteMode(paletteMode === "merge" ? "select" : "merge")}><GitMerge size={18} /> <span>Merge</span></button>
        <button onClick={onSplitSelectedColor} disabled={Object.keys(mergeGroups).length === 0 && editHistory.length === 0}><Split size={18} /> <span>Undo</span></button>
        <button onClick={onFocusRecolorControls}><Pencil size={18} /> <span>Edit</span></button>
      </div>

      <div className="palette-list">
        <div className="palette-list-title">
          <Layers3 size={14} />
          <span>Detected Palette</span>
          <small>{visiblePalette.length} SVG colors. Select a color to inspect, or drag in Merge mode.</small>
        </div>

        {largeSvgWarning && (
          <div className="palette-scale-warning">
            <strong>Large SVG detected</strong>
            <span>{largeSvgWarning}</span>
          </div>
        )}

        {loading ? (
          <div className="palette-loading"><Loader2 size={16} className="animate-spin" /> Detecting colors</div>
        ) : (
          <>
            <div className="palette-swatch-grid palette-swatch-grid-priority">
              {visiblePalette.map((item, index) => (
                <button
                  key={item.color}
                  className={[
                    item.color === selectedColor ? "active" : "",
                    item.color === dragMergeColor ? "merge-source" : "",
                    item.color === mergeTargetColor ? "merge-target" : "",
                  ].filter(Boolean).join(" ")}
                  draggable={paletteMode === "merge"}
                  onDragStart={(event) => {
                    if (paletteMode !== "merge") {
                      event.preventDefault();
                      return;
                    }
                    event.dataTransfer.setData("text/plain", item.color);
                    event.dataTransfer.effectAllowed = "move";
                    onSetDragMergeColor(item.color);
                    onSelectColor(item.color);
                  }}
                  onDragEnd={() => {
                    onSetDragMergeColor(null);
                    onSetMergeTargetColor(null);
                  }}
                  onDragOver={(event) => {
                    if (paletteMode !== "merge") return;
                    if (!dragMergeColor || dragMergeColor === item.color) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    onSetMergeTargetColor(item.color);
                  }}
                  onDragLeave={() => {
                    if (mergeTargetColor === item.color) onSetMergeTargetColor(null);
                  }}
                  onDrop={(event) => {
                    if (paletteMode !== "merge") return;
                    event.preventDefault();
                    onMergePaletteColors(dragMergeColor || event.dataTransfer.getData("text/plain"), item.color);
                    onSetDragMergeColor(null);
                    onSetMergeTargetColor(null);
                  }}
                  onClick={() => onSelectColor(item.color)}
                  title={`${item.color} · ${item.count} paths`}
                >
                  <span style={{ backgroundColor: item.color }}>{index + 1}</span>
                </button>
              ))}
            </div>

            <PaletteRecolorPanel
              editorRef={editorRef}
              selectedItem={selectedItem}
              hexInput={hexInput}
              onUpdateSelectedColor={onUpdateSelectedColor}
              onSetHexInput={onSetHexInput}
            />
          </>
        )}
      </div>
    </aside>
  );
}
