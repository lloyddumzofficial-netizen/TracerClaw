"use client";

import { Suspense, useEffect, useState, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Camera, Upload, CheckCircle2, Loader2, Image as ImageIcon } from "lucide-react";
import LogoLoader from "@/components/ui/LogoLoader";
import { compressImageClientSide } from "@/utils/imageUtils";
import { formatUploadLimit, resolveImageUploadLimit } from "@/lib/uploadLimits";
import { safeJson } from "@/lib/safeJson";

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
    const maxUploadBytes = resolveImageUploadLimit();
    if (file.size > maxUploadBytes) {
      setStatus("error");
      setErrorMsg(`File is too large. Maximum allowed size is ${formatUploadLimit(maxUploadBytes)}.`);
      return;
    }

    try {
      setStatus("uploading");
      
      // 1. Compress Image
      let fileToUpload = file;
      try {
        fileToUpload = await compressImageClientSide(file, 2048, 0.85);
      } catch (compressErr) {
        console.warn("Compression failed on mobile, using original:", compressErr);
      }

      if (fileToUpload.size > maxUploadBytes) {
        throw new Error(`Compressed file is still too large. Maximum allowed size is ${formatUploadLimit(maxUploadBytes)}.`);
      }

      const sessionRes = await supabase.auth.getSession();
      const token = sessionRes.data.session?.access_token;

      const res = await fetch("/api/upload-mobile", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { "Authorization": `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          fileName: fileToUpload.name,
          contentType: fileToUpload.type,
          fileSize: fileToUpload.size,
          syncSessionId: syncSessionId
        })
      });

      const data = await safeJson(res, "Failed to get upload URL");
      if (!res.ok) {
        throw new Error(data.error || "Failed to get upload URL");
      }

      const { uploadUrl, publicUrl } = data;

      const uploadRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": fileToUpload.type },
        body: fileToUpload,
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
    <div style={{ minHeight: "100vh", background: "#262626", color: "#e0e0e0", display: "flex", flexDirection: "column", padding: "24px", fontFamily: "var(--font-outfit), monospace" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", marginBottom: "40px", marginTop: "20px" }}>
        <img src="/nav bar logo.png" alt="DesaynClaw Logo" style={{ height: "24px", width: "auto", filter: "opacity(0.8)" }} />
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        {status === "idle" && (
          <div style={{ textAlign: "center", width: "100%", display: "flex", flexDirection: "column", alignItems: "center" }}>
            <h1 style={{ fontSize: "16px", fontWeight: "bold", marginBottom: "12px", color: "#FFD700", textTransform: "uppercase", letterSpacing: "2px" }}>ESTABLISH UPLINK</h1>
            <p style={{ color: "#888", fontSize: "12px", marginBottom: "40px", lineHeight: "1.5", textTransform: "uppercase", letterSpacing: "1px", maxWidth: "250px" }}>
              CAPTURE IMAGE DATA. IT WILL SYNC INSTANTLY TO YOUR PC VIEWPORT.
            </p>

            <button 
              onClick={() => fileInputRef.current.click()}
              style={{
                background: "#1a1a1a",
                border: "1px solid #444",
                width: "200px",
                height: "200px",
                borderRadius: "0",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: "16px",
                margin: "0 auto",
                cursor: "pointer",
                color: "#e0e0e0",
                position: "relative"
              }}
            >
              {/* Corner Brackets */}
              <div style={{ position: "absolute", top: -1, left: -1, width: "15px", height: "15px", borderTop: "2px solid #FFD700", borderLeft: "2px solid #FFD700" }} />
              <div style={{ position: "absolute", top: -1, right: -1, width: "15px", height: "15px", borderTop: "2px solid #FFD700", borderRight: "2px solid #FFD700" }} />
              <div style={{ position: "absolute", bottom: -1, left: -1, width: "15px", height: "15px", borderBottom: "2px solid #FFD700", borderLeft: "2px solid #FFD700" }} />
              <div style={{ position: "absolute", bottom: -1, right: -1, width: "15px", height: "15px", borderBottom: "2px solid #FFD700", borderRight: "2px solid #FFD700" }} />

              <Camera size={48} strokeWidth={1} color="#FFD700" />
              <span style={{ fontWeight: "bold", fontSize: "12px", letterSpacing: "2px", textTransform: "uppercase" }}>INITIATE SCAN</span>
            </button>

            <div style={{ marginTop: "30px" }}>
              <button 
                onClick={() => {
                  fileInputRef.current.removeAttribute('capture');
                  fileInputRef.current.click();
                  fileInputRef.current.setAttribute('capture', 'environment');
                }}
                style={{
                  background: "#222",
                  border: "1px solid #444",
                  color: "#aaa",
                  padding: "12px 24px",
                  borderRadius: "0",
                  fontSize: "11px",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "8px",
                  cursor: "pointer",
                  textTransform: "uppercase",
                  letterSpacing: "1px",
                  fontWeight: "bold"
                }}
              >
                <ImageIcon size={14} /> BROWSE STORAGE
              </button>
            </div>
          </div>
        )}

        {status === "uploading" && (
          <div style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: "20px" }}>
            <LogoLoader size={56} color="#FFD700" />
            <h2 style={{ margin: 0, fontSize: "14px", fontWeight: "bold", color: "#FFD700", textTransform: "uppercase", letterSpacing: "2px", marginTop: "10px" }}>TRANSMITTING DATA...</h2>
            <p style={{ color: "#888", margin: 0, fontSize: "11px", textTransform: "uppercase", letterSpacing: "1px" }}>DO NOT CLOSE UPLINK</p>
          </div>
        )}

        {status === "success" && (
          <div style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: "16px" }}>
            <div style={{ background: "#1a1a1a", border: "1px solid #444", padding: "20px", borderRadius: "0", marginBottom: "10px" }}>
              <CheckCircle2 size={48} color="#FFD700" strokeWidth={1} />
            </div>
            <h2 style={{ margin: 0, fontSize: "16px", fontWeight: "bold", color: "#fff", textTransform: "uppercase", letterSpacing: "2px" }}>UPLINK COMPLETE</h2>
            <p style={{ color: "#888", fontSize: "11px", maxWidth: "280px", lineHeight: "1.5", textTransform: "uppercase", letterSpacing: "1px" }}>
              IMAGE RECEIVED ON PC VIEWPORT. YOU MAY CLOSE THIS DEVICE.
            </p>
            <button 
              onClick={() => setStatus("idle")}
              style={{
                marginTop: "24px",
                background: "#222",
                border: "1px solid #444",
                color: "#ccc",
                padding: "12px 24px",
                borderRadius: "0",
                fontSize: "11px",
                textTransform: "uppercase",
                letterSpacing: "1px",
                fontWeight: "bold"
              }}
            >
              INITIATE NEW SCAN
            </button>
          </div>
        )}

        {status === "error" && (
          <div style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: "16px" }}>
            <h2 style={{ margin: 0, fontSize: "16px", fontWeight: "bold", color: "#ff4444", textTransform: "uppercase", letterSpacing: "2px" }}>UPLINK FAILED</h2>
            <p style={{ color: "#888", fontSize: "11px", textTransform: "uppercase", letterSpacing: "1px" }}>{errorMsg}</p>
            <button 
              onClick={() => setStatus("idle")}
              style={{
                marginTop: "16px",
                background: "#1a1a1a",
                color: "#ff4444",
                border: "1px solid #ff4444",
                padding: "10px 24px",
                borderRadius: "0",
                fontWeight: "bold",
                fontSize: "11px",
                textTransform: "uppercase",
                letterSpacing: "1px"
              }}
            >
              RETRY CONNECTION
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
    <Suspense fallback={<div style={{ height: "100vh", background: "#0a0a0a", display: "flex", alignItems: "center", justifyContent: "center" }}><LogoLoader size={72} color="#FFD700" /></div>}>
      <MobileUploadContent />
    </Suspense>
  );
}
