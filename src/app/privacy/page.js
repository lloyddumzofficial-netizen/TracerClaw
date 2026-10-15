import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  Clock3,
  FileText,
  LockKeyhole,
  MessageCircle,
  ShieldCheck,
  UserRoundCheck,
} from "lucide-react";
import "./privacy.css";

const SUMMARY_ITEMS = [
  { icon: Clock3, value: "3 days", label: "Automatic project-file deletion" },
  { icon: LockKeyhole, value: "Never sold", label: "Your uploaded artwork stays private" },
  { icon: UserRoundCheck, value: "Creator-owned", label: "We do not claim rights to your files" },
];

const FAQ_ITEMS = [
  {
    question: "What happens to the files I upload?",
    answer: "Your source files and generated outputs are processed only to provide the workspace tools you request. They remain available in your project history for up to three days, then our cleanup system permanently removes them from cloud storage. You can also delete a project sooner.",
  },
  {
    question: "Do you use my artwork to train AI models?",
    answer: "No. We do not use uploaded artwork to train AI models without your explicit consent, and we do not sell your uploaded files or use them as public datasets.",
  },
  {
    question: "Who owns uploaded and generated files?",
    answer: "You retain the rights you already hold in your source material and resulting files. DesaynClaw does not claim ownership. You remain responsible for ensuring you have permission to process any copyrighted or trademarked content.",
  },
  {
    question: "What account information is retained?",
    answer: "We keep the minimum account, transaction, usage, and technical information needed to authenticate you, manage Claws, secure the service, troubleshoot issues, and meet legal obligations.",
  },
];

function PolicySection({ number, id, title, children }) {
  return (
    <section className="privacy-policy-section" id={id}>
      <div className="privacy-policy-number">{number}</div>
      <div><h2>{title}</h2>{children}</div>
    </section>
  );
}

export default function PrivacyPolicy() {
  return (
    <div className="privacy-page">
      <header className="privacy-topbar">
        <a className="privacy-brand" href="/" aria-label="DesaynClaw home">
          <img src="/logo.png" alt="DesaynClaw" />
        </a>
        <a className="privacy-back" href="/"><ArrowLeft size={15} /> Back to home</a>
      </header>

      <main>
        <section className="privacy-hero" aria-labelledby="privacy-title">
          <div className="privacy-hero-glow" aria-hidden="true" />
          <div className="privacy-kicker"><ShieldCheck size={14} /> DesaynClaw Privacy Center</div>
          <h1 id="privacy-title">Your artwork stays yours.</h1>
          <p>A clear explanation of how DesaynClaw processes, protects, retains, and removes your files and account information.</p>
          <div className="privacy-meta">
            <span>Last updated October 15, 2026</span><i aria-hidden="true" /><span>Written for people, not lawyers</span>
          </div>
        </section>

        <section className="privacy-summary" aria-label="Privacy commitments">
          {SUMMARY_ITEMS.map(({ icon: Icon, value, label }) => (
            <article key={value}>
              <span className="privacy-summary-icon"><Icon size={18} /></span>
              <div><strong>{value}</strong><p>{label}</p></div>
            </article>
          ))}
        </section>

        <section className="privacy-faq" id="frequently-asked-questions">
          <header className="privacy-section-heading">
            <span>Quick answers</span>
            <h2>Privacy, without the fine-print feeling.</h2>
            <p>The most important answers about your artwork and account data.</p>
          </header>
          <div className="privacy-faq-grid">
            {FAQ_ITEMS.map((item, index) => (
              <article key={item.question}>
                <span className="privacy-faq-index">0{index + 1}</span>
                <h3>{item.question}</h3><p>{item.answer}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="privacy-document-layout" aria-label="Official privacy policy">
          <article className="privacy-document">
            <header>
              <span><FileText size={16} /> Official policy</span>
              <h2>Privacy Policy</h2>
              <p>This policy explains what information DesaynClaw processes, why it is needed, and the controls available to you.</p>
            </header>

            <PolicySection number="01" id="files" title="Files and processing">
              <p>When you use DesaynClaw, we process the files you submit and the outputs created by the tools you choose. This may include source images, extracted artwork, upscaled images, transparent assets, SVG files, mockups, and export packages.</p>
              <ul>
                <li><Check size={14} /> Files are processed to deliver the requested service.</li>
                <li><Check size={14} /> Project data supports previews, history, downloads, and exports.</li>
                <li><Check size={14} /> Uploaded files are not sold or used for unrelated advertising.</li>
              </ul>
            </PolicySection>

            <PolicySection number="02" id="retention" title="Retention and deletion">
              <p>Original uploads, processed outputs, and vector files are kept in your project history for no longer than three days. Our scheduled cleanup system then permanently removes them from cloud storage. You may manually delete a project earlier when that control is available.</p>
            </PolicySection>

            <PolicySection number="03" id="ownership" title="Ownership and permitted use">
              <p>DesaynClaw does not claim ownership of your uploaded files or generated outputs. You retain the rights you hold in that content. You are responsible for having the necessary permission to process client artwork, trademarks, logos, characters, and copyrighted material.</p>
              <a className="privacy-inline-link" href="/copyright">Read our Copyright Policy <ArrowUpRight size={14} /></a>
            </PolicySection>

            <PolicySection number="04" id="account-data" title="Account and technical information">
              <p>When you sign in, we may retain basic profile details supplied by the authentication provider, such as your name, email address, and profile image. We also process usage records, project metadata, IP address, browser and device information, security events, and rate-limit data when needed to operate and protect the service. We never receive your Google password.</p>
            </PolicySection>

            <PolicySection number="05" id="payments" title="Payments and Claws">
              <p>We process the purchase and transaction information needed to verify payments, credit Claws, prevent fraud, and provide customer support. Payment providers may process billing details under their own privacy terms.</p>
              <a className="privacy-inline-link" href="/refunds">Review Refunds &amp; Payments <ArrowUpRight size={14} /></a>
            </PolicySection>

            <PolicySection number="06" id="providers" title="Infrastructure and service providers">
              <p>DesaynClaw uses trusted infrastructure, authentication, storage, processing, analytics, and payment providers where necessary to run the service. Access is limited to the operational purpose involved. We do not sell your personal information or uploaded artwork.</p>
            </PolicySection>

            <PolicySection number="07" id="choices" title="Your choices and contact">
              <p>You may delete eligible projects, stop using the service, or request help with account information. Contact us if you have a privacy question, deletion request, or concern about how your information is handled.</p>
              <a className="privacy-contact" href="https://m.me/105884602605306" target="_blank" rel="noreferrer">
                <span><MessageCircle size={17} /> Contact privacy support</span><ArrowUpRight size={16} />
              </a>
            </PolicySection>
          </article>
        </section>
      </main>

      <footer className="privacy-footer">
        <img src="/logo.png" alt="DesaynClaw" />
        <p>Private-by-default tools for real production work.</p>
        <nav aria-label="Legal links"><a href="/terms">Terms</a><a href="/refunds">Refunds</a><a href="/copyright">Copyright</a></nav>
      </footer>
    </div>
  );
}
