"use client";

import { useEffect, useState, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Camera, Upload, CheckCircle2, Loader2, Image as ImageIcon } from "lucide-react";

export default function MobileUpload() {
  const searchParams = useSearchParams();
  const syncSessionId = searchParams.get("sync");
  const [status, setStatus] = useState("idle"); // idle | uploading | success | error
  const [errorMsg, setErrorMsg] = useState("");
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (!syncSessionId) {
      setStatus("error");
      setErrorMsg("Invalid or missing Sync Session ID. Please scan the QR code again.");
    }
  }, [syncSessionId]);

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setStatus("uploading");
      
      // 1. Get presigned URL via our new route
      const res = await fetch("/api/upload-mobile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: file.name,
          contentType: file.type,
          syncSessionId: syncSessionId
        })
      });

      if (!res.ok) {
        throw new Error("Failed to get upload URL");
      }

      const { uploadUrl, fileUrl } = await res.json();

      // 2. Upload file to R2 directly
      const uploadRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });

      if (!uploadRes.ok) {
        throw new Error("Failed to upload image to cloud storage");
      }

      // 3. Send Supabase Broadcast to the PC
      const channel = supabase.channel(`mobile_sync_${syncSessionId}`);
      await channel.send({
        type: "broadcast",
        event: "image_uploaded",
        payload: { imageUrl: fileUrl }
      });
      
      // We don't really need to listen, but we clean up anyway
      await supabase.removeChannel(channel);

      setStatus("success");
    } catch (err) {
      console.error(err);
      setStatus("error");
      setErrorMsg(err.message || "An error occurred during upload.");
    }
  };

  if (!syncSessionId) {
    return (
      <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#111", color: "#fff", padding: "20px", textAlign: "center" }}>
        <h2>Invalid Link</h2>
        <p>Please scan the QR code from your PC screen.</p>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0a", color: "#fff", display: "flex", flexDirection: "column", padding: "24px" }}>
      
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", marginBottom: "40px", marginTop: "20px" }}>
        <img src="/nav bar logo.png" alt="DesaynClaw Logo" style={{ height: "32px", width: "auto" }} />
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        
        {status === "idle" && (
          <div style={{ textAlign: "center", width: "100%" }}>
            <h1 style={{ fontSize: "28px", fontWeight: "800", marginBottom: "12px", letterSpacing: "-0.5px" }}>Take a Photo</h1>
            <p style={{ color: "#aaa", fontSize: "16px", marginBottom: "40px", lineHeight: "1.5" }}>
              Snap a picture of the logo or business card. It will instantly appear on your PC.
            </p>

            <button 
              onClick={() => fileInputRef.current.click()}
              style={{
                background: "linear-gradient(135deg, #FFD700 0%, #E5B800 100%)",
                border: "none",
                width: "140px",
                height: "140px",
                borderRadius: "50%",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: "12px",
                margin: "0 auto",
                cursor: "pointer",
                boxShadow: "0 15px 35px rgba(255,215,0,0.3)",
                color: "#000"
              }}
            >
              <Camera size={48} strokeWidth={1.5} />
              <span style={{ fontWeight: "700", fontSize: "15px" }}>OPEN CAMERA</span>
            </button>

            <div style={{ marginTop: "30px" }}>
              <button 
                onClick={() => {
                  fileInputRef.current.removeAttribute('capture');
                  fileInputRef.current.click();
                  fileInputRef.current.setAttribute('capture', 'environment');
                }}
                style={{
                  background: "transparent",
                  border: "1px solid #333",
                  color: "#ddd",
                  padding: "12px 24px",
                  borderRadius: "24px",
                  fontSize: "14px",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "8px",
                  cursor: "pointer"
                }}
              >
                <ImageIcon size={16} /> or choose from gallery
              </button>
            </div>
          </div>
        )}

        {status === "uploading" && (
          <div style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: "20px" }}>
            <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div style={{ position: "absolute", width: "100px", height: "100px", border: "4px solid rgba(255,215,0,0.2)", borderRadius: "50%" }}></div>
              <Loader2 size={48} color="#FFD700" className="animate-spin" />
            </div>
            <h2 style={{ margin: 0, fontSize: "24px", fontWeight: "700" }}>Sending to PC...</h2>
            <p style={{ color: "#aaa", margin: 0 }}>Please keep this page open.</p>
          </div>
        )}

        {status === "success" && (
          <div style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: "16px" }}>
            <div style={{ background: "rgba(34,197,94,0.1)", padding: "24px", borderRadius: "50%", marginBottom: "10px" }}>
              <CheckCircle2 size={64} color="#22c55e" />
            </div>
            <h2 style={{ margin: 0, fontSize: "28px", fontWeight: "800", color: "#fff" }}>Success!</h2>
            <p style={{ color: "#aaa", fontSize: "16px", maxWidth: "280px", lineHeight: "1.5" }}>
              Your image has been sent to your computer. You can now close this tab.
            </p>
            <button 
              onClick={() => setStatus("idle")}
              style={{
                marginTop: "24px",
                background: "transparent",
                border: "1px solid #333",
                color: "#888",
                padding: "12px 24px",
                borderRadius: "24px",
                fontSize: "14px",
              }}
            >
              Take another photo
            </button>
          </div>
        )}

        {status === "error" && (
          <div style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: "16px" }}>
            <h2 style={{ margin: 0, fontSize: "24px", fontWeight: "700", color: "#ff4444" }}>Upload Failed</h2>
            <p style={{ color: "#aaa", fontSize: "15px" }}>{errorMsg}</p>
            <button 
              onClick={() => setStatus("idle")}
              style={{
                marginTop: "16px",
                background: "#FFD700",
                color: "#000",
                border: "none",
                padding: "12px 32px",
                borderRadius: "24px",
                fontWeight: "bold",
                fontSize: "15px"
              }}
            >
              Try Again
            </button>
          </div>
        )}

      </div>

      {/* Hidden file input */}
      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleFileChange} 
        accept="image/*" 
        capture="environment" 
        style={{ display: "none" }} 
      />
    </div>
  );
}
