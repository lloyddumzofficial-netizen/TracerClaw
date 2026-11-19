"use client";
import { CheckCircle2, Layers3, Loader2, MousePointer2, Sparkles } from "lucide-react";
import styles from "./designExtract.module.css";

export default function ExtractionActions({ disabled, processing, paused, progressLabel, reviewing, hasLayers, pricing, sourceSelected, onSource, onReconstruct }) {
  const price = kind => pricing?.mode === "paid" ? ` · ${pricing.prices[kind]} Claw${pricing.prices[kind] === 1 ? "" : "s"}` : "";
  const badge = kind => pricing && <span className={styles.generateCost} title={pricing.mode === "paid" ? "Charged when the extraction is submitted" : "Standard cost · charging is currently disabled"}>{pricing.prices[kind]} {pricing.prices[kind] === 1 ? "Claw" : "Claws"}</span>;
  return <div className={styles.actionGroup} role="group" aria-label="Extract artwork">
    <button className={styles.primaryAction} data-complete={hasLayers} aria-label={processing ? progressLabel : hasLayers ? "Layers extracted" : "Extract elements" + price("extract")} title="Automatically separate artwork into transparent image layers" disabled={disabled || hasLayers} onClick={onReconstruct}>
      {processing ? paused ? <Layers3 size={14} /> : <Loader2 size={14} className={styles.spinner} /> : hasLayers ? <CheckCircle2 size={14} /> : <Sparkles size={14} />}
      <span className={styles.extractLabel}>{processing ? progressLabel : hasLayers ? "Layers extracted" : "Extract elements"}</span>{!processing && !reviewing && !hasLayers && badge("extract")}
    </button>
    <button className={styles.iconAction} aria-label="Manual cutout" title={"Optional manual cutout · Select visible content" + price("segment")} disabled={disabled} aria-pressed={sourceSelected} onClick={onSource}><MousePointer2 size={16} /></button>
  </div>;
}
