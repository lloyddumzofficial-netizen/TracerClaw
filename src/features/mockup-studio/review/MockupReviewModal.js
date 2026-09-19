"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./mockupReview.module.css";

function getSourceAsset(shotKey, assets) {
  if (shotKey === "back") return assets.back;
  if (shotKey === "sleeve" || shotKey === "detail") return assets.left_sleeve || assets.left_cuff;
  return assets.front;
}

export default function MockupReviewModal({
  open, outputs, shots, projectName, garmentLabel, assets,
  busyAction, retryUsed, onClose, onDownloadAll, onExportBoard, onRetryView,
}) {
  const available = useMemo(() => shots.map(shot => ({ ...shot, output: outputs.find(item => item.view_type === shot.key) })).filter(item => item.output), [outputs, shots]);
  const [selectedKey, setSelectedKey] = useState("hero");
  const [mode, setMode] = useState("compare");
  const selectedIndex = Math.max(0, available.findIndex(item => item.key === selectedKey));
  const selected = available[selectedIndex] || available[0];
  const sourceAsset = selected ? getSourceAsset(selected.key, assets) : null;

  useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = event => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight" && available.length) setSelectedKey(available[(selectedIndex + 1) % available.length].key);
      if (event.key === "ArrowLeft" && available.length) setSelectedKey(available[(selectedIndex - 1 + available.length) % available.length].key);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [available, onClose, open, selectedIndex]);

  useEffect(() => {
    if (open && available.length && !available.some(item => item.key === selectedKey)) setSelectedKey(available[0].key);
  }, [available, open, selectedKey]);

  useEffect(() => {
    if (open) setMode("compare");
  }, [open]);

  if (!open || !selected) return null;

  return (
    <div className={styles.backdrop} role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <section className={styles.dialog} role="dialog" aria-modal="true" aria-label={`${projectName} campaign review`}>
        <header className={styles.header}>
          <div><span>CAMPAIGN REVIEW</span><strong>{projectName}</strong><small>{garmentLabel} · Five-view presentation</small></div>
          <div className={styles.headerActions}>
            <div className={styles.modeSwitch} aria-label="Review display mode"><button type="button" className={mode === "review" ? styles.active : ""} onClick={() => setMode("review")}>Review</button><button type="button" className={mode === "compare" ? styles.active : ""} onClick={() => setMode("compare")}>Compare source</button></div>
            <button type="button" className={styles.closeButton} onClick={onClose}>Close</button>
          </div>
        </header>

        <div className={styles.content}>
          <nav className={styles.thumbnails} aria-label="Campaign views">{available.map((item, index) => <button type="button" key={item.key} className={selected.key === item.key ? styles.thumbnailActive : ""} onClick={() => setSelectedKey(item.key)}><img src={item.output.file_url} alt="" /><span>{String(index + 1).padStart(2, "0")}</span><strong>{item.label}</strong></button>)}</nav>
          {mode === "review" ? (
            <figure className={styles.hero}><img src={selected.output.file_url} alt={`${selected.label} generated mockup`} /><figcaption><div><span>{selected.label}</span><p>{selected.description}</p></div><a href={selected.output.file_url} target="_blank" rel="noreferrer">Open original</a></figcaption></figure>
          ) : (
            <div className={styles.comparison}>
              <figure><div>{sourceAsset ? <img src={sourceAsset.file_url} alt={`${selected.label} source artwork`} /> : <span>Source panel unavailable</span>}</div><figcaption>Production artwork</figcaption></figure>
              <figure><div><img src={selected.output.file_url} alt={`${selected.label} generated mockup`} /></div><figcaption>Generated campaign view</figcaption></figure>
            </div>
          )}
          <aside className={styles.summary}><span>SELECTED VIEW</span><h2>{selected.label}</h2><p>{selected.description}</p><dl><div><dt>Garment</dt><dd>{garmentLabel}</dd></div><div><dt>Output</dt><dd>1K PNG</dd></div><div><dt>Views</dt><dd>{outputs.length}/{shots.length}</dd></div></dl><div className={styles.correctionAction}><strong>One-view correction</strong><p>Retry only this angle. The other four approved views stay untouched.</p><button type="button" onClick={() => onRetryView(selected.key)} disabled={Boolean(busyAction) || retryUsed}>{busyAction === "retry" ? "Restarting view…" : retryUsed ? "Correction used" : `Retry ${selected.label}`}</button></div><div className={styles.exportActions}><button type="button" onClick={onExportBoard} disabled={Boolean(busyAction)}>{busyAction === "board" ? "Building board…" : "Campaign board PNG"}</button><button type="button" onClick={onDownloadAll} disabled={Boolean(busyAction)}>{busyAction === "zip" ? "Preparing ZIP…" : "Download all views"}</button></div><small>Exports reuse the finished images. No additional AI generation or Claws.</small></aside>
        </div>
      </section>
    </div>
  );
}
