"use client";
import { StackIcon as Layers3, CircleNotchIcon as Loader2, CursorIcon as MousePointer2, SparkleIcon as Sparkles } from "@phosphor-icons/react/ssr";
import styles from "./designExtract.module.css";

export default function ExtractionActions({ disabled, processing, paused, progressLabel, reviewing, extractionComplete, pricing, sourceSelected, guided, onSource, onExtract }) {
  const price = kind => pricing?.mode === "paid" ? ` · ${pricing.prices[kind]} Claw${pricing.prices[kind] === 1 ? "" : "s"}` : "";
  const badge = kind => pricing && <span className={styles.generateCost} title={pricing.mode === "paid" ? "Charged when the extraction is submitted" : "Standard cost · charging is currently disabled"}>{pricing.prices[kind]} {pricing.prices[kind] === 1 ? "Claw" : "Claws"}</span>;
  const label = processing ? progressLabel : "Extract elements";
  const kind = "extract";
  return <div className={styles.actionGroup} role="group" aria-label="Extract artwork">
    {!extractionComplete && <button className={styles.primaryAction} aria-label={processing ? label : label + price(kind)} title={guided ? "Find complete graphics and separate them from the background" : "Automatically separate artwork into transparent image layers"} disabled={disabled} onClick={onExtract}>
      {processing ? paused ? <Layers3 size={14} /> : <Loader2 size={14} className={styles.spinner} /> : <Sparkles size={14} />}
      <span className={styles.extractLabel}>{label}</span>{!processing && !reviewing && badge(kind)}
    </button>}
    <button className={styles.iconAction} aria-label="Manual cutout" title={"Cut out a specific area" + price("segment")} disabled={disabled} aria-pressed={sourceSelected} onClick={onSource}><MousePointer2 size={16} /></button>
  </div>;
}
