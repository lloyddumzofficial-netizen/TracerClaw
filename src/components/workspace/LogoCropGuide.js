import { ArrowLeftRight, Check, ScanLine } from "lucide-react";
import styles from "./LogoCropGuide.module.css";

function SampleWordmark() {
  return (
    <span className={styles.wordmark} aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none">
        <path d="M4 20V4h16v5H9v3h9v5H9v3H4Z" fill="currentColor" />
      </svg>
      <span>FORMA</span>
    </span>
  );
}

export default function LogoCropGuide() {
  return (
    <div className={styles.guide}>
      <div className={styles.intro}>
        <span className={styles.eyebrow}>A cleaner starting point</span>
        <h3>Frame the logo.<br /><span>Leave the canvas behind.</span></h3>
        <p>Bring each edge close to the artwork. Keep every letter and detail inside.</p>
      </div>

      <section className={styles.example} aria-label="Recommended logo crop">
        <div className={styles.exampleHeading}>
          <span>01 <strong>Close to the artwork</strong></span>
          <Check size={14} aria-hidden="true" />
        </div>
        <div className={styles.tightDemo} role="img" aria-label="Recommended: crop frame fits closely around the complete logo">
          <div className={styles.cropFrame}>
            <SampleWordmark />
            <i /><i /><i /><i />
          </div>
          <span className={styles.demoCaption}>Small margin. Complete logo.</span>
        </div>
      </section>

      <section className={styles.example} aria-label="Logo crop to avoid">
        <div className={styles.exampleHeading}>
          <span>02 <strong>Skip the extra space</strong></span>
          <ArrowLeftRight size={14} aria-hidden="true" />
        </div>
        <div className={styles.looseDemo} role="img" aria-label="Avoid: a small logo surrounded by large empty margins">
          <div className={styles.looseFrame}>
            <span className={styles.marginLine} />
            <SampleWordmark />
            <span className={styles.marginLine} />
          </div>
          <span className={styles.demoCaption}>Empty margins add no detail.</span>
        </div>
      </section>

      <div className={styles.tip}>
        <ScanLine size={17} aria-hidden="true" />
        <div><strong>Check the edges</strong><p>Keep fine strokes and small marks inside the frame.</p></div>
      </div>
    </div>
  );
}
