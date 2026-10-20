import Link from "next/link";
import { ArrowLeft, ArrowUpRight, Check, FileText, Scale, ShieldCheck, UserRoundCheck } from "lucide-react";
import "../legal-policy.css";

const SUMMARY = [
  { icon: UserRoundCheck, title: "Authorized use", text: "Only process artwork you own or are permitted to use." },
  { icon: ShieldCheck, title: "Your content", text: "DesaynClaw does not claim ownership of uploaded files." },
  { icon: Scale, title: "Philippine law", text: "These terms are governed by the laws of the Philippines." },
];

function Section({ number, id, title, children }) {
  return <section className="legal-section" id={id}><div className="legal-section-number">{number}</div><div><h2>{title}</h2>{children}</div></section>;
}

export default function TermsOfService() {
  return (
    <div className="legal-page">
      <header className="legal-topbar">
        <Link className="legal-brand" href="/"><img src="/logo.png" alt="DesaynClaw" /></Link>
        <Link className="legal-back" href="/"><ArrowLeft size={15} /> Back to home</Link>
      </header>
      <main>
        <section className="legal-hero">
          <div className="legal-kicker"><Scale size={14} /> Terms &amp; conditions</div>
          <h1>Clear terms for serious production work.</h1>
          <p>The rules that protect you, your clients, and the DesaynClaw production platform.</p>
          <div className="legal-meta"><span>Last updated October 15, 2026</span><i /><span>Effective when you use the service</span></div>
        </section>
        <section className="legal-summary" aria-label="Terms overview">
          {SUMMARY.map(({ icon: Icon, title, text }) => <article key={title}><span className="legal-summary-icon"><Icon size={18} /></span><div><strong>{title}</strong><p>{text}</p></div></article>)}
        </section>
        <section className="legal-layout">
          <article className="legal-document">
            <header><span><FileText size={16}/> Official agreement</span><h2>Terms of Service</h2><p>By creating an account, uploading a file, purchasing Claws, or otherwise using DesaynClaw, you agree to these Terms.</p></header>
            <Section number="01" id="acceptance" title="Acceptance and eligibility"><p>You must be at least 18 years old, or have permission from a parent or legal guardian, to use the service. If you do not agree to these Terms or our Privacy Policy, do not use DesaynClaw.</p></Section>
            <Section number="02" id="service" title="Description of the service"><p>DesaynClaw provides tools for artwork extraction, raster-to-vector conversion, image upscaling, background removal, mockup generation, storage, project review, and export. Features may be changed, improved, suspended, or discontinued as the product evolves.</p></Section>
            <Section number="03" id="responsibilities" title="User responsibilities and prohibited conduct"><p>You are responsible for every file you upload, process, export, or use. You must own the artwork or have sufficient authorization from the relevant client, copyright owner, trademark owner, brand, team, school, or business.</p><ul><li><Check size={14}/>Do not process or commercially exploit protected content without authorization.</li><li><Check size={14}/>Do not create counterfeit goods or impersonate a creator, brand, organization, or rights holder.</li><li><Check size={14}/>Do not upload illegal, harmful, malicious, sexually explicit, threatening, or defamatory material.</li><li><Check size={14}/>Do not bypass security, manipulate the Claw system, overload the service, or introduce harmful code.</li></ul><p>We may remove content, restrict features, suspend accounts, or terminate access when these rules are violated.</p></Section>
            <Section number="04" id="ownership" title="Content ownership and intellectual property"><p>You retain the rights you already hold in uploaded files and generated outputs. DesaynClaw does not claim ownership. By uploading content, you grant us a limited, non-exclusive license to process, store, display, export, and delete that content only as needed to provide the service.</p><p>Using DesaynClaw does not create or transfer copyright, trademark, merchandising, reproduction, resale, or commercial-use rights in material you do not own.</p><Link className="legal-inline-link" href="/copyright">Read the Copyright Policy <ArrowUpRight size={14}/></Link></Section>
            <Section number="05" id="credits" title="Claws, purchases, and refunds"><p>DesaynClaw uses prepaid Claws for eligible processing actions. Prices, usage requirements, and package availability may change. Completed operations consume the displayed number of Claws; eligible failed operations may be returned automatically.</p><Link className="legal-inline-link" href="/refunds">Review Refunds &amp; Payments <ArrowUpRight size={14}/></Link></Section>
            <Section number="06" id="liability" title="Disclaimers and limitation of liability"><p><strong>To the maximum extent permitted by law,</strong> DesaynClaw is provided “as is” and “as available.” We do not guarantee uninterrupted access, error-free processing, a specific creative result, or suitability for a particular production method.</p><p>DesaynClaw, DesaynBro, and their team will not be liable for indirect, incidental, special, consequential, or punitive loss arising from use of the service, including lost profits, production delays, data loss, or loss of goodwill.</p></Section>
            <Section number="07" id="availability" title="Availability, maintenance, and data retention"><p>Scheduled or emergency maintenance may temporarily interrupt the service. Project files are designed for short-term workflow access and may be automatically deleted under the retention period described in our Privacy Policy. Keep independent copies of files you need for production.</p></Section>
            <Section number="08" id="law" title="Governing law"><p>These Terms are governed by the laws of the Republic of the Philippines. Any dispute that cannot be resolved in good faith will be subject to the appropriate courts of the Philippines.</p></Section>
            <Section number="09" id="changes" title="Changes and contact"><p>We may update these Terms to reflect changes in the service, law, security requirements, or business operations. Material changes will be communicated through the website or a revised “Last updated” date. Continued use after an update means you accept the revised Terms.</p><a className="legal-inline-link" href="https://m.me/105884602605306" target="_blank" rel="noreferrer">Contact DesaynClaw <ArrowUpRight size={14}/></a></Section>
          </article>
        </section>
      </main>
      <footer className="legal-footer"><img src="/logo.png" alt="DesaynClaw"/><p>Professional tools. Clear responsibilities.</p><nav><Link href="/privacy">Privacy</Link><Link href="/refunds">Refunds</Link><Link href="/copyright">Copyright</Link></nav></footer>
    </div>
  );
}
