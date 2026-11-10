"use client";
import { useLayoutEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import styles from "./ArtworkEditor.module.css";
import aiOutlineStyles from "@/components/ui/AiOutlineButton.module.css";
import { selectionBounds } from "./selectionGeometry";

export default function ArtworkInstructionEditor({ instruction, canvasRef, onChange, onClose, onSave, warning }) {
  const input = useRef(null);
  const panel = useRef(null);
  const focused = useRef(false);
  const [placement, setPlacement] = useState(null);
  useLayoutEffect(() => {
    if (placement && !focused.current) { input.current?.focus({ preventScroll: true }); focused.current = true; }
  }, [placement]);
  useLayoutEffect(() => {
    const container = canvasRef.current, node = panel.current;
    const image = container.querySelector('img[alt="Artwork to edit"]');
    const stage = container.querySelector('[data-artwork-viewport]');
    const fit = () => {
      const canvas = container.getBoundingClientRect(), picture = image.getBoundingClientRect(), viewport = stage.getBoundingClientRect();
      const area = selectionBounds(instruction.shapes, image.naturalHeight / image.naturalWidth || 1);
      if (!area) return;
      // Measure selected image coordinates directly. Clip to the viewport so
      // an offscreen portion of a zoomed image cannot obstruct placement.
      const leftEdge = Math.max(viewport.left, picture.left + area.x * picture.width) - canvas.left;
      const rightEdge = Math.min(viewport.right, picture.left + (area.x + area.width) * picture.width) - canvas.left;
      const topEdge = Math.max(viewport.top, picture.top + area.y * picture.height) - canvas.top;
      const bottomEdge = Math.min(viewport.bottom, picture.top + (area.y + area.height) * picture.height) - canvas.top;
      const width = node.offsetWidth, height = node.offsetHeight, padding = 12, gap = 18;
      const clampX = x => Math.max(padding, Math.min(x, container.clientWidth - width - padding));
      const clampY = y => Math.max(padding, Math.min(y, container.clientHeight - height - padding));
      const candidates = [
        { left: rightEdge + gap, top: topEdge }, { left: leftEdge - width - gap, top: topEdge },
        { left: leftEdge, top: bottomEdge + gap }, { left: leftEdge, top: topEdge - height - gap },
      ].map(value => ({ left: clampX(value.left), top: clampY(value.top) }));
      const free = candidates.find(value => value.left >= rightEdge + gap || value.left + width <= leftEdge - gap || value.top >= bottomEdge + gap || value.top + height <= topEdge - gap);
      if (!free && !container.hasAttribute("data-composer-space")) {
        // Reserve room within this canvas; the editor never enters the sidebar.
        container.setAttribute("data-composer-space", "true");
        setPlacement(null);
        return;
      }
      const next = free || { left: clampX(container.clientWidth - width - padding), top: clampY(topEdge) };
      if (!free && next.left < rightEdge + 12) { setPlacement(null); return; }
      next.pointer = next.left >= rightEdge + 12 ? "left" : next.left + width <= leftEdge - 12 ? "right" : next.top >= bottomEdge + 12 ? "top" : "bottom";
      next.pointerX = Math.max(24, Math.min(width - 24, (leftEdge + rightEdge) / 2 - next.left));
      next.pointerY = Math.max(24, Math.min(height - 24, (topEdge + bottomEdge) / 2 - next.top));
      setPlacement(previous => previous?.left === next.left && previous?.top === next.top && previous?.pointer === next.pointer && previous?.pointerX === next.pointerX && previous?.pointerY === next.pointerY ? previous : next);
    };
    fit();
    const observer = new ResizeObserver(fit);
    [container, node, image, stage].forEach(element => observer.observe(element));
    container.addEventListener("scroll", fit, true);
    return () => { observer.disconnect(); container.removeEventListener("scroll", fit, true); };
  }, [canvasRef, instruction.id, instruction.shapes]);
  const suggest = prompt => {
    onChange(prompt);
    requestAnimationFrame(() => {
      input.current?.focus();
      const start = prompt.indexOf("[");
      if (start >= 0) input.current?.setSelectionRange(start, prompt.indexOf("]") + 1);
    });
  };

  return <section ref={panel} className={styles.commentPopover} data-side="floating" data-pointer={placement?.pointer} style={{ left: placement?.left ?? 12, top: placement?.top ?? 12, "--pointer-x": `${placement?.pointerX ?? 24}px`, "--pointer-y": `${placement?.pointerY ?? 24}px`, visibility: placement ? "visible" : "hidden" }} aria-label={`Instruction ${instruction.id} editor`} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); onSave(); } }}>
    <header className={styles.commentHeading}>
      <div><span>Selection {String(instruction.id).padStart(2, "0")}</span><strong>Describe the change</strong></div>
      <button aria-label="Close comment box" onClick={onClose}><X size={15} /></button>
    </header>
    <label className={styles.srOnly} htmlFor="artwork-area-prompt">Area instruction {instruction.id}</label>
    <div className={styles.commentInput}>
      <textarea ref={input} id="artwork-area-prompt" autoFocus maxLength={1000} value={instruction.prompt}
        placeholder="e.g. Make the lettering black. Keep the same shape and position." onChange={event => onChange(event.target.value)}
        data-gramm="false" data-gramm_editor="false" data-enable-grammarly="false" />
      <div className={styles.commentMeta}><span>Selected area only</span><span>{instruction.prompt.length}/1000</span></div>
    </div>
    {!instruction.prompt.trim() && <div className={styles.promptSuggestions} aria-label="Instruction starters">
      <button onClick={() => suggest("Remove the selected text and rebuild the surrounding background.")}>Remove text</button>
      <button onClick={() => suggest("Change the selected artwork colour to [colour]. Keep its shape and position.")}>Change colour</button>
      <button onClick={() => suggest("Replace the selected text with [new text]. Match its style and position.")}>Replace text</button>
    </div>}
    {warning && <p className={styles.selectionWarning} role="note">{warning}</p>}
    <button className={`${styles.primary} ${styles.saveInstruction} ${aiOutlineStyles.outline}`} onClick={onSave}>
      <span className={aiOutlineStyles.label}><Check size={13} />Save instruction</span>
    </button>
  </section>;

}
