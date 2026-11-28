"use client";

import { ArrowUpRightIcon as ArrowUpRight, CheckIcon as Check, CreditCardIcon as CreditCard, ArrowSquareOutIcon as ExternalLink } from "@phosphor-icons/react/ssr";
import Image from "next/image";
import { DODO_CREDIT_PLANS } from "@/lib/paymentPlans";
import styles from "./GuestPricingSection.module.css";

const PLAN_DETAILS = {
  basic: {
    eyebrow: "Occasional work",
    description: "A practical pack for one-off client jobs.",
    features: ["Up to 5 standard traces", "Up to 2 precision traces", "Card checkout"],
  },
  starter: {
    eyebrow: "Regular production",
    description: "Built for a steady flow of artwork each week.",
    features: ["Up to 10 standard traces", "Up to 5 precision traces", "Card checkout"],
  },
  pro: {
    eyebrow: "Best value",
    description: "The lowest cost per Claw for active production teams.",
    features: ["Up to 35 standard traces", "Up to 17 precision traces", "Card checkout"],
    featured: true,
  },
};

const PRICING_PLANS = Object.values(DODO_CREDIT_PLANS).map((plan) => ({
  ...plan,
  ...PLAN_DETAILS[plan.key],
  pricePerClaw: (plan.amount / 100 / plan.credits).toFixed(2),
}));

const DISPLAY_PLANS = PRICING_PLANS;

export default function GuestPricingSection({ onStart }) {
  return (
    <section className={styles.section} id="pricing" aria-labelledby="guest-pricing-heading">
      <div className={styles.heading}>
        <span className={styles.eyebrow}>Flexible pricing</span>
        <h2 id="guest-pricing-heading">Production capacity, without a subscription.</h2>
        <p>Buy only the Claws you need. Every package is a one-time payment with no recurring commitment.</p>
      </div>

      <aside className={styles.usageNote} aria-label="How Claws are counted">
        <h3>1 design = 1 Claw</h3>
        <p>For Standard processing, each separate design or garment panel counts individually: <strong>front design = 1 Claw; back design = 1 Claw.</strong> Front and back together use 2 Claws—not 1 Claw for a complete garment.</p>
        <small>Precision SVG uses 2 Claws per design. Additional paid actions show their own Claw cost before you run them.</small>
      </aside>

      <div className={styles.grid}>
        {DISPLAY_PLANS.map((plan) => (
          <article className={`${styles.card}${plan.featured ? ` ${styles.featured}` : ""}`} key={plan.key}>
            <header className={styles.cardHeader}>
              <div className={styles.planName}>
                <h3>{plan.label}</h3>
                {plan.featured && <span>Most recommended</span>}
              </div>
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
                  <small>${plan.pricePerClaw} each</small>
                </div>

                <p>{plan.description}</p>
              </div>

              <h4 className={styles.included}>What’s included</h4>
              <ul className={styles.features}>
                {plan.features.map((feature) => (
                  <li key={feature}><Check size={16} aria-hidden="true" /> <span>{feature}</span></li>
                ))}
              </ul>
            </div>
            <button className={styles.planAction} type="button" onClick={onStart} aria-label={`Choose the ${plan.label} package`}>
              Choose {plan.label} <ArrowUpRight size={15} aria-hidden="true" />
            </button>
          </article>
        ))}
      </div>

      <div className={styles.footnote}>
        <span><CreditCard size={14} aria-hidden="true" /> Prices in USD · One-time card payment</span>
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
