import { GitCompareArrows, GitMerge, Layers3, Loader2, Pencil, Redo2, Search, Undo2, X } from "lucide-react";
import PaletteRecolorPanel from "./PaletteRecolorPanel";
import {
  DEFAULT_BUBBLE_LAYOUT,
  MAX_CLUSTER_CHILDREN,
  PALETTE_SORTS,
  formatCount,
  getClusterChildPosition,
  getReadableTextColor,
} from "./PalettePreviewModal.utils";

export default function PaletteColorMapPanel({
  featured,
  paletteClusters,
  bubbleLayout,
  childBubbleLayout,
  selectedColor,
  mergeTargetColor,
  dragMergeColor,
  paletteMode,
  hasEdits,
  visiblePalette,
  displayPalette,
  paletteQuery,
  paletteSort,
  onSetPaletteQuery,
  onSetPaletteSort,
  loading,
  selectedItem,
  hexInput,
  mergeGroups,
  canUndo,
  canRedo,
  canLivePreview,
  onRedo,
  onPreviewSelectedColor,
  onCancelLivePreview,
  editorRef,
  largeSvgWarning,
  onStartBubbleDrag,
  onMoveBubble,
  onStopBubbleDrag,
  onStartChildBubbleDrag,
  onMoveChildBubble,
  onStopChildBubbleDrag,
  onMergePaletteColors,
  onSetMergeTargetColor,
  onSetDragMergeColor,
  onSelectColor,
  onSetPaletteMode,
  onCompare,
  onUndo,
  onFocusRecolorControls,
  onUpdateSelectedColor,
  onSetHexInput,
}) {
  // DEFAULT_BUBBLE_LAYOUT only defines the five featured slots. Fall back to the
  // last slot rather than indexing past the end if that count ever changes.
  const layoutFor = (index) => (
    bubbleLayout?.[index]
    || DEFAULT_BUBBLE_LAYOUT[index]
    || DEFAULT_BUBBLE_LAYOUT[DEFAULT_BUBBLE_LAYOUT.length - 1]
  );

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
          const mergedChildren = (mergeGroups[item.color] || [])
            .map(child => (
              typeof child === "string"
                ? { color: child, count: 0, isMerged: true }
                : { color: child?.color, count: child?.count || 0, isMerged: true }
            ))
            .filter(child => child.color);
          const relatedChildren = clusterMembers
            .slice(1)
            .map(child => ({ color: child.color, count: child.count }))
            .filter(child => !mergedChildren.some(merged => merged.color === child.color))
            .slice(0, MAX_CLUSTER_CHILDREN);
          const visualChildren = [...mergedChildren, ...relatedChildren].slice(0, MAX_CLUSTER_CHILDREN);
          const hiddenChildren = Math.max(0, mergedChildren.length + clusterMembers.length - 1 - visualChildren.length);

          return (
            <div
              key={item.color}
              className={`palette-cluster palette-cluster-${index}${item.color === selectedColor ? " active" : ""}${item.color === mergeTargetColor ? " merge-target" : ""}`}
              style={{
                backgroundColor: item.color,
                width: `${layoutFor(index).size}px`,
                height: `${layoutFor(index).size}px`,
                left: `${layoutFor(index).x}%`,
                top: `${layoutFor(index).y}%`,
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
              data-cluster-color={item.color}
            >
              <span className="palette-cluster-index">{index + 1}</span>
              <span className="palette-cluster-count">{item.count}</span>
              {visualChildren.map((child, childIndex) => {
                const pos = getClusterChildPosition(childIndex);
                const childKey = `${item.color}:${child.color}`;
                const childPosition = childBubbleLayout[childKey] || pos;
                return (
                  <button
                    key={`${item.color}-${child.color}-${childIndex}`}
                    type="button"
                    className={`palette-cluster-child${child.color === selectedColor ? " active" : ""}${child.isMerged ? " is-merged" : ""}`}
                    style={{
                      backgroundColor: child.color,
                      left: `${childPosition.left}%`,
                      top: `${childPosition.top}%`,
                    }}
                    onPointerDown={(event) => onStartChildBubbleDrag(event, childKey, childPosition)}
                    onPointerMove={(event) => onMoveChildBubble(event, childKey)}
                    onPointerUp={(event) => onStopChildBubbleDrag(event, childKey)}
                    onPointerCancel={(event) => onStopChildBubbleDrag(event, childKey)}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelectColor(child.color, item.color);
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
        <button onClick={onCompare} title="Compare against the original"><GitCompareArrows size={18} /> <span>Compare</span></button>
        <button
          className={paletteMode === "merge" ? "active" : ""}
          onClick={() => onSetPaletteMode(paletteMode === "merge" ? "select" : "merge")}
          aria-pressed={paletteMode === "merge"}
          title="Drag one swatch onto another to merge them"
        >
          <GitMerge size={18} /> <span>Merge</span>
        </button>
        <button onClick={onUndo} disabled={!canUndo} title="Undo (Ctrl+Z)"><Undo2 size={18} /> <span>Undo</span></button>
        <button onClick={onRedo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)"><Redo2 size={18} /> <span>Redo</span></button>
        <button onClick={onFocusRecolorControls} title="Jump to the recolor controls"><Pencil size={18} /> <span>Edit</span></button>
      </div>

      <div className="palette-list">
        <div className="palette-list-title">
          <Layers3 size={14} />
          <span>Detected Palette</span>
          <small>
            {paletteQuery
              ? `${displayPalette.length} of ${visiblePalette.length} colors match "${paletteQuery}".`
              : `${visiblePalette.length} SVG colors. Select a color to inspect, or drag in Merge mode.`}
          </small>
        </div>

        <div className="palette-filters">
          <div className="palette-search">
            <Search size={13} aria-hidden="true" />
            <input
              type="text"
              value={paletteQuery}
              onChange={(event) => onSetPaletteQuery(event.target.value)}
              placeholder="Search hex, e.g. 1a1 or #ff0000"
              aria-label="Search palette colors by hex"
              spellCheck={false}
            />
            {paletteQuery && (
              <button
                type="button"
                className="palette-search-clear"
                onClick={() => onSetPaletteQuery("")}
                aria-label="Clear color search"
              >
                <X size={12} />
              </button>
            )}
          </div>
          <div className="palette-sort" role="group" aria-label="Sort palette">
            {PALETTE_SORTS.map(option => (
              <button
                key={option.id}
                type="button"
                className={paletteSort === option.id ? "active" : ""}
                onClick={() => onSetPaletteSort(option.id)}
                aria-pressed={paletteSort === option.id}
              >
                {option.label}
              </button>
            ))}
          </div>
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
            {displayPalette.length === 0 ? (
              <div className="palette-empty">
                <strong>No colors match “{paletteQuery}”.</strong>
                <button type="button" onClick={() => onSetPaletteQuery("")}>Clear search</button>
              </div>
            ) : (
            <div className="palette-swatch-grid palette-swatch-grid-priority">
              {displayPalette.map((item) => (
                <button
                  key={item.color}
                  className={[
                    item.color === selectedColor ? "active" : "",
                    item.color === dragMergeColor ? "merge-source" : "",
                    item.color === mergeTargetColor ? "merge-target" : "",
                  ].filter(Boolean).join(" ")}
                  aria-label={`${item.color}, used by ${item.count} path${item.count === 1 ? "" : "s"}`}
                  aria-pressed={item.color === selectedColor}
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
                  title={`${item.color} · ${item.count} path${item.count === 1 ? "" : "s"}`}
                >
                  <span
                    style={{ backgroundColor: item.color, color: getReadableTextColor(item.color) }}
                    data-len={formatCount(item.count).length}
                  >
                    {formatCount(item.count)}
                  </span>
                </button>
              ))}
            </div>
            )}

            <PaletteRecolorPanel
              editorRef={editorRef}
              selectedItem={selectedItem}
              hexInput={hexInput}
              canLivePreview={canLivePreview}
              onUpdateSelectedColor={onUpdateSelectedColor}
              onPreviewSelectedColor={onPreviewSelectedColor}
              onCancelLivePreview={onCancelLivePreview}
              onSetHexInput={onSetHexInput}
            />
          </>
        )}
      </div>
    </aside>
  );
}
