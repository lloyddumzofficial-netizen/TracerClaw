"use client";
import { useEffect, useRef } from "react";
const editingText = target => target instanceof Element && Boolean(target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]'));
export default function useEditorShortcuts(actions) {
  const current = useRef(actions);
  useEffect(() => { current.current = actions; });
  useEffect(() => {
    const handle = event => {
      if (event.isComposing || event.altKey) return;
      const key = event.key.toLowerCase(), mod = event.ctrlKey || event.metaKey;
      const commands = current.current;
      if (mod && key === "s") { event.preventDefault(); if (!event.repeat && commands.canEdit) commands.save(); return; }
      if (key === "escape") { event.preventDefault(); commands.escape(); return; }
      if (editingText(event.target)) return;
      if (mod && (key === "z" || key === "y")) { event.preventDefault(); if (commands.canEdit) commands.travel(key === "y" || event.shiftKey ? "redo" : "undo"); return; }
      if (mod) return;
      if (key === "f") { event.preventDefault(); if (event.shiftKey || !commands.hasSelection) commands.fit(); else commands.focus(); }
      else if ((key === "delete" || key === "backspace") && commands.canDelete) { event.preventDefault(); if (commands.canEdit) commands.remove(); }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, []);
}
