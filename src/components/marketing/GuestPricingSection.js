"use client";

import { ArrowUpRight, Check, CreditCard, QrCode } from "lucide-react";
import { CREDIT_PLANS } from "@/lib/paymentPlans";

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

export default function GuestPricingSection({ onStart }) {
  return (
    <section className="guest-pricing" id="pricing" aria-labelledby="guest-pricing-heading">
      <div className="guest-pricing-heading">
        <span>PAY AS YOU GO</span>
        <h2 id="guest-pricing-heading">Production pricing.<br /><em>No subscription.</em></h2>
        <p>Buy only the Claws you need. Use them across DesaynClaw production tools without a monthly commitment.</p>
      </div>

      <div className="guest-pricing-grid">
        {PRICING_PLANS.map((plan, index) => (
          <article className={`guest-pricing-card${plan.featured ? " is-featured" : ""}`} key={plan.key}>
            <div className="guest-pricing-card-topline">
              <span>{String(index + 1).padStart(2, "0")}</span>
              <small>{plan.eyebrow}</small>
            </div>

            <div className="guest-pricing-plan-name">
              <h3>{plan.label}</h3>
              {plan.featured && <span>Most efficient</span>}
            </div>

            <div className="guest-pricing-price">
              <strong>{plan.price}</strong>
              <span>one-time</span>
            </div>

            <div className="guest-pricing-claws">
              <strong>{plan.credits}</strong>
              <span>Claws</span>
              <small>₱{plan.pricePerClaw} each</small>
            </div>

            <p>{plan.description}</p>

            <ul>
              {plan.features.map((feature) => (
                <li key={feature}><Check size={14} aria-hidden="true" /> {feature}</li>
              ))}
            </ul>

            <button type="button" onClick={onStart} aria-label={`Choose the ${plan.label} package`}>
              Choose {plan.label} <ArrowUpRight size={16} aria-hidden="true" />
            </button>
          </article>
        ))}
      </div>

      <div className="guest-pricing-footnote">
        <span><QrCode size={14} aria-hidden="true" /> QR Ph for every package</span>
        <span><CreditCard size={14} aria-hidden="true" /> Card checkout on Basic and above</span>
        <small>Standard SVG uses 1 Claw. Precision SVG uses 2 Claws.</small>
      </div>
    </section>
  );
}
