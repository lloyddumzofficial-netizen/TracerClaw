"use client";

import { memo } from "react";
import { Keyboard, X } from "lucide-react";

const SHORTCUTS = [
  { label: "Pan Canvas", key: "Hold Space + Drag" },
  { label: "Fit to Screen", key: "F" },
  { label: "Reset View (1:1)", key: "Esc" },
  { label: "Zoom In / Out", key: "Mouse Wheel" },
];

const ShortcutsModal = memo(function ShortcutsModal({ show, onClose }) {
  if (!show) return null;
  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 100000 }}>
      <div className="modal-content" style={{ maxWidth: "400px", background: "#262626", border: "1px solid #444", borderRadius: "0" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
          <h2 style={{ margin: 0, fontSize: "18px", display: "flex", alignItems: "center", gap: "8px" }}>
            <Keyboard size={20} color="#FFD700" /> Keyboard Shortcuts
          </h2>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: "#888", cursor: "pointer" }}><X size={20} /></button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {SHORTCUTS.map(({ label, key }) => (
            <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ color: "#aaa", fontSize: "14px" }}>{label}</span>
              <span style={{ background: "#1a1a1a", border: "1px solid #333", color: "var(--accent)", padding: "4px 8px", fontSize: "12px", fontWeight: "bold" }}>{key}</span>
            </div>
          ))}
        </div>
        <div style={{ marginTop: "32px", textAlign: "center" }}>
          <button
            onClick={onClose}
            style={{ width: "100%", padding: "12px", background: "var(--accent)", color: "#000", border: "none", fontSize: "14px", fontWeight: "bold", cursor: "pointer" }}
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
});

export default ShortcutsModal;
