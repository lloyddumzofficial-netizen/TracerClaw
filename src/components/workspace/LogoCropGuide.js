import { Check, X } from "lucide-react";
import styles from "./LogoCropGuide.module.css";

export default function LogoCropGuide() {
  return (
    <div className={styles.guide}>
      <div className={styles.intro}>
        <h3>Crop the logo, not the jersey.</h3>
        <p>Keep every letter and detail inside the frame.</p>
      </div>

      <section className={`${styles.example} ${styles.correct}`} aria-label="Recommended logo crop">
        <div className={styles.exampleHeading}>
          <span>01 <strong>Correct crop</strong></span>
          <Check size={18} aria-hidden="true" />
        </div>
        <figure className={styles.demo}>
          <svg className={styles.preview} viewBox="330 220 370 390" role="img" aria-label="Correct crop: only the complete chest artwork is selected, excluding the neckline and surrounding pattern.">
            <svg x="330" y="220" width="370" height="390" viewBox="330 220 370 390" overflow="hidden">
              <image href="/guides/logo-crop/correct.jpg" width="1020" height="785" />
            </svg>
          </svg>
          <figcaption>Keep the complete logo inside the frame.</figcaption>
        </figure>
      </section>

      <section className={`${styles.example} ${styles.incorrect}`} aria-label="Logo crop to avoid">
        <div className={styles.exampleHeading}>
          <span>02 <strong>Wrong crop</strong></span>
          <X size={18} aria-hidden="true" />
        </div>
        <figure className={styles.demo}>
          <svg className={styles.preview} viewBox="300 160 430 590" role="img" aria-label="Incorrect crop: the whole jersey is selected, including the neckline and unrelated artwork.">
            <svg x="300" y="160" width="430" height="590" viewBox="300 160 430 590" overflow="hidden">
              <image href="/guides/logo-crop/incorrect.jpg" width="1020" height="789" />
            </svg>
          </svg>
          <figcaption>Leave out the jersey and unrelated artwork.</figcaption>
        </figure>
      </section>

    </div>
  );
}
