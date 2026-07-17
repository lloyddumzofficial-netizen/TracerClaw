"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import "../globals.css";

export default function CopyrightTakedownRequest() {
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
          <ShieldAlert color="#FFD700" size={36} /> Copyright Takedown Request
        </h1>
        <p style={{ color: "#888", fontSize: "14px", margin: "8px 0 0 0" }}>
          Last updated: July 2026 &nbsp;|&nbsp; Information for rights holders and authorized agents.
        </p>
      </div>

      {/* Body */}
      <div style={{ maxWidth: "800px", margin: "40px auto 100px auto", display: "flex", flexDirection: "column", gap: "36px", fontSize: "15px", lineHeight: "1.8", color: "#ccc" }}>

        {/* Intro */}
        <div style={{ background: "#1a1a1a", padding: "24px", borderRadius: "12px", border: "1px solid #2a2a2a" }}>
          <p style={{ margin: 0, color: "#aaa" }}>
            If you believe content processed, stored, or displayed through DesaynClaw infringes your copyright or trademark rights, please contact us with the details below so we can review the request.
          </p>
        </div>

        <Section num="1" title="Information to Include">
          <ul style={{ paddingLeft: "20px", display: "flex", flexDirection: "column", gap: "8px", color: "#aaa", margin: 0 }}>
            <li>Your full name and company or organization, if applicable.</li>
            <li>Your email address and preferred contact method.</li>
            <li>A description of the copyrighted work or trademark you believe is being infringed.</li>
            <li>A description or URL of the reported material.</li>
            <li>Proof that you own the work or are authorized to act for the rights holder.</li>
            <li>A statement that you have a good faith belief that the reported use is not authorized by the rights holder, its agent, or the law.</li>
            <li>A statement that the information you provide is accurate and that you are the owner or authorized to act on behalf of the owner.</li>
            <li>Your electronic signature.</li>
          </ul>
        </Section>

        <Section num="2" title="Where to Send Requests">
          Send copyright or trademark complaints through our official Facebook support channel or any official DesaynClaw contact channel listed on the website. Please include &ldquo;Copyright Takedown Request&rdquo; in your message.
        </Section>

        <Section num="3" title="Review Process">
          We may request additional information to verify ownership, authorization, or the location of the reported material. If a request appears valid, we may remove or restrict access to the reported content and may notify the affected user.
        </Section>

        <Section num="4" title="False or Incomplete Requests">
          Submitting false, misleading, or incomplete complaints may delay review. Only submit a takedown request if you are the rights holder or are authorized to act on behalf of the rights holder.
        </Section>

      </div>
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
