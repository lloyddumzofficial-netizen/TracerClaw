"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { X, Image as ImageIcon, FileText } from "lucide-react";

export default function GlobalMobileSync() {
  const router = useRouter();
  const pathname = usePathname();
  const supabase = createClient();
  const [receivedImage, setReceivedImage] = useState(null);

  useEffect(() => {
    let syncId = localStorage.getItem("globalSyncSessionId");
    if (!syncId) {
      syncId = crypto.randomUUID();
      localStorage.setItem("globalSyncSessionId", syncId);
    }
  }, []);

  useEffect(() => {
    const syncId = localStorage.getItem("globalSyncSessionId");
    if (!syncId) return;

    const channel = supabase.channel(`mobile_sync_${syncId}`)
      .on('broadcast', { event: 'image_uploaded' }, (payload) => {
        setReceivedImage(payload.payload.imageUrl);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const bc = new BroadcastChannel("mobile_sync_channel");
      bc.onmessage = (event) => {
        if (event.data.type === "IMAGE_UPLOADED" && event.data.url) {
          setReceivedImage(event.data.url);
        } else if (event.data.type === "MODAL_HANDLED") {
          setReceivedImage(null);
        }
      };
      return () => bc.close();
    }
  }, []);

  const handleRoute = (traceType) => {
    sessionStorage.setItem('pendingMobileImage', receivedImage);
    sessionStorage.setItem('mobileTraceType', traceType);
    setReceivedImage(null);
    
    // Notify other tabs to close their modal
    const bc = new BroadcastChannel("mobile_sync_channel");
    bc.postMessage({ type: "MODAL_HANDLED" });
    bc.close();

    if (pathname !== '/') router.push('/');
    else window.dispatchEvent(new Event('mobileImageRouted'));
  };

  if (!receivedImage) return null;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 99999, background: "rgba(10,10,10,0.9)", display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(10px)" }}>
      <div style={{ background: "#1a1a1a", border: "1px solid #444", width: "100%", maxWidth: "800px", display: "flex", flexDirection: "column", boxShadow: "0 20px 40px rgba(0,0,0,0.5)", borderRadius: "12px" }}>
        
        <div style={{ padding: "16px 24px", borderBottom: "1px solid #444", display: "flex", justifyContent: "space-between", alignItems: "center", background: "#222", borderTopLeftRadius: "12px", borderTopRightRadius: "12px" }}>
          <span style={{ fontSize: "12px", color: "#FFD700", textTransform: "uppercase", letterSpacing: "2px", fontWeight: "bold" }}>Incoming Mobile Uplink</span>
          <button onClick={() => setReceivedImage(null)} style={{ background: "none", border: "none", color: "#888", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <X size={20} />
          </button>
        </div>

        <div style={{ padding: "30px", flex: 1, display: "flex", flexDirection: "column", alignItems: "center", background: "#1a1a1a", borderBottomLeftRadius: "12px", borderBottomRightRadius: "12px" }}>
          <h3 style={{ color: "#eee", fontSize: "20px", margin: "0 0 8px 0" }}>Where would you like to route this image?</h3>
          <p style={{ color: "#aaa", fontSize: "14px", margin: "0 0 30px 0", textAlign: "center" }}>Photo received from your mobile device. Choose a tool below.</p>
          
          <div style={{ width: "100%", height: "200px", border: "1px solid #333", background: "#0a0a0a", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", marginBottom: "30px", borderRadius: "8px" }}>
            <img src={receivedImage} alt="Received from mobile" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px", width: "100%" }}>
            <div
              onClick={() => handleRoute("garment")}
              style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, padding: "20px 16px", border: "2px solid #444", borderRadius: 10, cursor: "pointer", background: "transparent", transition: "all 0.18s", textAlign: "center" }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#FFD700"; e.currentTarget.style.background = "rgba(255,215,0,0.06)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#444"; e.currentTarget.style.background = "transparent"; }}
            >
              <div style={{ color: "#FFD700" }}><Shirt size={40} strokeWidth={1.2} /></div>
              <div>
                <p style={{ margin: "0 0 4px 0", color: "#fff", fontSize: "15px", fontWeight: 700 }}>Garment</p>
                <p style={{ margin: 0, fontSize: "11px", color: "#888", lineHeight: 1.5 }}>Extract the flat pattern as SVG.</p>
              </div>
            </div>

            <div
              onClick={() => handleRoute("logo")}
              style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, padding: "20px 16px", border: "2px solid #444", borderRadius: 10, cursor: "pointer", background: "transparent", transition: "all 0.18s", textAlign: "center" }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#FFD700"; e.currentTarget.style.background = "rgba(255,215,0,0.06)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#444"; e.currentTarget.style.background = "transparent"; }}
            >
              <div style={{ color: "#FFD700" }}><LogoIcon /></div>
              <div>
                <p style={{ margin: "0 0 4px 0", color: "#fff", fontSize: "15px", fontWeight: 700 }}>Logo / Wordmark</p>
                <p style={{ margin: 0, fontSize: "11px", color: "#888", lineHeight: 1.5 }}>Vectorize with exact color.</p>
              </div>
            </div>

            <div
              onClick={() => handleRoute("bg_remover")}
              style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, padding: "20px 16px", border: "2px solid #444", borderRadius: 10, cursor: "pointer", background: "transparent", transition: "all 0.18s", textAlign: "center", position: "relative" }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#FFD700"; e.currentTarget.style.background = "rgba(255,215,0,0.06)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#444"; e.currentTarget.style.background = "transparent"; }}
            >
              <div style={{ position: "absolute", top: 8, right: 8, background: "#FFD700", color: "#000", fontSize: "9px", fontWeight: 800, padding: "2px 6px", borderRadius: 4, letterSpacing: "0.5px" }}>AI</div>
              <div style={{ color: "#FFD700" }}><Scissors size={40} strokeWidth={1.2} /></div>
              <div>
                <p style={{ margin: "0 0 4px 0", color: "#fff", fontSize: "15px", fontWeight: 700 }}>BG Remover</p>
                <p style={{ margin: 0, fontSize: "11px", color: "#888", lineHeight: 1.5 }}>Remove backgrounds instantly.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
