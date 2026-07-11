"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft, CreditCard, AlertCircle, CheckCircle2, XCircle } from "lucide-react";
import "../globals.css";

export default function RefundPolicy() {
  const router = useRouter();

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#111", color: "#eee", padding: "40px 20px" }}>
      {/* Header */}
      <div style={{ maxWidth: "800px", margin: "0 auto", paddingBottom: "20px", borderBottom: "1px solid #333" }}>
        <button
          onClick={() => router.push("/")}
          style={{ display: "flex", alignItems: "center", gap: "8px", background: "transparent", color: "#aaa", border: "none", cursor: "pointer", padding: "0", fontSize: "14px", marginBottom: "30px", transition: "color 0.2s" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "#FFD700")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "#aaa")}
        >
          <ArrowLeft size={16} /> Back to Home
        </button>
        <h1 style={{ fontSize: "36px", margin: "0 0 10px 0", color: "#fff", display: "flex", alignItems: "center", gap: "12px" }}>
          <CreditCard color="#FFD700" size={36} /> Refund & Payment Policy
        </h1>
        <p style={{ color: "#888", fontSize: "14px", margin: "8px 0 0 0" }}>
          Last updated: July 2026 &nbsp;|&nbsp; Applies to all credit purchases on DESAYNBRO Auto-Tracer.
        </p>
      </div>

      {/* Body */}
      <div style={{ maxWidth: "800px", margin: "40px auto 100px auto", display: "flex", flexDirection: "column", gap: "32px", fontSize: "15px", lineHeight: "1.8", color: "#ccc" }}>

        {/* Summary Cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "16px" }}>
          <SummaryCard icon={<CheckCircle2 color="#22c55e" size={22} />} color="#22c55e" title="In-App Credit Refund" desc="Failed traces are automatically refunded back to your credit balance." />
          <SummaryCard icon={<AlertCircle color="#FFD700" size={22} />} color="#FFD700" title="Unused Credits" desc="Contact us within 7 days of purchase if you have not used any credits." />
          <SummaryCard icon={<XCircle color="#ef4444" size={22} />} color="#ef4444" title="Used Credits" desc="Credits that have been consumed for completed projects are non-refundable." />
        </div>

        {/* Section 1 */}
        <Section num="1" title="About Credits">
          Auto-Tracer operates on a prepaid <strong style={{ color: "#fff" }}>credit system</strong>. Each credit corresponds to one tracing or processing operation. Credits are purchased in advance and deducted from your balance when a project is successfully processed.
          <br /><br />
          Credits are <strong style={{ color: "#fff" }}>non-transferable</strong> between accounts and have <strong style={{ color: "#fff" }}>no expiry date</strong>.
        </Section>

        {/* Section 2 */}
        <Section num="2" title="Automatic In-App Refunds (Failed Traces)">
          If an AI tracing operation fails due to a server error, timeout, or any error on our end, <strong style={{ color: "#fff" }}>your credit is automatically returned</strong> to your balance. You do not need to contact us for this — it is handled automatically by our system.
          <br /><br />
          You may verify your credit balance at any time on the main dashboard.
        </Section>

        {/* Section 3 */}
        <Section num="3" title="Monetary Refund Eligibility (Cash Back)">
          <p style={{ margin: "0 0 16px 0" }}>Monetary refunds (back to your original payment method) are evaluated on a case-by-case basis, subject to these conditions:</p>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #333" }}>
                <th style={{ textAlign: "left", padding: "10px 12px", color: "#fff", fontWeight: "600", width: "50%" }}>Situation</th>
                <th style={{ textAlign: "left", padding: "10px 12px", color: "#fff", fontWeight: "600" }}>Refund Eligible?</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["Request within 7 days & 0 credits used", "✅ Yes — Full Refund"],
                ["Request within 7 days & some credits used", "⚠️ Partial — unused credits only"],
                ["Request after 7 days", "❌ No"],
                ["Credits consumed on completed projects", "❌ No"],
                ["Account terminated for ToS violation", "❌ No"],
              ].map(([sit, elig], i) => (
                <tr key={i} style={{ borderBottom: "1px solid #222", background: i % 2 === 0 ? "transparent" : "#161616" }}>
                  <td style={{ padding: "10px 12px", color: "#aaa" }}>{sit}</td>
                  <td style={{ padding: "10px 12px", color: "#ddd", fontWeight: "500" }}>{elig}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        {/* Section 4 */}
        <Section num="4" title="How to Request a Refund">
          To request a monetary refund, please contact us through our official Facebook page within the eligibility window. Include the following in your message:
          <ul style={{ paddingLeft: "20px", display: "flex", flexDirection: "column", gap: "8px", marginTop: "12px", color: "#aaa" }}>
            <li>Your registered email address (Google account used to log in).</li>
            <li>The date of purchase and the amount paid.</li>
            <li>The reason for your refund request.</li>
          </ul>
          <p style={{ marginTop: "16px", marginBottom: 0 }}>
            We aim to respond to all refund requests within <strong style={{ color: "#fff" }}>3–5 business days</strong>.
          </p>
        </Section>

        {/* Section 5 */}
        <Section num="5" title="Payment Processing">
          Payments are processed manually or through our approved payment channels (GCash, bank transfer, etc.). We do not store your payment credentials. All transactions are subject to the terms and fees of the respective payment provider.
        </Section>

        {/* Section 6 */}
        <Section num="6" title="Chargebacks & Disputes">
          Initiating an unauthorized chargeback with your bank or payment provider — before contacting us to resolve the issue — may result in the <strong style={{ color: "#fff" }}>permanent suspension</strong> of your account and forfeiture of all remaining credits. We strongly encourage you to reach out to us first; we are happy to resolve any payment concerns.
        </Section>

        {/* Section 7 */}
        <Section num="7" title="Governing Law">
          This policy is governed by the laws of the <strong style={{ color: "#fff" }}>Republic of the Philippines</strong>. In the event of any dispute relating to payments or refunds, parties agree to first attempt resolution through good-faith negotiation before pursuing any legal remedy.
        </Section>

        {/* CTA */}
        <div style={{ background: "rgba(255,215,0,0.05)", border: "1px solid rgba(255,215,0,0.2)", borderRadius: "12px", padding: "24px", textAlign: "center" }}>
          <p style={{ margin: "0 0 16px 0", color: "#ddd" }}>Have a question about a payment or refund?</p>
          <a
            href="https://m.me/105884602605306"
            target="_blank"
            rel="noreferrer"
            style={{ display: "inline-block", background: "#FFD700", color: "#000", padding: "12px 28px", borderRadius: "8px", fontWeight: "700", textDecoration: "none", fontSize: "14px", letterSpacing: "0.5px" }}
          >
            Contact Us on Facebook
          </a>
        </div>

      </div>
    </div>
  );
}

function SummaryCard({ icon, color, title, desc }) {
  return (
    <div style={{ background: "#1a1a1a", border: `1px solid #2a2a2a`, borderTop: `3px solid ${color}`, borderRadius: "12px", padding: "20px" }}>
      <div style={{ marginBottom: "10px" }}>{icon}</div>
      <div style={{ color: "#fff", fontWeight: "600", fontSize: "14px", marginBottom: "6px" }}>{title}</div>
      <div style={{ color: "#888", fontSize: "13px", lineHeight: "1.6" }}>{desc}</div>
    </div>
  );
}

function Section({ num, title, children }) {
  return (
    <div style={{ borderLeft: "3px solid #2a2a2a", paddingLeft: "24px" }}>
      <div style={{ color: "#FFD700", fontSize: "12px", textTransform: "uppercase", letterSpacing: "2px", fontWeight: "700", marginBottom: "8px" }}>
        Section {num}
      </div>
      <h2 style={{ color: "#fff", fontSize: "20px", margin: "0 0 16px 0", fontWeight: "600" }}>{title}</h2>
      <div style={{ color: "#aaa", lineHeight: "1.8" }}>{children}</div>
    </div>
  );
}
