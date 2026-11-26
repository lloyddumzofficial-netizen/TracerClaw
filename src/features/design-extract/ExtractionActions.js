"use client";
import { CheckCircle2, Layers3, Loader2, MousePointer2, Sparkles } from "lucide-react";
import styles from "./designExtract.module.css";

export default function ExtractionActions({ disabled, processing, paused, progressLabel, reviewing, hasLayers, pricing, sourceSelected, guided, onSource, onExtract }) {
  const price = kind => pricing?.mode === "paid" ? ` · ${pricing.prices[kind]} Claw${pricing.prices[kind] === 1 ? "" : "s"}` : "";
  const badge = kind => pricing && <span className={styles.generateCost} title={pricing.mode === "paid" ? "Charged when the extraction is submitted" : "Standard cost · charging is currently disabled"}>{pricing.prices[kind]} {pricing.prices[kind] === 1 ? "Claw" : "Claws"}</span>;
  const complete = !guided && hasLayers;
  const label = processing ? progressLabel : complete ? "Layers extracted" : "Extract elements";
  const kind = "extract";
  return <div className={styles.actionGroup} role="group" aria-label="Extract artwork">
    <button className={styles.primaryAction} data-complete={complete} aria-label={processing || complete ? label : label + price(kind)} title={guided ? "Find complete graphics and separate them from the background" : "Automatically separate artwork into transparent image layers"} disabled={disabled || complete} onClick={onExtract}>
      {processing ? paused ? <Layers3 size={14} /> : <Loader2 size={14} className={styles.spinner} /> : complete ? <CheckCircle2 size={14} /> : <Sparkles size={14} />}
      <span className={styles.extractLabel}>{label}</span>{!processing && !reviewing && !complete && badge(kind)}
    </button>
    <button className={styles.iconAction} aria-label="Manual cutout" title={"Cut out a specific area" + price("segment")} disabled={disabled} aria-pressed={sourceSelected} onClick={onSource}><MousePointer2 size={16} /></button>
  </div>;
}
