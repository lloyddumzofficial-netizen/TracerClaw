import {
  ArrowLeft,
  ArrowUpRight,
  Copyright,
  FileCheck2,
  FileText,
  Scale,
  ShieldCheck,
} from "lucide-react";
import "../legal-policy.css";

const SUMMARY = [
  {
    icon: FileCheck2,
    title: "Use authorized artwork",
    text: "Only process files you own or have permission to use.",
  },
  {
    icon: ShieldCheck,
    title: "You keep your rights",
    text: "DesaynClaw does not claim ownership of uploaded content.",
  },
  {
    icon: Scale,
    title: "Rights still apply",
    text: "Processing a file does not create copyright or commercial-use rights.",
  },
];

function Section({ number, id, title, children }) {
  return (
    <section className="legal-section" id={id}>
      <div className="legal-section-number">{number}</div>
      <div>
        <h2>{title}</h2>
        {children}
      </div>
    </section>
  );
}

export default function CopyrightPolicy() {
  return (
    <div className="legal-page copyright-page">
      <header className="legal-topbar">
        <a className="legal-brand" href="/" aria-label="DesaynClaw home">
          <img src="/logo.png" alt="DesaynClaw" />
        </a>
        <a className="legal-back" href="/">
          <ArrowLeft size={15} /> Back to home
        </a>
      </header>

      <main>
        <section className="legal-hero">
          <div className="legal-kicker">
            <Copyright size={14} /> Intellectual property
          </div>
          <h1>Protect the work behind every production file.</h1>
          <p>
            Clear responsibilities for artwork ownership, authorization, processing,
            and copyright complaints on DesaynClaw.
          </p>
          <div className="legal-meta">
            <span>Last updated July 2026</span>
            <i />
            <span>Applies to uploads and generated output</span>
          </div>
        </section>

        <section className="legal-summary" aria-label="Copyright policy overview">
          {SUMMARY.map(({ icon: Icon, title, text }) => (
            <article key={title}>
              <span className="legal-summary-icon"><Icon size={18} /></span>
              <div><strong>{title}</strong><p>{text}</p></div>
            </article>
          ))}
        </section>

        <section className="legal-layout">
          <article className="legal-document">
            <header>
              <span><FileText size={16} /> Official policy</span>
              <h2>Copyright Policy</h2>
              <p>
                This policy explains how intellectual property rights apply when you
                upload, process, export, or use content through DesaynClaw.
              </p>
            </header>

            <Section number="01" id="responsibility" title="Your responsibility">
              <p>
                You are responsible for every file you upload. You must own the artwork
                or have sufficient authorization from the copyright owner, trademark
                owner, client, brand, team, school, business, or other rights holder
                before processing it with DesaynClaw.
              </p>
            </Section>

            <Section number="02" id="rights-transfer" title="No transfer of rights">
              <p>
                Using DesaynClaw does not transfer, create, or grant copyright,
                trademark, reproduction, merchandising, resale, distribution, or
                commercial exploitation rights over uploaded content or generated output.
              </p>
            </Section>

            <Section number="03" id="ownership" title="Ownership of uploaded content">
              <p>
                DesaynClaw does not claim ownership of uploaded content. We process files
                only to provide the requested service, subject to our Terms of Service
                and Privacy Policy.
              </p>
              <a className="legal-inline-link" href="/privacy">
                Review the Privacy Policy <ArrowUpRight size={14} />
              </a>
            </Section>

            <Section number="04" id="unauthorized-content" title="Unauthorized content">
              <p>
                You may not upload, process, reproduce, sell, distribute, or commercially
                exploit copyrighted or trademarked content without authorization. This
                includes copied artwork, brand marks, team logos, school marks, character
                art, artist work, and client files you are not authorized to use.
              </p>
            </Section>

            <Section number="05" id="enforcement" title="Enforcement">
              <p>
                DesaynClaw may remove content that appears to violate intellectual
                property rights. Accounts may be limited, suspended, or terminated for
                repeated infringement or serious copyright or trademark violations.
              </p>
            </Section>

            <Section number="06" id="complaints" title="Copyright complaints">
              <p>
                If you believe content processed or displayed through DesaynClaw
                infringes your rights, send a complete request through our copyright
                takedown process so the claim can be reviewed.
              </p>
              <a className="legal-inline-link" href="/copyright-takedown">
                View takedown requirements <ArrowUpRight size={14} />
              </a>
            </Section>

            <aside className="legal-contact" aria-label="Copyright support">
              <div className="legal-contact-copy">
                <span className="legal-contact-icon"><Copyright size={17} /></span>
                <div>
                  <h3>Need to report an infringement?</h3>
                  <p>Review the required information before submitting your request.</p>
                </div>
              </div>
              <a href="/copyright-takedown">
                Takedown process <ArrowUpRight size={14} />
              </a>
            </aside>
          </article>
        </section>
      </main>

      <footer className="legal-footer">
        <img src="/logo.png" alt="DesaynClaw" />
        <p>Your artwork. Your rights. Clear responsibilities.</p>
        <nav aria-label="Legal links">
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
          <a href="/refunds">Refunds</a>
        </nav>
      </footer>
    </div>
  );
}
