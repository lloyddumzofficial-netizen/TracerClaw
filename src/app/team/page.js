import Link from "next/link";
import Image from "next/image";
import { ArrowUpRight, Code2, ImageIcon, Palette, Scissors, ShieldCheck, Sparkles } from "lucide-react";
import "./team.css";

export const metadata = {
  title: "Team",
  description: "Meet the small production-minded team behind DesaynClaw.",
};

const teamMembers = [
  {
    name: "Lloyd Dumz",
    role: "Founder / Developer / UX/UI Designer",
    focus: "Designed and built the DesaynClaw product experience end to end, from the visual interface and user flow to the engineering systems behind the workspace.",
    image: "/Team/FOUNDER-DEVELOPER-OWNER.jpg",
    imageClass: "portrait-lloyd",
    tags: ["Product", "UX/UI", "Engineering"],
    tone: "gold",
  },
  {
    name: "Jeigh Luis",
    role: "Co-Founder",
    focus: "Helps shape product strategy, user experience, and the practical needs of apparel production teams.",
    image: "/Team/jEIGH-LUIS CO-FOUNDER.jpg",
    imageClass: "portrait-jeigh",
    tags: ["Strategy", "Operations"],
    tone: "graphite",
  },
  {
    name: "Sheila",
    role: "Social Media Manager",
    focus: "Builds community presence, customer communication, and launch updates across DesaynClaw channels.",
    image: "/Team/SHEILA-SOCIAL-MEDIA-MANAGER.jpg",
    imageClass: "portrait-sheila",
    tags: ["Community", "Support"],
    tone: "silver",
  },
  {
    name: "Ethel Jane",
    role: "Social Media Content Manager",
    focus: "Creates content, campaign materials, and product stories that explain the value of DesaynClaw.",
    image: "/Team/ethel-jane-Social-media-contents- marketing.jpg",
    imageClass: "portrait-ethel",
    tags: ["Content", "Marketing"],
    tone: "gold",
  },
];

export default function TeamPage() {
  return (
    <main className="team-page">
      <header className="team-nav">
        <Link href="/" className="team-logo-link" aria-label="Back to DesaynClaw homepage">
          <Image src="/desaynclaw-hero-logo.png" alt="DesaynClaw" width={188} height={40} priority />
        </Link>
        <Link href="/" className="team-home-link">
          Return home <ArrowUpRight size={14} />
        </Link>
      </header>

      <section className="team-hero" aria-labelledby="team-title">
        <div className="team-kicker">
          <span><i aria-hidden="true" /> The people behind the product</span>
          <small>Independent production team · 04 members</small>
        </div>
        <div className="team-hero-grid">
          <div>
            <h1 id="team-title">Small team.<br /><em>Serious tools.</em></h1>
          </div>
          <div className="team-hero-copy">
            <p>
              DesaynClaw is designed and operated by a focused team with experience around design and apparel production. We turn recurring cleanup work—raster artwork, jersey mockups, logos, and difficult client files—into software that print shops can depend on.
            </p>
            <div className="team-proof-row" aria-label="DesaynClaw team focus">
              <span>AI production tools</span>
              <span>Print-shop workflow</span>
              <span>Design support</span>
            </div>
          </div>
        </div>

        <div className="team-roster-heading">
          <span>Core team</span>
          <p>Product, operations, and community—working as one compact studio.</p>
        </div>
        <div className="team-card-grid">
          {teamMembers.map((member, index) => (
            <article className={`team-card${index === 0 ? " is-lead" : ""}`} key={member.name}>
              <div className={`team-portrait tone-${member.tone}`}>
                <Image
                  className={member.imageClass}
                  src={member.image}
                  alt={`${member.name} - ${member.role}`}
                  fill
                  sizes={index === 0 ? "(max-width: 820px) 100vw, 52vw" : "(max-width: 820px) 42vw, 190px"}
                  priority={index === 0}
                />
                <span className="team-member-number">{String(index + 1).padStart(2, "0")}</span>
              </div>
              <div className="team-card-body">
                <div className="team-card-meta">
                  <div>
                    <h2>{member.name}</h2>
                    <p>{member.role}</p>
                  </div>
                </div>
                <div className="team-role-tags">
                  {member.tags.map((tag) => (
                    <span key={tag}>{tag}</span>
                  ))}
                </div>
                <p className="team-focus">{member.focus}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="team-build" aria-labelledby="team-build-title">
        <div className="team-build-copy">
          <span>What we build</span>
          <h2 id="team-build-title">Production tools for real design work.</h2>
        </div>
        <div className="team-build-grid">
          <article>
            <span>01</span>
            <div><Scissors size={18} /><h3>Artwork cleanup</h3><p>Background removal, crop guidance, and AI cleanup built for messy client files.</p></div>
          </article>
          <article>
            <span>02</span>
            <div><Sparkles size={18} /><h3>Vector-ready output</h3><p>Fast tracing workflows for logos, jersey mockups, and print shop artwork.</p></div>
          </article>
          <article>
            <span>03</span>
            <div><ImageIcon size={18} /><h3>High-res delivery</h3><p>Upscale and export support for crisp files ready for client handoff.</p></div>
          </article>
        </div>
      </section>

      <section className="team-principles" aria-label="How the team works">
        <header>
          <span>Operating principles</span>
          <h2>Small team,<br />clear standards.</h2>
        </header>
        <div className="team-principles-list">
          <article>
            <span>01</span>
            <Palette size={18} />
            <div><h3>Design-first output</h3><p>Every interface and file handoff is tuned for designers, sublimation shops, and apparel production workflows.</p></div>
          </article>
          <article>
            <span>02</span>
            <Code2 size={18} />
            <div><h3>Built by operators</h3><p>We build around real repeated work: cleanup, crop, trace, upscale, preview, export, and delivery.</p></div>
          </article>
          <article>
            <span>03</span>
            <ShieldCheck size={18} />
            <div><h3>Private by default</h3><p>Uploaded and generated project files are designed to auto-expire after 3 days for safer production use.</p></div>
          </article>
        </div>
      </section>

      <section className="team-cta" aria-label="Start using DesaynClaw">
        <div>
          <span>Move from rough artwork to production</span>
          <h2>Bring us the difficult file.</h2>
          <p>Upload a mockup, logo, or raster artwork and turn it into a cleaner production file with DesaynClaw.</p>
        </div>
        <Link href="/" className="team-cta-link">
          Start a project <ArrowUpRight size={15} />
        </Link>
      </section>
    </main>
  );
}
