"use client";

import { useEffect, useState } from "react";
import { MonitorX } from "lucide-react";

export default function MobileWarning() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 768);
    };

    // Check immediately on mount
    checkMobile();

    // Listen to resize
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  if (!isMobile) return null;

  return (
    <div style={{
      position: "fixed",
      inset: 0,
      backgroundColor: "#161616",
      zIndex: 999999,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: "30px",
      textAlign: "center",
      color: "#fff"
    }}>
      <div style={{
        background: "rgba(255, 215, 0, 0.1)",
        padding: "20px",
        borderRadius: "50%",
        marginBottom: "24px"
      }}>
        <MonitorX size={48} color="#FFD700" />
      </div>
      
      <h2 style={{ fontSize: "24px", fontWeight: "bold", marginBottom: "16px", color: "#fff" }}>
        Desktop Required
      </h2>
      
      <p style={{ fontSize: "16px", color: "#aaa", lineHeight: "1.6", maxWidth: "400px" }}>
        DesaynClaw features a professional "Infinite Canvas" workspace that relies on <strong>Left Click + Drag</strong> to pan and navigate.
      </p>
      
      <div style={{ 
        marginTop: "30px", 
        padding: "16px", 
        background: "rgba(255,255,255,0.05)", 
        border: "1px solid #333", 
        borderRadius: "8px",
        fontSize: "14px",
        color: "#ccc"
      }}>
        Please switch to a computer or laptop for the best experience.
      </div>
    </div>
  );
}
