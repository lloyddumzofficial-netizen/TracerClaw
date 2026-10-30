"use client";

import { useCallback, useRef, useState } from "react";

export default function useSettingsPanel() {
  const [settingsOpen, setSettingsOpen] = useState(true);
  const closeButtonRef = useRef(null);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const openSettings = useCallback(() => {
    setSettingsOpen(true);
    requestAnimationFrame(() => closeButtonRef.current?.focus());
  }, []);
  return { settingsOpen, closeSettings, openSettings, closeButtonRef };
}
