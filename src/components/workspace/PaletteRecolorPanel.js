import { SlidersHorizontal } from "lucide-react";
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
    <div className="palette-editor" ref={editorRef}>
      <div className="palette-editor-title">
        <SlidersHorizontal size={14} />
        <span>Recolor Selection</span>
      </div>
      <label>
        <span>Picker</span>
        <input
          type="color"
          value={colorInputValue}
          // Repaint the canvas as the picker moves, then commit once on release.
          onInput={(event) => onPreviewSelectedColor?.(event.target.value)}
          onChange={(event) => {
            onSetHexInput(event.target.value);
            onUpdateSelectedColor(event.target.value);
          }}
          disabled={disabled}
        />
      </label>
      <label>
        <span>HEX</span>
        <input
          type="text"
          value={hexInput}
          spellCheck={false}
          aria-invalid={hexInput.length > 0 && !isValidHex}
          onChange={(event) => {
            const next = event.target.value;
            onSetHexInput(next);
            if (/^#[0-9a-f]{6}$/i.test(next)) onPreviewSelectedColor?.(next);
          }}
          onBlur={() => (isValidHex ? onUpdateSelectedColor(hexInput) : onCancelLivePreview?.())}
          onKeyDown={(event) => {
            if (event.key === "Enter" && isValidHex) onUpdateSelectedColor(hexInput);
            if (event.key === "Escape") {
              onCancelLivePreview?.();
              onSetHexInput(selectedItem?.color || "#ffd700");
            }
          }}
          disabled={disabled}
        />
      </label>

      <div className="palette-quick-colors" role="group" aria-label="Quick colors">
        {QUICK_COLORS.map(color => (
          <button
            key={color}
            type="button"
            style={{ backgroundColor: color, color: getReadableTextColor(color) }}
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

      <small>
        {selectedItem
          ? `Selected: ${selectedItem.color} · ${selectedItem.count} SVG path${selectedItem.count === 1 ? "" : "s"}`
          : "Generate SVG first"}
        {selectedItem && !canLivePreview && " · live preview off for large files"}
      </small>
    </div>
  );
}
