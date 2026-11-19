import { Crown } from "lucide-react";
import styles from "./designExtract.module.css";

// Visual emphasis only: this badge never controls access or billing.
export default function PremiumCrown() {
  return <Crown size={12} className={styles.premiumCrown} data-premium-crown aria-hidden="true" />;
}
