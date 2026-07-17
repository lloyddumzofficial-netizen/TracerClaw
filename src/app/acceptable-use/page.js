"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import "../globals.css";

export default function AcceptableUsePolicy() {
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
          <ShieldAlert color="#FFD700" size={36} /> Acceptable Use Policy
        </h1>
        <p style={{ color: "#888", fontSize: "14px", margin: "8px 0 0 0" }}>
          Last updated: July 2026 &nbsp;|&nbsp; Applies to all use of DesaynClaw.
        </p>
      </div>

      {/* Body */}
      <div style={{ maxWidth: "800px", margin: "40px auto 100px auto", display: "flex", flexDirection: "column", gap: "36px", fontSize: "15px", lineHeight: "1.8", color: "#ccc" }}>

        {/* Intro */}
        <div style={{ background: "#1a1a1a", padding: "24px", borderRadius: "12px", border: "1px solid #2a2a2a" }}>
          <p style={{ margin: 0, color: "#aaa" }}>
            This Acceptable Use Policy helps keep DesaynClaw safe, lawful, and respectful of creators, brands, businesses, clients, and rights holders.
          </p>
        </div>

        <Section num="1" title="Authorized Artwork Only">
          You may use DesaynClaw only for artwork you own, created, licensed, commissioned, or are otherwise authorized to process.
        </Section>

        <Section num="2" title="Prohibited Intellectual Property Use">
          You may not upload, process, export, sell, or distribute stolen artwork, unauthorized copyrighted content, trademark-infringing content, brand marks, team logos, school marks, artist work, or client files without permission.
        </Section>

        <Section num="3" title="Counterfeit and Misleading Products">
          You may not use DesaynClaw to create counterfeit products, unauthorized merchandise, fake brand assets, misleading product designs, or materials that impersonate an artist, brand, business, team, school, copyright owner, or trademark owner.
        </Section>

        <Section num="4" title="Illegal or Abusive Content">
          You may not use the Service for illegal, harmful, abusive, threatening, defamatory, sexually exploitative, hateful, malware-related, fraudulent, or otherwise unlawful content.
        </Section>

        <Section num="5" title="Platform Abuse">
          You may not abuse credits, automate requests to avoid limits, attack the Service, bypass security controls, interfere with other users, or attempt to access files or projects that do not belong to you.
        </Section>

        <Section num="6" title="Enforcement">
          We may refuse processing, remove content, limit access, suspend accounts, or terminate accounts for violations of this policy or repeated infringement complaints.
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
