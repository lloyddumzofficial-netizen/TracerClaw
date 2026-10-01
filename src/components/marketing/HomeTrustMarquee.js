import { Code2, Monitor, ShieldCheck, Trash2 } from "lucide-react";

const items = [
  { icon: ShieldCheck, label: "100% Private & Secure" },
  { icon: Trash2, label: "Auto-deletes after 3 days" },
  { icon: Code2, label: "Built by Real Developers" },
  { icon: Monitor, label: "Highly Scalable Infrastructure" },
];

const MARQUEE_COPIES = 4;

export default function HomeTrustMarquee({ guest = false }) {
  return (
    <div className={`marquee-container ${guest ? "guest-trust-marquee" : "signed-in-trust-marquee"}`} aria-label="DesaynClaw platform notes">
      <div className="marquee-content">
        {Array.from({ length: MARQUEE_COPIES }, () => items).flat().map(({ icon: Icon, label }, index) => (
          <div key={`${label}-${index}`} aria-hidden={index >= items.length ? "true" : undefined}>
            <Icon size={16} aria-hidden="true" />
            <span>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
