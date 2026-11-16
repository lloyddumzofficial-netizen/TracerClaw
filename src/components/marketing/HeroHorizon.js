import styles from "./HeroHorizon.module.css";

export default function HeroHorizon() {
  return <div className={styles.atmosphere} aria-hidden="true" />;
}

export function HeroGlow() {
  return <div className={styles.horizon} aria-hidden="true" data-hero-horizon="" />;
}
