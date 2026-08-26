"use client";

import { memo } from "react";
import { Keyboard, Mouse, Move, RotateCcw, Scan, X } from "lucide-react";
import styles from "./ShortcutsModal.module.css";

const SHORTCUTS = [
  {
    label: "Pan canvas",
    description: "Move around the workspace",
    keys: ["Space", "+", "Drag"],
    icon: Move,
  },
  {
    label: "Fit to screen",
    description: "Frame the complete artwork",
    keys: ["F"],
    icon: Scan,
  },
  {
    label: "Reset view",
    description: "Return to actual size (1:1)",
    keys: ["Esc"],
    icon: RotateCcw,
  },
  {
    label: "Zoom in / out",
    description: "Adjust the canvas scale",
    keys: ["Mouse wheel"],
    icon: Mouse,
  },
];

const ShortcutsModal = memo(function ShortcutsModal({ show, onClose }) {
  if (!show) return null;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <section
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.header}>
          <div className={styles.headingGroup}>
            <span className={styles.iconBox} aria-hidden="true">
              <Keyboard size={16} />
            </span>
            <div>
              <h2 id="shortcuts-title" className={styles.title}>Keyboard shortcuts</h2>
              <p className={styles.subtitle}>Quick canvas navigation</p>
            </div>
          </div>
          <button className={styles.closeButton} onClick={onClose} aria-label="Close keyboard shortcuts">
            <X size={16} />
          </button>
        </header>

        <div className={styles.body}>
          <div className={styles.sectionLabel}>Canvas controls</div>
          <div className={styles.shortcutList}>
            {SHORTCUTS.map(({ label, description, keys, icon: Icon }) => (
              <div className={styles.shortcutRow} key={label}>
                <span className={styles.shortcutIcon} aria-hidden="true">
                  <Icon size={15} />
                </span>
                <div className={styles.shortcutCopy}>
                  <span className={styles.shortcutLabel}>{label}</span>
                  <span className={styles.shortcutDescription}>{description}</span>
                </div>
                <div className={styles.keyGroup} aria-label={keys.join(" ")}>
                  {keys.map((key, index) => key === "+" ? (
                    <span className={styles.keyJoiner} key={`${key}-${index}`} aria-hidden="true">+</span>
                  ) : (
                    <kbd className={styles.keycap} key={key}>{key}</kbd>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <footer className={styles.footer}>
          <span className={styles.footerNote}>Shortcuts work while the canvas is active.</span>
          <button className={styles.doneButton} onClick={onClose}>Done</button>
        </footer>
      </section>
    </div>
  );
});

export default ShortcutsModal;
