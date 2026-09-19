"use client";

import { useEffect, useMemo, useState } from "react";
import { MOCKUP_PARTS, MOCKUP_RENDER_COST } from "../config";
import { getGarmentParts } from "../garmentCatalog";
import { buildMockupQualityChecks } from "./qualityChecks";
import styles from "./preflightModal.module.css";

export default function MockupPreflightModal({
  open,
  garmentType,
  garmentLabel,
  assets,
  colors,
  styleLabel,
  fabricLabel,
  backdropLabel,
  busy,
  onClose,
  onConfirm,
}) {
  const [approved, setApproved] = useState(false);
  const checks = useMemo(() => buildMockupQualityChecks({ garmentType, assets, colors }), [garmentType, assets, colors]);
  const requiredParts = getGarmentParts(garmentType).required;
  const blocked = checks.some(check => check.tone === "block");
  const colorSelections = garmentType === "polo_jersey"
    ? [
        ["Backdrop", colors.backdrop],
        ["Collar", colors.collar],
        ["Placket", colors.placket],
        ["Left cuff", colors.leftCuff],
        ["Right cuff", colors.rightCuff],
      ]
    : [
        ["Backdrop", colors.backdrop],
        ["Collar", colors.collar],
        ["Left cuff", colors.leftCuff],
        ["Right cuff", colors.rightCuff],
      ];

  useEffect(() => {
    if (open) setApproved(false);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const handleKey = event => {
      if (event.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [busy, onClose, open]);

  if (!open) return null;
  return (
    <div className={styles.backdrop} role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="mockup-preflight-title">
        <header className={styles.header}>
          <div><span>FINAL PREFLIGHT</span><h2 id="mockup-preflight-title">Approve the production brief</h2><p>No Claws are charged until you confirm this screen.</p></div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close preflight">Close</button>
        </header>

        <div className={styles.body}>
          <section className={styles.summary}>
            <dl>
              <div><dt>Garment</dt><dd>{garmentLabel}</dd></div>
              <div><dt>Campaign style</dt><dd>{styleLabel}</dd></div>
              <div><dt>Fabric</dt><dd>{fabricLabel}</dd></div>
              <div><dt>Backdrop</dt><dd><i className={styles.inlineSwatch} style={{ backgroundColor: colors.backdrop }} />{backdropLabel}</dd></div>
              <div><dt>Output</dt><dd>5 controlled 1K PNG views</dd></div>
            </dl>
            <div className={styles.colorSelections}>
              <h3>Color direction</h3>
              <div>{colorSelections.map(([label, value]) => <article key={label}><i style={{ backgroundColor: value }} /><span>{label}<strong>{String(value || "").toUpperCase()}</strong></span></article>)}</div>
            </div>
            <div className={styles.panelList}>
              <h3>Source panels</h3>
              {requiredParts.map(role => <div key={role}><span>{MOCKUP_PARTS[role]?.label || role}</span><strong>{assets[role] ? `${assets[role].width} × ${assets[role].height}px` : "Missing"}</strong></div>)}
            </div>
          </section>

          <section className={styles.checks} aria-label="Quality checks">
            <h3>Automated quality review</h3>
            {checks.map(check => <article key={check.key} data-tone={check.tone}><span>{check.tone === "pass" ? "✓ Ready" : check.tone === "block" ? "! Fix required" : "• Review"}</span><div><strong>{check.title}</strong><p>{check.detail}</p></div></article>)}
          </section>
        </div>

        <footer className={styles.footer}>
          <label className={styles.approval}><input type="checkbox" checked={approved} onChange={event => setApproved(event.target.checked)} /><span aria-hidden="true">✓</span><strong>I reviewed the artwork, fabric, trim colors, campaign style, and backdrop.</strong></label>
          <div><span><strong>{MOCKUP_RENDER_COST}</strong> Claws · charged once for the complete set</span><button type="button" onClick={onConfirm} disabled={!approved || blocked || busy}>{busy ? "Starting render…" : "Confirm and generate"}</button></div>
        </footer>
      </section>
    </div>
  );
}
