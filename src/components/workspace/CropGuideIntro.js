"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, CircleCheck, Timer, X } from "lucide-react";
import useDialogFocus from "@/hooks/useDialogFocus";
import LogoCropGuide from "./LogoCropGuide";
import styles from "./CropGuideIntro.module.css";
import orbit from "../marketing/OrbitAnnouncement.module.css";

const REVIEW_SECONDS = 5;

export default function CropGuideIntro({ mode, onContinue }) {
  const dialogRef = useRef(null);
  const deadlineRef = useRef(null);
  const [remaining, setRemaining] = useState(REVIEW_SECONDS);
  const [imageFailed, setImageFailed] = useState(false);
  const [ready, setReady] = useState(mode !== "garment");

  useEffect(() => {
    if (!ready) return;
    deadlineRef.current = performance.now() + REVIEW_SECONDS * 1000;
    const timer = window.setInterval(() => {
      const seconds = Math.max(0, Math.ceil((deadlineRef.current - performance.now()) / 1000));
      setRemaining(seconds);
      if (seconds === 0) window.clearInterval(timer);
    }, 100);
    return () => window.clearInterval(timer);
  }, [ready]);

  const continueToCrop = () => {
    if (deadlineRef.current !== null && performance.now() >= deadlineRef.current) onContinue();
  };
  useDialogFocus(true, dialogRef, continueToCrop);

  const title = mode === "logo" ? "Keep the complete logo."
    : mode === "pattern" ? "Frame the exact pattern." : "Crop it right. Get a cleaner result.";
  const description = mode === "logo" ? "Include every part of the mark, with only a small margin around the artwork."
    : mode === "pattern" ? "Include the complete flat artwork. Leave out scan edges, empty margins, tables, and unrelated objects."
      : "Crop one front or back body panel. Leave out sleeves, background, and extra side margins.";
  const canContinue = ready && remaining === 0;
  const StatusIcon = canContinue ? CircleCheck : Timer;

  return (
    <div className={styles.overlay}>
      <section className={styles.card} ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="crop-guide-title" aria-describedby="crop-guide-description" tabIndex={-1}>
        <button type="button" className={`${orbit.close} ${styles.close}`} onClick={continueToCrop} disabled={!canContinue} aria-label="Close crop guide and continue to crop"><X size={17} aria-hidden="true" /></button>
        <div className={styles.body}>
          {mode === "garment" && !imageFailed && (
            <figure className={styles.visual}>
              <img src="/guides/garment-crop/crop-it-right.jpg" width={1254} height={1254} alt="Wrong crop includes sleeves and extra margins. Right crop focuses on the main garment body, without sleeves or side margins." onLoad={() => setReady(true)} onError={() => { setImageFailed(true); setReady(true); }} />
            </figure>
          )}
          {mode === "logo" && <div className={styles.logoGuide}><LogoCropGuide /></div>}
          <div className={orbit.content}>
            <h2 id="crop-guide-title">{title}</h2>
            <p className={orbit.lead} id="crop-guide-description">{description}</p>
            {(mode === "pattern" || imageFailed) && <p>Keep the original proportions and check all four edges before applying your crop.</p>}
          </div>
        </div>
        <footer className={styles.footer}>
          <button type="button" className={`${orbit.action} ${styles.continue}`} disabled={!canContinue} onClick={continueToCrop}>
            {remaining > 0 ? `Continue in ${remaining}s` : "Continue to crop"}<ArrowRight size={15} aria-hidden="true" />
          </button>
          <span className={styles.status} data-ready={canContinue} role="status">
            <StatusIcon size={14} aria-hidden="true" />
            {!ready ? "Loading guide…" : canContinue ? "Ready to crop" : "Review the crop guide"}
          </span>
        </footer>
      </section>
    </div>
  );
}
