import { Code2, Monitor, ShieldCheck, Trash2 } from "lucide-react";

const trustItems = [
  { icon: ShieldCheck, label: "100% Private & Secure" },
  { icon: Trash2, label: "Auto-deletes after 3 days" },
  { icon: Code2, label: "Built by Real Developers" },
  { icon: Monitor, label: "Highly Scalable Infrastructure" },
];

const softwareItems = [
  { label: "Adobe Photoshop", logo: "/brand-logos/adobe-photoshop.svg" },
  { label: "Adobe Illustrator", logo: "/brand-logos/adobe-illustrator.svg" },
  { label: "CorelDRAW", logo: "/brand-logos/coreldraw-color.png" },
  { label: "Figma", logo: "/brand-logos/figma.svg" },
  { label: "Inkscape", logo: "/brand-logos/inkscape.svg" },
  { label: "Blender", logo: "/brand-logos/blender.svg" },
  { label: "GIMP", logo: "/brand-logos/gimp.svg" },
  { label: "Krita", logo: "/brand-logos/krita.svg" },
  { label: "Sketch", logo: "/brand-logos/sketch.svg" },
  { label: "Penpot", logo: "/brand-logos/penpot.svg" },
];

const MARQUEE_COPIES = 4;

export default function HomeTrustMarquee({ guest = false }) {
  const items = guest ? softwareItems : trustItems;

  return (
    <div
      className={`marquee-container ${guest ? "guest-trust-marquee software-compatibility-marquee" : "signed-in-trust-marquee"}`}
      aria-label={guest ? "Design software compatible with DesaynClaw exports" : "DesaynClaw platform notes"}
    >
      {guest && (
        <p className="software-compatibility-copy">
          Works with your design tools
        </p>
      )}
      <div className="marquee-content">
        {Array.from({ length: MARQUEE_COPIES }, (_, copyIndex) =>
          items.map((item) => {
            if (guest) {
              return (
                <div
                  className="software-marquee-item"
                  key={`${copyIndex}-${item.label}`}
                  aria-hidden={copyIndex > 0 ? "true" : undefined}
                >
                  <span className="software-logo-shell" aria-hidden="true">
                    <img className="software-logo" src={item.logo} alt="" width="34" height="34" />
                  </span>
                  <span className="software-name">{item.label}</span>
                </div>
              );
            }

            const Icon = item.icon;
            return (
              <div key={`${copyIndex}-${item.label}`} aria-hidden={copyIndex > 0 ? "true" : undefined}>
                <Icon size={16} aria-hidden="true" />
                <span>{item.label}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
