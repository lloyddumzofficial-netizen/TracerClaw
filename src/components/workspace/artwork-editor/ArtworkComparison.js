"use client";
import { useId, useLayoutEffect, useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import styles from "./ArtworkEditor.module.css";

export default function ArtworkComparison({ result, compare }) {
  const overlay = useRef(null);
  const line = useRef(null);
  const slider = useRef(null);
  const position = useRef(50);
  const frame = useRef(0);
  const hintId = useId();

  useLayoutEffect(() => {
    overlay.current.style.clipPath = compare ? `inset(0 0 0 ${position.current}%)` : "none";
    return () => { cancelAnimationFrame(frame.current); frame.current = 0; };
  }, [compare]);

  const move = event => {
    position.current = Number(event.currentTarget.value);
    if (frame.current) return;
    // Match the garment comparison's one-paint-per-frame interaction without
    // rerendering the editor, selections, or saved instruction list on drag.
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      overlay.current.style.clipPath = `inset(0 0 0 ${position.current}%)`;
      line.current.style.left = `${position.current}%`;
      slider.current.setAttribute("aria-valuetext", `${position.current}% Before, ${100 - position.current}% After`);
    });
  };

  return <>
    <img ref={overlay} className={styles.result} src={`/api/proxy?url=${encodeURIComponent(result)}`} alt="Edited artwork preview" draggable="false" style={{ clipPath: compare ? "inset(0 0 0 50%)" : "none" }} />
    {compare && <>
      <span id={hintId} className={styles.srOnly}>Drag across the artwork or use the arrow keys to compare. Before is on the left; After is on the right.</span>
      <input ref={slider} className={styles.compareRange} aria-label="Compare original and edited artwork" aria-describedby={hintId} aria-valuetext={`${position.current}% Before, ${100 - position.current}% After`} type="range" min="0" max="100" step="1" defaultValue={position.current} onChange={move} />
      <div ref={line} className={styles.compareDivider} style={{ left: `${position.current}%` }} aria-hidden="true"><span><ChevronLeft size={11} /><ChevronRight size={11} /></span></div>
      <span className={`${styles.compareLabel} ${styles.compareBefore}`} aria-hidden="true">Before · Original</span>
      <span className={`${styles.compareLabel} ${styles.compareAfter}`} aria-hidden="true">After · Edited</span>
    </>}
  </>;
}
