import Link from "next/link";
import { ArrowUpRight, Code2, ImageIcon, Palette, Scissors, ShieldCheck, Sparkles } from "lucide-react";
import "./team.css";

export const metadata = {
  title: "Team",
  description: "Meet the small production-minded team behind DesaynClaw.",
};

const teamMembers = [
  {
    name: "Lloyd Dumz",
    role: "Founder / Developer / Owner",
    focus: "Leads the product vision, engineering direction, and production workflow behind DesaynClaw.",
    image: "/Team/FOUNDER-DEVELOPER-OWNER.jpg",
    imageClass: "portrait-lloyd",
    tags: ["Product", "Engineering"],
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
          <img src="/desaynclaw-hero-logo.png" alt="DesaynClaw" />
        </Link>
        <Link href="/" className="team-home-link">
          Home <ArrowUpRight size={14} />
        </Link>
      </header>

      <section className="team-hero" aria-labelledby="team-title">
        <div className="team-kicker">Team</div>
        <div className="team-hero-grid">
          <div>
            <h1 id="team-title">Behind DesaynClaw</h1>
            <div className="team-title-line" aria-hidden="true" />
          </div>
          <div className="team-hero-copy">
            <p>
              DesaynClaw is built by a small, production-minded team from the design and apparel workflow space. We focus on turning difficult raster artwork, jersey mockups, logos, and client files into cleaner outputs that print shops can actually use.
            </p>
            <div className="team-proof-row" aria-label="DesaynClaw team focus">
              <span>AI production tools</span>
              <span>Print-shop workflow</span>
              <span>Design support</span>
            </div>
          </div>
        </div>

        <div className="team-card-grid">
          {teamMembers.map((member) => (
            <article className="team-card" key={member.name}>
              <div className={`team-portrait tone-${member.tone}`}>
                <img className={member.imageClass} src={member.image} alt={`${member.name} - ${member.role}`} />
              </div>
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
            <Scissors size={18} />
            <h3>Artwork cleanup</h3>
            <p>Background removal, crop guidance, and AI cleanup built for messy client files.</p>
          </article>
          <article>
            <Sparkles size={18} />
            <h3>Vector-ready output</h3>
            <p>Fast tracing workflows for logos, jersey mockups, and print shop artwork.</p>
          </article>
          <article>
            <ImageIcon size={18} />
            <h3>High-res delivery</h3>
            <p>Upscale and export support for crisp files ready for client handoff.</p>
          </article>
        </div>
      </section>

      <section className="team-principles" aria-label="How the team works">
        <article>
          <Palette size={18} />
          <h2>Design-first output</h2>
          <p>Every interface and file handoff is tuned for designers, sublimation shops, and apparel production workflows.</p>
        </article>
        <article>
          <Code2 size={18} />
          <h2>Built by operators</h2>
          <p>We build tools around real repeated work: cleanup, crop, trace, upscale, preview, export, and deliver.</p>
        </article>
        <article>
          <ShieldCheck size={18} />
          <h2>Private by default</h2>
          <p>Uploaded and generated project files are designed to auto-expire after 3 days for safer production use.</p>
        </article>
      </section>

      <section className="team-cta" aria-label="Start using DesaynClaw">
        <div>
          <span>Built for faster production</span>
          <h2>Ready to clean your next design?</h2>
          <p>Upload a mockup, logo, or raster artwork and turn it into a cleaner production file with DesaynClaw.</p>
        </div>
        <Link href="/" className="team-cta-link">
          Start a project <ArrowUpRight size={15} />
        </Link>
      </section>
    </main>
  );
}
