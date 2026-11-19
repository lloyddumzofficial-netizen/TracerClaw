import PremiumCrown from "./PremiumCrown";
import styles from "./designExtract.module.css";

export default function FeatureBadges() {
  return <span className={styles.featureBadges} aria-hidden="true"><span className={styles.newBadge}>New</span><PremiumCrown /></span>;
}
