"use client";

import { Suspense, useEffect, useState, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Camera, Upload, CheckCircle2, Loader2, Image as ImageIcon } from "lucide-react";

function MobileUploadContent() {
  const searchParams = useSearchParams();
  const syncSessionId = searchParams.get("sync");
  const [status, setStatus] = useState("idle");
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

      const { uploadUrl, publicUrl } = await res.json();

      const uploadRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });

      if (!uploadRes.ok) {
        throw new Error("Failed to upload image to cloud storage");
      }

      const channel = supabase.channel(`mobile_sync_${syncSessionId}`);
      await channel.send({
        type: "broadcast",
        event: "image_uploaded",
        payload: { imageUrl: publicUrl }
      });
      
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
    <div style={{ minHeight: "100vh", background: "#1e1e1e", color: "#cccccc", display: "flex", flexDirection: "column", padding: "24px", fontFamily: "system-ui, -apple-system, sans-serif" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", marginBottom: "40px", marginTop: "20px" }}>
        <img src="/nav bar logo.png" alt="DesaynClaw Logo" style={{ height: "24px", width: "auto", filter: "grayscale(100%) opacity(0.8)" }} />
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        {status === "idle" && (
          <div style={{ textAlign: "center", width: "100%" }}>
            <h1 style={{ fontSize: "24px", fontWeight: "600", marginBottom: "12px", color: "#ffffff", letterSpacing: "-0.5px" }}>Take a Photo</h1>
            <p style={{ color: "#888888", fontSize: "15px", marginBottom: "40px", lineHeight: "1.5" }}>
              Snap a picture of the logo or business card. It will instantly appear on your PC.
            </p>

            <button 
              onClick={() => fileInputRef.current.click()}
              style={{
                background: "#2d2d2d",
                border: "1px solid #424242",
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
                color: "#cccccc",
                boxShadow: "0 4px 12px rgba(0,0,0,0.2)"
              }}
            >
              <Camera size={40} strokeWidth={1} />
              <span style={{ fontWeight: "500", fontSize: "14px", letterSpacing: "0.5px" }}>OPEN CAMERA</span>
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
              <div style={{ position: "absolute", width: "80px", height: "80px", border: "2px solid #3e3e3e", borderRadius: "50%" }}></div>
              <Loader2 size={32} color="#888888" className="animate-spin" />
            </div>
            <h2 style={{ margin: 0, fontSize: "20px", fontWeight: "500", color: "#ffffff" }}>Sending to PC...</h2>
            <p style={{ color: "#888888", margin: 0, fontSize: "14px" }}>Please keep this page open.</p>
          </div>
        )}

        {status === "success" && (
          <div style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: "16px" }}>
            <div style={{ background: "#2d2d2d", border: "1px solid #424242", padding: "20px", borderRadius: "50%", marginBottom: "10px" }}>
              <CheckCircle2 size={48} color="#cccccc" strokeWidth={1} />
            </div>
            <h2 style={{ margin: 0, fontSize: "24px", fontWeight: "500", color: "#ffffff" }}>Success</h2>
            <p style={{ color: "#888888", fontSize: "15px", maxWidth: "280px", lineHeight: "1.5" }}>
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
            <h2 style={{ margin: 0, fontSize: "22px", fontWeight: "500", color: "#ffffff" }}>Upload Failed</h2>
            <p style={{ color: "#888888", fontSize: "14px" }}>{errorMsg}</p>
            <button 
              onClick={() => setStatus("idle")}
              style={{
                marginTop: "16px",
                background: "#2d2d2d",
                color: "#ffffff",
                border: "1px solid #424242",
                padding: "10px 24px",
                borderRadius: "24px",
                fontWeight: "500",
                fontSize: "14px"
              }}
            >
              Try Again
            </button>
          </div>
        )}
      </div>

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

export default function MobileUpload() {
  return (
    <Suspense fallback={<div style={{ height: "100vh", background: "#0a0a0a", display: "flex", alignItems: "center", justifyContent: "center" }}><Loader2 className="animate-spin" color="#FFD700" size={32} /></div>}>
      <MobileUploadContent />
    </Suspense>
  );
}
