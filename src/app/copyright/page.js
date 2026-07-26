"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import "../globals.css";

export default function CopyrightPolicy() {
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
          <ShieldAlert color="#FFD700" size={36} /> Copyright Policy
        </h1>
        <p style={{ color: "#888", fontSize: "14px", margin: "8px 0 0 0" }}>
          Last updated: July 2026 &nbsp;|&nbsp; Applies to uploaded content and generated output.
        </p>
      </div>

      {/* Body */}
      <div style={{ maxWidth: "800px", margin: "40px auto 100px auto", display: "flex", flexDirection: "column", gap: "36px", fontSize: "15px", lineHeight: "1.8", color: "#ccc" }}>

        {/* Intro */}
        <div style={{ background: "#1a1a1a", padding: "24px", borderRadius: "12px", border: "1px solid #2a2a2a" }}>
          <p style={{ margin: 0, color: "#aaa" }}>
            DesaynClaw is an AI processing tool for user-supplied artwork. This policy explains how copyright and intellectual property rights apply when you upload, process, export, or use content through the Service.
          </p>
        </div>

        <Section num="1" title="User Responsibility">
          Users are responsible for every file they upload. You must own the artwork or have sufficient authorization from the copyright owner, trademark owner, client, brand, team, school, business, or other rights holder before processing it with DesaynClaw.
        </Section>

        <Section num="2" title="No Rights Transfer">
          Using DesaynClaw does not transfer, create, or grant copyright, trademark, reproduction, merchandising, resale, distribution, or commercial exploitation rights over uploaded content or generated output.
        </Section>

        <Section num="3" title="Ownership of Uploaded Content">
          DesaynClaw does not claim ownership of uploaded content. We process uploaded files only to provide the requested service, subject to our Terms of Service and Privacy Policy.
        </Section>

        <Section num="4" title="Unauthorized Content">
          You may not upload, process, reproduce, sell, distribute, or commercially exploit copyrighted or trademarked content without authorization. This includes copied artwork, brand marks, team logos, school marks, character art, artist work, and client files you are not authorized to use.
        </Section>

        <Section num="5" title="Enforcement">
          DesaynClaw may remove content that appears to violate intellectual property rights. Accounts may be limited, suspended, or terminated for repeated infringement or serious copyright or trademark violations.
        </Section>

        <Section num="6" title="Copyright Complaints">
          If you believe content processed or displayed through DesaynClaw infringes your rights, please review our Copyright Takedown Request page and contact us with the requested details.
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
