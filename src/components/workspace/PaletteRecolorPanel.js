import { Pipette } from "lucide-react";
import { QUICK_COLORS, getReadableTextColor } from "./PalettePreviewModal.utils";

export default function PaletteRecolorPanel({
  editorRef,
  selectedItem,
  hexInput,
  canLivePreview,
  onUpdateSelectedColor,
  onPreviewSelectedColor,
  onCancelLivePreview,
  onSetHexInput,
}) {
  const isValidHex = /^#[0-9a-f]{6}$/i.test(hexInput);
  const colorInputValue = isValidHex ? hexInput : selectedItem?.color || "#ffd700";
  const disabled = !selectedItem;

  return (
    <div className="recolor-panel" ref={editorRef}>

      {/* Header */}
      <div className="recolor-panel-header">
        <Pipette size={12} />
        <span>Recolor Selection</span>
      </div>

      {/* Controls row */}
      <div className="recolor-panel-controls">

        {/* Color swatch / native picker */}
        <label className="recolor-swatch-label" title="Open color picker">
          <input
            type="color"
            value={colorInputValue}
            onInput={(e) => onPreviewSelectedColor?.(e.target.value)}
            onChange={(e) => {
              onSetHexInput(e.target.value);
              onUpdateSelectedColor(e.target.value);
            }}
            disabled={disabled}
          />
          <span
            className="recolor-swatch"
            style={{ backgroundColor: disabled ? "#1a1a1a" : colorInputValue }}
          />
        </label>

        {/* Right column: hex + quick colors */}
        <div className="recolor-panel-right">
          <div className="recolor-hex-row">
            <span className="recolor-hex-prefix">#</span>
            <input
              type="text"
              className="recolor-hex-input"
              value={hexInput.replace(/^#/, "")}
              spellCheck={false}
              placeholder="000000"
              aria-invalid={hexInput.length > 0 && !isValidHex}
              onChange={(e) => {
                const raw = e.target.value.replace(/^#/, "");
                const next = `#${raw}`;
                onSetHexInput(next);
                if (/^#[0-9a-f]{6}$/i.test(next)) onPreviewSelectedColor?.(next);
              }}
              onBlur={() =>
                isValidHex ? onUpdateSelectedColor(hexInput) : onCancelLivePreview?.()
              }
              onKeyDown={(e) => {
                if (e.key === "Enter" && isValidHex) onUpdateSelectedColor(hexInput);
                if (e.key === "Escape") {
                  onCancelLivePreview?.();
                  onSetHexInput(selectedItem?.color || "#ffd700");
                }
              }}
              disabled={disabled}
            />
          </div>

          <div className="recolor-quick-colors" role="group" aria-label="Quick colors">
            {QUICK_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                className="recolor-quick-dot"
                style={{ backgroundColor: color }}
                disabled={disabled}
                aria-label={`Apply ${color}`}
                title={color}
                onMouseEnter={() => onPreviewSelectedColor?.(color)}
                onMouseLeave={() => onCancelLivePreview?.()}
                onFocus={() => onPreviewSelectedColor?.(color)}
                onBlur={() => onCancelLivePreview?.()}
                onClick={() => {
                  onSetHexInput(color);
                  onUpdateSelectedColor(color);
                }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Status bar */}
      <div className="recolor-panel-status">
        {selectedItem ? (
          <>
            <span
              className="recolor-status-dot"
              style={{ backgroundColor: selectedItem.color }}
            />
            <span className="recolor-status-hex">{selectedItem.color.toUpperCase()}</span>
            <span className="recolor-status-sep">·</span>
            <span className="recolor-status-count">
              {selectedItem.count} path{selectedItem.count === 1 ? "" : "s"}
            </span>
            {!canLivePreview && (
              <span className="recolor-status-warn">· live preview off</span>
            )}
          </>
        ) : (
          <span className="recolor-status-empty">Select a color to recolor</span>
        )}
      </div>

    </div>
  );
}
