"use client";
import { Layers3, Loader2 } from "lucide-react";
import useElapsedTime, { formatElapsedTime } from "@/hooks/useElapsedTime";
import styles from "./designExtract.module.css";

export default function ExtractionProgress({ refinement = false, status, detail: customDetail, operationId, startedAt, paused = false, connectionLabel, compact = false }) {
  const localElapsed = useElapsedTime(!paused, operationId);
  const started = Date.parse(startedAt);
  const elapsed = Number.isFinite(started) ? Math.max(0, Math.floor((Date.now() - started) / 1000)) : localElapsed;
  const title = paused ? connectionLabel : status === "upscaling" ? "Upscaling image…" : status === "vectorizing" ? "Generating SVG…" : status === "enhancing" ? "Enhancing your layers" : status === "filling" ? "Filling background…" : status === "saving" ? refinement ? "Saving previews" : "Saving your layers" : status === "processing" ? refinement ? "Refining design…" : "Separating design elements" : status === "queued" ? "Waiting for AI" : "Preparing your design";
  const detail = paused ? "Your request is saved." : status === "enhancing" ? customDetail || "Improving each element while preserving transparency." : status === "filling" ? "Rebuilding the background behind the extracted artwork." : status === "saving" ? "Saving the result for your review." : status === "queued" ? "Your request is queued. No need to submit again." : status === "processing" ? refinement ? "Preparing three options from your original." : "Creating individual image layers." : refinement ? "Preparing your artwork for refinement." : "Preparing your artwork for extraction.";
  return <section className={styles.artworkProgress} data-paused={paused} data-compact={compact} aria-label={status === "upscaling" ? "Image upscale progress" : status === "vectorizing" ? "SVG conversion progress" : refinement ? "Design refinement progress" : "Design extraction progress"}>
    <span className={styles.artworkSweep} aria-hidden="true" />
    <div className={styles.artworkProgressBody}>
      <span className={styles.artworkProgressIcon} aria-hidden="true">{paused ? <Layers3 size={20} /> : <Loader2 size={20} className={styles.spinner} />}</span>
      <h2 className={styles.generatingText} role="status" aria-live="polite">{title}</h2>
      {!compact && <p>{detail}</p>}
    </div>
    <footer className={styles.artworkProgressFooter}>
      <span>{paused ? "Request preserved" : `${formatElapsedTime(elapsed)} elapsed`}</span>
      {!compact && <span>Original preserved</span>}
    </footer>
    {!paused && <div className={styles.loadingTrack} role="progressbar" aria-label={title}><span /></div>}
  </section>;
}
