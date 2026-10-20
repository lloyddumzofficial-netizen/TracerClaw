import Link from "next/link";
import { AlertCircle, ArrowLeft, ArrowUpRight, Check, CheckCircle2, Clock3, CreditCard, FileText, MessageCircle, RotateCcw, XCircle } from "lucide-react";
import "../legal-policy.css";

const SUMMARY = [
  { icon: RotateCcw, title: "Failed jobs", text: "Eligible processing failures return Claws automatically." },
  { icon: Clock3, title: "7-day window", text: "Unused purchases may qualify when requested promptly." },
  { icon: CreditCard, title: "Used Claws", text: "Completed processing operations are non-refundable." },
];

const eligibility = [
  ["Request within 7 days with no Claws used", "Full refund review", "is-yes", CheckCircle2],
  ["Request within 7 days with some Claws used", "Unused portion only", "is-limited", AlertCircle],
  ["Request submitted after 7 days", "Not eligible", "is-no", XCircle],
  ["Claws consumed by completed projects", "Not eligible", "is-no", XCircle],
  ["Account terminated for a Terms violation", "Not eligible", "is-no", XCircle],
];

function Section({ number, id, title, children }) {
  return <section className="legal-section" id={id}><div className="legal-section-number">{number}</div><div><h2>{title}</h2>{children}</div></section>;
}

export default function RefundPolicy() {
  return (
    <div className="legal-page">
      <header className="legal-topbar">
        <Link className="legal-brand" href="/"><img src="/logo.png" alt="DesaynClaw" /></Link>
        <Link className="legal-back" href="/"><ArrowLeft size={15}/> Back to home</Link>
      </header>
      <main>
        <section className="legal-hero">
          <div className="legal-kicker"><CreditCard size={14}/> Refunds &amp; payments</div>
          <h1>Straightforward refunds. No guesswork.</h1>
          <p>How failed-job returns, unused Claws, payment reviews, and monetary refund requests are handled.</p>
          <div className="legal-meta"><span>Last updated October 15, 2026</span><i/><span>Applies to all Claw purchases</span></div>
        </section>
        <section className="legal-summary" aria-label="Refund overview">
          {SUMMARY.map(({icon:Icon,title,text})=><article key={title}><span className="legal-summary-icon"><Icon size={18}/></span><div><strong>{title}</strong><p>{text}</p></div></article>)}
        </section>
        <section className="legal-layout">
          <article className="legal-document">
            <header><span><FileText size={16}/> Official policy</span><h2>Refund &amp; Payment Policy</h2><p>This policy explains when Claws are returned automatically and when a monetary refund may be reviewed.</p></header>
            <Section number="01" id="claws" title="About Claws"><p>DesaynClaw operates on a prepaid Claw system. Each eligible tool displays its processing cost before you continue. Claws are deducted when a processing request is accepted or completed under the applicable workflow.</p><ul><li><Check size={14}/>Claws are assigned to the account used for purchase.</li><li><Check size={14}/>Claws cannot be transferred between accounts.</li><li><Check size={14}/>Purchased Claws currently have no scheduled expiration date.</li></ul></Section>
            <Section number="02" id="automatic" title="Automatic in-app returns for failed jobs"><p>If an eligible operation fails because of a server error, provider failure, or timeout recorded by our system, the charged Claw is returned automatically to your balance. No separate request is normally required. A visible output that completed successfully is not treated as a failed job solely because the creative result did not match personal preference.</p></Section>
            <Section number="03" id="eligibility" title="Monetary refund eligibility"><p>Cash refunds to the original payment method are reviewed case by case. Provider fees, settlement status, fraud checks, and the number of Claws already consumed may affect the refundable amount.</p><div className="legal-eligibility">{eligibility.map(([situation,result,state,Icon])=><div className={`legal-eligibility-row ${state}`} key={situation}><span>{situation}</span><strong><Icon size={14}/>{result}</strong></div>)}</div></Section>
            <Section number="04" id="request" title="How to request a monetary refund"><p>Contact official DesaynClaw support within the eligibility window. Include the email address used to sign in, purchase date, amount paid, payment reference when available, and a short reason for the request.</p><p>We aim to review complete requests within <strong>three to five business days</strong>. Your bank or payment provider may require additional time to post an approved refund.</p></Section>
            <Section number="05" id="processing" title="Payment processing"><p>Payments may be handled by approved providers supporting QR Ph, cards, GCash, Maya, or other available methods. DesaynClaw does not store your full payment credentials. Provider processing times, fees, and verification requirements may apply.</p></Section>
            <Section number="06" id="disputes" title="Chargebacks, fraud, and disputes"><p>Please contact us before opening a chargeback so we can investigate the transaction. Fraudulent or abusive disputes may lead to account restrictions, reversal of credited Claws, or suspension—particularly when connected to payment fraud, platform abuse, or violations of the Terms of Service.</p></Section>
            <Section number="07" id="law" title="Governing law"><p>This policy is governed by the laws of the Republic of the Philippines. The parties should first attempt to resolve payment and refund concerns through good-faith communication before pursuing another remedy.</p></Section>
            <div className="legal-contact"><div className="legal-contact-copy"><span className="legal-contact-icon"><MessageCircle size={18}/></span><div><h3>Need help with a payment?</h3><p>Send the transaction details to official support and we’ll review the issue with you.</p></div></div><a href="https://m.me/105884602605306" target="_blank" rel="noreferrer">Contact support <ArrowUpRight size={14}/></a></div>
          </article>
        </section>
      </main>
      <footer className="legal-footer"><img src="/logo.png" alt="DesaynClaw"/><p>Transparent rules for every Claw purchase.</p><nav><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><Link href="/copyright">Copyright</Link></nav></footer>
    </div>
  );
}
