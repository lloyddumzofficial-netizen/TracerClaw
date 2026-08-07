"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import { safeJson } from "@/lib/safeJson";

import "../../globals.css";
import "../../home.css";

const DEFAULT_RECIPIENT = "lloyddumzofficial@gmail.com";
const ADMIN_EMAIL = "lloyddumzofficial@gmail.com";

export default function AdminSendEmailPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState("");
  const [to, setTo] = useState(DEFAULT_RECIPIENT);
  const [subject, setSubject] = useState("Your Claws Have Been Added to Your Account");
  const [message, setMessage] = useState(
    "Hi [User Name],\n\nThank you for reaching out, and sorry for the delay in adding the claws to your account.\n\nWe reviewed your report and confirmed that your claws have now been successfully added.\n\nAccount Email: [user@email.com]\nClaws Added: [number of claws] claws\nDate Added: [Month Day, Year]\nStatus: Completed\n\nYou may now refresh your account or log in again to check your updated claws balance.\n\nThank you for your patience, and sorry again for the inconvenience.\n\nBest regards,\nDesaynClaw Support"
  );
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);

  const [supabase] = useState(() => createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ));

  useEffect(() => {
    const checkAdmin = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session || session.user.email !== ADMIN_EMAIL) {
        router.push("/");
        return;
      }

      setToken(session.access_token);
      setLoading(false);
    };

    checkAdmin();
  }, [router, supabase]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSending(true);
    setResult(null);

    try {
      const response = await fetch("/api/admin/send-email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          to,
          subject,
          template: "support",
          message,
        }),
      });

      const data = await safeJson(response, "Failed to send email");
      setResult({
        ok: response.ok && data.success,
        message: response.ok && data.success
          ? `Email sent successfully${data.id ? ` (${data.id})` : ""}.`
          : data.error || "Failed to send email.",
      });
    } catch (error) {
      setResult({ ok: false, message: error.message || "Failed to send email." });
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <div className="start-screen-container" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: "#FFD700", fontSize: "14px", fontWeight: "500" }}>Loading Admin Email Sender...</div>
      </div>
    );
  }

  return (
    <div className="start-screen-container">
      <div className="start-center-box" style={{ maxWidth: "560px", marginTop: "20px" }}>
        <div className="start-logo" style={{ marginBottom: "24px", display: "flex", flexDirection: "column", alignItems: "center", width: "100%" }}>
          <img src="/logo.png" alt="DesaynClaw Logo" style={{ width: "280px", maxWidth: "100%", height: "auto", margin: 0, cursor: "pointer" }} onClick={() => router.push("/admin")} />
          <p style={{ fontSize: "14px", color: "#FFD700", margin: "8px 0 0 0", fontWeight: "600", textTransform: "uppercase", letterSpacing: "1px" }}>
            Send Email
          </p>
        </div>

        <form onSubmit={handleSubmit} style={{ width: "100%", display: "flex", flexDirection: "column", gap: "16px" }}>
          <label style={{ color: "#aaa", fontSize: "13px", fontWeight: 600 }}>
            Recipient Email
            <input
              type="email"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              required
              style={{ width: "100%", marginTop: "8px", padding: "12px", background: "#1a1a1a", color: "#fff", border: "1px solid #444", borderRadius: "4px", boxSizing: "border-box" }}
            />
          </label>

          <label style={{ color: "#aaa", fontSize: "13px", fontWeight: 600 }}>
            Subject
            <input
              type="text"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              required
              style={{ width: "100%", marginTop: "8px", padding: "12px", background: "#1a1a1a", color: "#fff", border: "1px solid #444", borderRadius: "4px", boxSizing: "border-box" }}
            />
          </label>

          <label style={{ color: "#aaa", fontSize: "13px", fontWeight: 600 }}>
            Message
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              required
              rows={8}
              style={{ width: "100%", marginTop: "8px", padding: "12px", background: "#1a1a1a", color: "#fff", border: "1px solid #444", borderRadius: "4px", boxSizing: "border-box", resize: "vertical", lineHeight: 1.5 }}
            />
          </label>

          <button className="start-btn" type="submit" disabled={sending} style={{ width: "100%", opacity: sending ? 0.7 : 1 }}>
            {sending ? "Sending..." : "Send Email"}
          </button>
        </form>

        {result && (
          <p style={{ marginTop: "18px", color: result.ok ? "#4ade80" : "#ff6b6b", fontSize: "14px", textAlign: "center", lineHeight: 1.5 }}>
            {result.message}
          </p>
        )}
      </div>
    </div>
  );
}
