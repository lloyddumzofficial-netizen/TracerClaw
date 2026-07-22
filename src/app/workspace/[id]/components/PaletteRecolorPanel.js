import { SlidersHorizontal } from "lucide-react";
import { QUICK_COLORS } from "./PalettePreviewModal.utils";

export default function PaletteRecolorPanel({
  editorRef,
  selectedItem,
  closestOriginal,
  hexInput,
  onUpdateSelectedColor,
  onSetHexInput,
  onRestoreSelectedColor,
}) {
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
          value={selectedItem?.color || "#ffd700"}
          onChange={(event) => onUpdateSelectedColor(event.target.value)}
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
      <button type="button" onClick={onRestoreSelectedColor} disabled={!selectedItem || !closestOriginal}>
        Restore Selected
      </button>
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
