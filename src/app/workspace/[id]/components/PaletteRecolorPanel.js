import { SlidersHorizontal } from "lucide-react";
import { QUICK_COLORS } from "./PalettePreviewModal.utils";

export default function PaletteRecolorPanel({
  editorRef,
  selectedItem,
  hexInput,
  onUpdateSelectedColor,
  onSetHexInput,
}) {
  const colorInputValue = /^#[0-9a-f]{6}$/i.test(hexInput)
    ? hexInput
    : selectedItem?.color || "#ffd700";

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
          onChange={(event) => onSetHexInput(event.target.value)}
          onBlur={(event) => onUpdateSelectedColor(event.target.value)}
          disabled={!selectedItem}
        />
      </label>
      <label>
        <span>HEX</span>
        <input
          type="text"
          value={hexInput}
          onChange={(event) => onSetHexInput(event.target.value)}
          onBlur={() => onUpdateSelectedColor(hexInput)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onUpdateSelectedColor(hexInput);
          }}
          disabled={!selectedItem}
        />
      </label>
      <small>{selectedItem ? `Selected: ${selectedItem.color} · ${selectedItem.count} SVG paths` : "Generate SVG first"}</small>
      <div className="palette-quick-colors">
        {QUICK_COLORS.map(color => (
          <button
            key={color}
            type="button"
            style={{ backgroundColor: color }}
            onClick={() => onUpdateSelectedColor(color)}
            title={`Apply ${color}`}
            disabled={!selectedItem}
          />
        ))}
      </div>
    </div>
  );
}
