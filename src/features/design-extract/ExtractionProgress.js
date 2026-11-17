"use client";
import { Check, Layers3, Loader2 } from "lucide-react";
import useElapsedTime, { formatElapsedTime } from "@/hooks/useElapsedTime";
import styles from "./designExtract.module.css";

const stages = ["Preparing", "Queued", "Separating", "Saving"];
export default function ExtractionProgress({ status, previewUrl, operationId, paused = false }) {
  const elapsed = useElapsedTime(!paused, operationId);
  const stage = status === "saving" ? 3 : status === "processing" ? 2 : status === "queued" ? 1 : 0;
  const title = paused ? "Connection paused" : stage === 0 ? "Preparing your design" : stage === 1 ? "Waiting for AI" : stage === 2 ? "Separating design elements" : "Preparing your layers";
  const detail = paused ? "Use Resume checking in the Layers panel to reconnect to this request." : stage === 0 ? "Saving your changes and sending the artwork for extraction." : stage === 1 ? "Your request is in the queue. Extraction starts as soon as an AI worker is available." : stage === 2 ? "AI is separating the artwork into individual image layers." : "Saving the extracted elements. Your layer previews will appear next.";
  return <div className={styles.processingOverlay}>
    <section className={styles.processingCard} aria-label="Design extraction progress">
      <div className={styles.processingPreview} aria-hidden="true">{previewUrl && <img src={previewUrl} alt="" />}<span className={styles.scanLine} /><span className={styles.processingMark}><Layers3 size={22} /></span></div>
      <div className={styles.processingTitle} role="status" aria-live="polite">{!paused && <Loader2 size={18} className={styles.spinner} />}<h2>{title}</h2></div>
      <p>{detail}</p>
      {!paused && <div className={styles.loadingTrack} role="progressbar" aria-label={title}><span /></div>}
      <ol className={styles.processingSteps}>{stages.map((label, index) => <li key={label} data-state={index < stage ? "complete" : index === stage ? "active" : "pending"} aria-current={index === stage ? "step" : undefined}><span>{index < stage ? <Check size={12} /> : index + 1}</span>{label}</li>)}</ol>
      <footer><span>{paused ? "Request preserved" : `${formatElapsedTime(elapsed)} elapsed`}</span><span>Your original artwork is preserved</span></footer>
      {elapsed >= 60 && !paused && <small>Still working. Queue and processing times vary; there is no need to submit again.</small>}
    </section>
  </div>;
}
