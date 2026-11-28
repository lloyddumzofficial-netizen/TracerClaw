import { CheckIcon as Check, XIcon as X } from "@phosphor-icons/react/ssr";
import Image from "next/image";
import styles from "./LogoCropGuide.module.css";

export default function LogoCropGuide() {
  return (
    <div className={styles.guide}>
      <div className={styles.intro}>
        <h3>Frame the complete logo.</h3>
        <p>Keep every detail, with only a small margin around the artwork.</p>
      </div>

      <section className={`${styles.example} ${styles.correct}`} aria-label="Recommended logo crop">
        <div className={styles.exampleHeading}>
          <span>01 <strong>Correct crop</strong></span>
          <Check size={18} aria-hidden="true" />
        </div>
        <figure className={styles.demo}>
          <Image unoptimized className={styles.preview} src="/guides/logo-crop/correct-lion.webp" width={355} height={360} sizes="304px" alt="Correct crop: the selection fits closely around the complete lion logo." />
          <figcaption>Crop close to the logo. Keep the full outline.</figcaption>
        </figure>
      </section>

      <section className={`${styles.example} ${styles.incorrect}`} aria-label="Logo crop to avoid">
        <div className={styles.exampleHeading}>
          <span>02 <strong>Wrong crop</strong></span>
          <X size={18} aria-hidden="true" />
        </div>
        <figure className={styles.demo}>
          <Image unoptimized className={styles.preview} src="/guides/logo-crop/incorrect-lion.webp" width={488} height={488} sizes="304px" alt="Wrong crop: the selection includes too much empty white space around the lion logo." />
          <figcaption>Avoid large empty margins around the logo.</figcaption>
        </figure>
      </section>

    </div>
  );
}
