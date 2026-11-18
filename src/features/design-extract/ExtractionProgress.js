"use client";
import { Layers3, Loader2 } from "lucide-react";
import useElapsedTime, { formatElapsedTime } from "@/hooks/useElapsedTime";
import styles from "./designExtract.module.css";

export default function ExtractionProgress({ status, detail: customDetail, operationId, paused = false, compact = false }) {
  const elapsed = useElapsedTime(!paused, operationId);
  const title = paused ? "Connection paused" : status === "enhancing" ? "Enhancing your layers" : status === "saving" ? "Preparing your layers" : status === "processing" ? "Separating design elements" : status === "queued" ? "Waiting for AI" : "Preparing your design";
  const detail = paused ? "Resume checking in the Layers panel." : status === "enhancing" ? customDetail || "Improving each element while preserving transparency." : status === "saving" ? "Saving the result for your review." : status === "queued" ? "Your request is queued. No need to submit again." : status === "processing" ? "Creating individual image layers." : "Preparing your artwork for extraction.";
  return <section className={styles.artworkProgress} data-paused={paused} data-compact={compact} aria-label="Design extraction progress">
    <span className={styles.artworkSweep} aria-hidden="true" />
    <div className={styles.artworkProgressBody}>
      <span className={styles.artworkProgressIcon} aria-hidden="true">{paused ? <Layers3 size={20} /> : <Loader2 size={20} className={styles.spinner} />}</span>
      <h2 role="status" aria-live="polite">{title}</h2>
      {!compact && <p>{detail}</p>}
    </div>
    <footer className={styles.artworkProgressFooter}>
      <span>{paused ? "Request preserved" : `${formatElapsedTime(elapsed)} elapsed`}</span>
      {!compact && <span>Original preserved</span>}
    </footer>
    {!paused && <div className={styles.loadingTrack} role="progressbar" aria-label={title}><span /></div>}
  </section>;
}
