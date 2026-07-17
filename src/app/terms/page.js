"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import "../globals.css";

export default function TermsOfService() {
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
          <ShieldAlert color="#FFD700" size={36} /> Terms of Service
        </h1>
        <p style={{ color: "#888", fontSize: "14px", margin: "8px 0 0 0" }}>
          Last updated: July 2026 &nbsp;|&nbsp; Effective immediately upon use of the Service.
        </p>
      </div>

      {/* Body */}
      <div style={{ maxWidth: "800px", margin: "40px auto 100px auto", display: "flex", flexDirection: "column", gap: "36px", fontSize: "15px", lineHeight: "1.8", color: "#ccc" }}>

        {/* Intro */}
        <div style={{ background: "#1a1a1a", padding: "24px", borderRadius: "12px", border: "1px solid #2a2a2a" }}>
          <p style={{ margin: 0, color: "#aaa" }}>
            Welcome to <strong style={{ color: "#fff" }}>DESAYNBRO Auto-Tracer</strong> (&ldquo;the Service&rdquo;), operated by DesaynBro (&ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;). By accessing or using our website or any of our services, you agree to be bound by these Terms of Service (&ldquo;Terms&rdquo;). If you do not agree to these Terms, you must immediately cease use of the Service.
          </p>
        </div>

        <Section num="1" title="Acceptance of Terms">
          By creating an account or using the Service in any way &mdash; including uploading an image, consuming credits, or browsing the site &mdash; you confirm that you are at least 18 years old, or have the legal consent of a parent or guardian, and that you agree to these Terms and our Privacy Policy.
        </Section>

        <Section num="2" title="Description of Service">
          Auto-Tracer provides an AI-powered raster-to-vector conversion tool. We reserve the right to modify, suspend, or discontinue any part of the Service at any time, with or without notice. We shall not be liable to you or any third party for any such modification, suspension, or discontinuation.
        </Section>

        <Section num="3" title="User Responsibilities & Prohibited Conduct">
          <p style={{ margin: "0 0 12px 0" }}>
            You are responsible for every file you upload, process, export, or use through the Service. You must own the artwork or have sufficient authorization from the copyright owner, trademark owner, client, brand, team, school, business, or other rights holder before using DesaynClaw.
          </p>
          <p style={{ margin: "0 0 12px 0" }}>You agree that you will NOT use the Service to upload, process, or distribute any content that:</p>
          <ul style={{ paddingLeft: "20px", display: "flex", flexDirection: "column", gap: "8px", color: "#aaa", margin: 0 }}>
            <li>Infringes upon the intellectual property rights of any third party.</li>
            <li>Copies, recreates, reproduces, sells, distributes, or commercially exploits copyrighted or trademarked content without authorization.</li>
            <li>Creates counterfeit products, unauthorized brand merchandise, or materials that impersonate an artist, brand, business, team, school, or copyright owner.</li>
            <li>Is illegal, obscene, sexually explicit, threatening, defamatory, or otherwise objectionable.</li>
            <li>Contains malware, viruses, or any other harmful code.</li>
            <li>Attempts to circumvent any security measures or abuse the credit system.</li>
            <li>Violates any applicable local, national, or international laws or regulations.</li>
          </ul>
          <p style={{ marginTop: "16px", marginBottom: 0 }}>
            We reserve the right to terminate your account and forfeit any remaining credits without refund if you are found to be in violation of this section.
          </p>
        </Section>

        <Section num="4" title="Intellectual Property & Content Ownership">
          You retain full copyright and intellectual property ownership over all images you upload and all vector outputs you generate using the Service. By uploading content, you grant us a limited, non-exclusive, royalty-free license solely to process the file in order to provide the Service to you. This license is automatically revoked upon deletion of your files or project.
          <br /><br />
          We do not claim ownership of your content. We do not use your uploaded images to train AI models. However, using the Service does not transfer, create, or grant any copyright, trademark, reproduction, merchandising, resale, distribution, or commercial exploitation rights over uploaded content or generated output.
          <br /><br />
          We may remove content that appears to violate intellectual property rights, and we may suspend or terminate accounts for repeated infringement or serious violations of these Terms.
        </Section>

        <Section num="5" title="Limitation of Liability">
          <strong style={{ color: "#fff" }}>TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW,</strong> the Service is provided &ldquo;AS IS&rdquo; and &ldquo;AS AVAILABLE&rdquo; without any warranty of any kind. We do not warrant that:
          <ul style={{ paddingLeft: "20px", display: "flex", flexDirection: "column", gap: "8px", marginTop: "12px", color: "#aaa" }}>
            <li>The Service will be uninterrupted, timely, secure, or error-free.</li>
            <li>Any specific output quality, resolution, or accuracy of the vector conversion is guaranteed.</li>
            <li>Your data will be retained for any specific period of time.</li>
          </ul>
          <p style={{ marginTop: "16px", marginBottom: 0 }}>
            In no event shall DesaynBro, its directors, employees, or affiliates be liable for any indirect, incidental, special, consequential, or punitive damages &mdash; including but not limited to loss of profits, data, or goodwill &mdash; arising from your use of, or inability to use, the Service.
          </p>
        </Section>

        <Section num="6" title="Service Interruptions & Maintenance">
          We reserve the right to perform scheduled or emergency maintenance at any time without prior notice. During maintenance, the Service may be temporarily unavailable. We shall have no liability for any interruption or delay in the Service.
        </Section>

        <Section num="7" title="Governing Law">
          These Terms shall be governed by and construed in accordance with the laws of the Republic of the Philippines. Any disputes arising out of or in connection with these Terms shall be subject to the exclusive jurisdiction of the courts of the Philippines.
        </Section>

        <Section num="8" title="Changes to Terms">
          We reserve the right to update these Terms at any time. We will notify users of significant changes by posting a notice on our website or updating the &ldquo;Last Updated&rdquo; date at the top of this page. Continued use of the Service after any changes constitutes your acceptance of the new Terms.
        </Section>

        <Section num="9" title="Contact">
          If you have any questions about these Terms, please contact us through our official Facebook page or any official DesaynBro contact channel.
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
