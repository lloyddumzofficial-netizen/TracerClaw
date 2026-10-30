"use client";

import { PanelRightOpen } from "lucide-react";
import styles from "./image-tool.module.css";

export default function ImageToolSettingsToggle({ title, onOpen }) {
  return (
    <aside className={styles.settingsRail} aria-label="Collapsed settings">
      <button type="button" autoFocus onClick={onOpen} aria-label={`Open ${title}`} title={`Open ${title}`} aria-expanded="false">
        <PanelRightOpen size={18} aria-hidden="true" />
      </button>
    </aside>
  );
}
