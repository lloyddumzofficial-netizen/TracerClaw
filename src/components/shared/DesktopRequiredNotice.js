"use client";

import { MonitorX, ArrowLeft, Monitor } from "lucide-react";
import { useRouter } from "next/navigation";

export default function DesktopRequiredNotice() {
  const router = useRouter();

  return (
    <div style={{
      minHeight: "100vh",
      width: "100%",
      background: "#161616",
      color: "#fff",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "24px",
      boxSizing: "border-box",
      textAlign: "center"
    }}>
      <div style={{ width: "100%", maxWidth: "420px" }}>
        <div style={{
          width: "82px",
          height: "82px",
          margin: "0 auto 22px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "rgba(255, 215, 0, 0.1)",
          border: "1px solid rgba(255, 215, 0, 0.28)"
        }}>
          <MonitorX size={42} color="#FFD700" />
        </div>

        <div style={{
          color: "#FFD700",
          fontSize: "11px",
          fontWeight: 800,
          letterSpacing: "1.8px",
          textTransform: "uppercase",
          marginBottom: "12px"
        }}>
          Desktop Required
        </div>

        <h1 style={{
          color: "#fff",
          fontSize: "28px",
          lineHeight: 1.1,
          margin: "0 0 14px",
          fontWeight: 850,
          letterSpacing: 0
        }}>
          Workspace tools are available on computer only.
        </h1>

        <p style={{
          color: "#aaa",
          fontSize: "14px",
          lineHeight: 1.65,
          margin: "0 auto 22px",
          maxWidth: "360px"
        }}>
          To avoid accidental processing and keep the editing experience reliable, DesaynClaw only opens the workspace, background remover, and upscale studio on desktop or laptop screens.
        </p>

        <div style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          padding: "13px 14px",
          marginBottom: "22px",
          background: "rgba(255,255,255,0.04)",
          border: "1px solid #333",
          color: "#d8d8d8",
          fontSize: "13px",
          lineHeight: 1.45,
          textAlign: "left"
        }}>
          <Monitor size={18} color="#FFD700" style={{ flexShrink: 0 }} />
          Use a desktop or laptop browser to upload, process, and download production files.
        </div>

        <button
          type="button"
          onClick={() => router.push("/")}
          style={{
            width: "100%",
            height: "44px",
            border: "1px solid #FFD700",
            background: "#FFD700",
            color: "#111",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
            fontSize: "12px",
            fontWeight: 800,
            textTransform: "uppercase",
            letterSpacing: "1px"
          }}
        >
          <ArrowLeft size={16} /> Back to Homepage
        </button>
      </div>
    </div>
  );
}
