"use client";

import { ArrowUpRight, Check, CreditCard, ExternalLink, QrCode } from "lucide-react";
import Image from "next/image";
import { CREDIT_PLANS } from "@/lib/paymentPlans";
import styles from "./GuestPricingSection.module.css";

const PLAN_DETAILS = {
  tingi: {
    eyebrow: "Quick test",
    description: "For a small file or a fast production check.",
    features: ["2 standard traces", "1 precision trace", "QR Ph checkout"],
  },
  basic: {
    eyebrow: "Occasional work",
    description: "A practical pack for one-off client jobs.",
    features: ["Up to 5 standard traces", "Up to 2 precision traces", "QR Ph or card"],
  },
  starter: {
    eyebrow: "Regular production",
    description: "Built for a steady flow of artwork each week.",
    features: ["Up to 10 standard traces", "Up to 5 precision traces", "QR Ph or card"],
  },
  pro: {
    eyebrow: "Best value",
    description: "The lowest cost per Claw for active production teams.",
    features: ["Up to 35 standard traces", "Up to 17 precision traces", "QR Ph or card"],
    featured: true,
  },
};

const PRICING_PLANS = Object.values(CREDIT_PLANS).map((plan) => ({
  ...plan,
  ...PLAN_DETAILS[plan.key],
  pricePerClaw: Math.round(plan.amount / 100 / plan.credits),
}));

const DISPLAY_PLANS = [
  ...PRICING_PLANS.filter((plan) => plan.featured),
  ...PRICING_PLANS.filter((plan) => !plan.featured),
];

export default function GuestPricingSection({ onStart }) {
  return (
    <section className={styles.section} id="pricing" aria-labelledby="guest-pricing-heading">
      <div className={styles.heading}>
        <span className={styles.eyebrow}>Flexible pricing</span>
        <h2 id="guest-pricing-heading">Production capacity, without a subscription.</h2>
        <p>Buy only the Claws you need. Every package is a one-time payment with no recurring commitment.</p>
      </div>

      <div className={styles.grid}>
        {DISPLAY_PLANS.map((plan) => (
          <article className={`${styles.card}${plan.featured ? ` ${styles.featured}` : ""}`} key={plan.key}>
            <header className={styles.cardHeader}>
              <div className={styles.planName}>
                <h3>{plan.label}</h3>
                {plan.featured && <span>Most recommended</span>}
              </div>
              <button type="button" onClick={onStart} aria-label={`Choose the ${plan.label} package`}>
                Choose plan <ArrowUpRight size={15} aria-hidden="true" />
              </button>
            </header>

            <div className={styles.cardContent}>
              <div className={styles.summary}>
                <span className={styles.useCase}>{plan.eyebrow}</span>
                <div className={styles.price}>
                  <strong>{plan.price}</strong>
                  <span>one-time</span>
                </div>

                <div className={styles.claws}>
                  <strong>{plan.credits}</strong>
                  <span>
                    <Image src="/Claws/Claws.webp" alt="" width={15} height={15} aria-hidden="true" />
                    Claws
                  </span>
                  <small>₱{plan.pricePerClaw} each</small>
                </div>

                <p>{plan.description}</p>
              </div>

              <ul className={styles.features}>
                {plan.features.map((feature) => (
                  <li key={feature}><Check size={16} aria-hidden="true" /> <span>{feature}</span></li>
                ))}
              </ul>
            </div>
          </article>
        ))}
      </div>

      <div className={styles.footnote}>
        <span><QrCode size={14} aria-hidden="true" /> QR Ph for every package</span>
        <span><CreditCard size={14} aria-hidden="true" /> Card checkout on Basic and above</span>
        <small>Standard SVG uses 1 Claw. Precision SVG uses 2 Claws.</small>
      </div>

      <aside className={styles.registrationTrust} aria-labelledby="bir-registration-heading">
        <header className={styles.registrationHeading}>
          <div>
            <span>Registered business</span>
            <h3 id="bir-registration-heading">Official BIR registration seal</h3>
          </div>
          <p>DesaynClaw is registered with the Philippine Bureau of Internal Revenue. View or scan the official 2026 seal to verify the registration.</p>
          <a href="/BADGE-BIR.jpg" target="_blank" rel="noreferrer">
            View full seal <ExternalLink size={13} aria-hidden="true" />
          </a>
        </header>

        <a
          className={styles.registrationSeal}
          href="/BADGE-BIR.jpg"
          target="_blank"
          rel="noreferrer"
          aria-label="Open the full resolution DesaynClaw BIR registration seal"
        >
          <Image
            src="/BADGE-BIR.jpg"
            alt="DesaynClaw 2026 Bureau of Internal Revenue registration seal with verification QR code"
            width={1368}
            height={520}
            sizes="(max-width: 700px) calc(100vw - 36px), 1136px"
          />
        </a>
      </aside>
    </section>
  );
}
