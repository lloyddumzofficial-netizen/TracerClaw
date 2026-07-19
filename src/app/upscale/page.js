"use client";

import { useState, useRef, useEffect } from "react";
import QRCode from "react-qr-code";
import { Monitor, ArrowLeft, Loader2, Download, ImageIcon, Sparkles, Wand2, Home, Keyboard, ShieldAlert, Clock, Scan, ZoomIn, ZoomOut, Maximize } from "lucide-react";
import { toast } from "@/components/Toast";
import { createClient } from "@/utils/supabase/client";
import { useRouter } from "next/navigation";
import TopUpModal from "@/components/TopUpModal";
import { compressImageClientSide } from "@/utils/imageUtils";
import { formatUploadLimit, resolveImageUploadLimit } from "@/lib/uploadLimits";
import FeedbackWidget from "@/app/workspace/[id]/components/FeedbackWidget";
import "../globals.css";
import "../home.css";

export default function UpscalePage() {
  const router = useRouter();
  const fileInputRef = useRef(null);
  const supabase = createClient();

  const [syncSessionId, setSyncSessionId] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [upscaledImage, setUpscaledImage] = useState(null);
  const [previewImage, setPreviewImage] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [selectedUrl, setSelectedUrl] = useState(null);
  const [user, setUser] = useState(null);
  const [credits, setCredits] = useState(0);
  const [showTopUpModal, setShowTopUpModal] = useState(false);
  const [recentUpscales, setRecentUpscales] = useState([]);
  
  const [uploadMode, setUploadMode] = useState("file"); // "file" | "qr"
  const scrollContainerRef = useRef(null);
  const [zoom, setZoom] = useState(1);
  const currentZoom = useRef(1);

  useEffect(() => {
    currentZoom.current = zoom;
  }, [zoom]);

  useEffect(() => {
    const handleWheel = (e) => {
      e.preventDefault();
      const z = currentZoom.current;
      const delta = Math.sign(e.deltaY) * 0.15;
      const newZ = Math.min(Math.max(0.25, z - delta), 5);
      if (newZ !== z) setZoom(newZ);
    };
    const el = scrollContainerRef.current;
    if (el) el.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      if (el) el.removeEventListener("wheel", handleWheel);
    };
  }, [previewImage, upscaledImage]); // attach when image renders

  useEffect(() => {
    const fetchSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        setUser(session.user);
        fetchCredits(session.user.id);
        fetchRecentUpscales(session.user.id);
      } else {
        router.push("/");
      }
    };
    fetchSession();
  }, [router, supabase]);

  const fetchCredits = async (userId) => {
    const { data } = await supabase.from("profiles").select("credits").eq("id", userId).single();
    if (data) setCredits(data.credits);
  };

  const fetchRecentUpscales = async (userId) => {
    const { data } = await supabase
      .from("projects")
      .select("*")
      .eq("user_id", userId)
      .eq("trace_type", "upscale")
      .order("created_at", { ascending: false })
      .limit(20);
    if (data) setRecentUpscales(data);
  };

  useEffect(() => {
    if (typeof window !== "undefined") {
      let syncId = localStorage.getItem("globalSyncSessionId");
      if (!syncId) {
        syncId = crypto.randomUUID();
        localStorage.setItem("globalSyncSessionId", syncId);
      }
      setSyncSessionId(syncId);
    }
  }, []);

  useEffect(() => {
    const checkPendingImage = () => {
      const pendingUrl = sessionStorage.getItem("pendingMobileImage");
      if (pendingUrl && user) {
        sessionStorage.removeItem("pendingMobileImage");
        setPreviewImage(pendingUrl);
        setSelectedUrl(pendingUrl);
        setSelectedFile(null);
        setUpscaledImage(null);
      }
    };
    checkPendingImage();
    const handleEvent = () => checkPendingImage();
    window.addEventListener("mobileImageRouted", handleEvent);
    return () => window.removeEventListener("mobileImageRouted", handleEvent);
  }, [user]);

  const handleDragOver = (e) => { e.preventDefault(); e.stopPropagation(); };
  const handleDrop = (e) => {
    e.preventDefault(); e.stopPropagation();
    if (e.dataTransfer.files?.length > 0) handleFileSelected(e.dataTransfer.files[0]);
  };

  const handleFileSelected = (file) => {
    if (!file) return;
    const maxUploadBytes = resolveImageUploadLimit();
    if (file.size > maxUploadBytes) {
      toast.error(`File is too large! Maximum allowed size is ${formatUploadLimit(maxUploadBytes)}.`);
      return;
    }
    const objUrl = URL.createObjectURL(file);
    setPreviewImage(objUrl);
    setSelectedFile(file);
    setSelectedUrl(null);
    setUpscaledImage(null);
  };

  const uploadToS3 = async (file) => {
    const fileExt = file.name.split('.').pop();
    const fileName = `${crypto.randomUUID()}.${fileExt}`;
    try {
      const sessionRes = await supabase.auth.getSession();
      const token = sessionRes.data.session?.access_token;
      if (!token) throw new Error("Unauthorized");

      const res = await fetch("/api/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ fileName, contentType: file.type, fileSize: file.size }),
      });
      const data = await res.json();
      if (!res.ok || !data.uploadUrl) throw new Error("Failed to get upload URL");
      
      const { uploadUrl, publicUrl } = data;

      const uploadRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!uploadRes.ok) throw new Error("Failed to upload image to S3");
      return publicUrl;
    } catch (error) {
      console.error(error);
      throw new Error("Image upload failed");
    }
  };

  const handleUpscale = async () => {
    if (!selectedFile && !selectedUrl) return;
    if (credits <= 0) {
      setShowTopUpModal(true);
      return;
    }
    setIsProcessing(true);
    setUpscaledImage(null);
    
    try {
      let finalUrl = selectedUrl;
      
      // If it's a raw file, we must upload to S3 first
      if (selectedFile) {
        finalUrl = await uploadToS3(selectedFile);
      } else if (selectedUrl && selectedUrl.startsWith("blob:")) {
        // Unlikely, but if it's a blob url without file reference
        const blobRes = await fetch(selectedUrl);
        const blob = await blobRes.blob();
        finalUrl = await uploadToS3(blob);
      }

      const sessionRes = await supabase.auth.getSession();
      const token = sessionRes.data.session?.access_token;
      if (!token) throw new Error("Unauthorized");

      const res = await fetch("/api/upscale", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ imageUrl: finalUrl }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to process image");

      setUpscaledImage(data.upscaledUrl);
      toast.success("Image upscaled successfully! (1 Credit deducted)");
      fetchCredits(user.id);
      fetchRecentUpscales(user.id);

    } catch (err) {
      toast.error(err.message || "An error occurred");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDownload = async (url) => {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `upscaled_${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(downloadUrl);
    } catch (err) {
      toast.error("Failed to download image");
    }
  };

  return (
    <div className="app-container">

      {/* Top Menu Bar */}
      <header style={{ padding: "16px 32px", display: "flex", alignItems: "center", borderBottom: "1px solid #444", background: "#1a1a1a" }}>
        <button onClick={() => router.push('/')} style={{ display: "flex", alignItems: "center", gap: "8px", background: "none", border: "none", color: "#666", cursor: "pointer", fontSize: "12px", textTransform: "uppercase", letterSpacing: "1px", fontWeight: "600", transition: "color 0.2s" }} onMouseEnter={e => e.currentTarget.style.color="#FFD700"} onMouseLeave={e => e.currentTarget.style.color="#666"}>
          <Home size={16} /> HOME
        </button>
        <div style={{ flex: 1, display: "flex", justifyContent: "center", alignItems: "center", gap: "10px" }}>
          <h1 style={{ fontSize: "14px", fontWeight: "600", margin: 0, color: "#fff", textTransform: "uppercase", letterSpacing: "2px" }}>UPSCALE STUDIO</h1>
        </div>
        <div style={{ width: "200px", display: "flex", justifyContent: "flex-end", gap: "16px", alignItems: "center" }}>
          <div onClick={() => setShowTopUpModal(true)} style={{ display: "flex", alignItems: "center", gap: "8px", background: "#2a2a2a", padding: "6px 12px", borderRadius: "0", cursor: "pointer", border: "1px solid #444", transition: "border-color 0.2s" }} onMouseOver={e => e.currentTarget.style.borderColor = "#FFD700"} onMouseOut={e => e.currentTarget.style.borderColor = "#444"}>
            <span style={{ color: "#FFD700", fontWeight: "bold", fontSize: "14px", fontFamily: "monospace" }}>{credits !== null ? credits : "-"}</span>
            <span style={{ color: "#888", fontSize: "10px", textTransform: "uppercase", letterSpacing: "1px" }}>CREDITS</span>
          </div>
        </div>
      </header>


      <main className="main-workspace" style={{ padding: 0 }}>
        
        {/* Split View Workspace */}
        <div className="canvas-area" style={{ padding: 0, display: "flex", flexDirection: "column", background: "url('/checkerboard.png')", backgroundColor: "#111" }}>
          
          <div style={{ display: "flex", borderBottom: "1px solid #222", background: "#1a1a1a", height: "40px" }}>
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", borderRight: "1px solid #222", color: !upscaledImage ? "#FFD700" : "#666", fontWeight: "700", fontSize: "11px", letterSpacing: "1px", textTransform: "uppercase", whiteSpace: "nowrap", padding: "0 10px" }}>
              1. ORIGINAL UPLOAD
            </div>
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: upscaledImage ? "#FFD700" : "#666", fontWeight: "700", fontSize: "11px", letterSpacing: "1px", textTransform: "uppercase", whiteSpace: "nowrap", padding: "0 10px" }}>
              2. 4X HD UPSCALE
            </div>
          </div>

          <div style={{ flex: 1, display: "flex", justifyContent: "center", alignItems: "center", padding: "40px", position: "relative" }}>
            {(!previewImage && !upscaledImage) ? (
              <div className="hero-upload-box"
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                style={{ maxWidth: "460px", width: "100%", padding: "32px 24px", borderRadius: "0", border: "1px solid #333" }}
              >
                <div style={{ display: "flex", gap: "8px", width: "100%", marginBottom: "12px", flexWrap: "nowrap" }}>
                  <button
                    onClick={() => fileInputRef.current.click()}
                    style={{ flex: 1, background: "#FFD700", color: "#111", border: "none", borderRadius: "0", fontSize: "12px", padding: "12px", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", fontWeight: "700", letterSpacing: "0.5px", textTransform: "uppercase", transition: "all 0.2s", cursor: "pointer", whiteSpace: "nowrap" }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "#e6c200"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "#FFD700"; }}
                  >
                    <Monitor size={14} /> Open PC File
                  </button>
                  <button
                    onClick={() => setUploadMode(prev => prev === "qr" ? "file" : "qr")}
                    style={{ flex: 1, background: uploadMode === "qr" ? "rgba(255,215,0,0.08)" : "transparent", color: uploadMode === "qr" ? "#FFD700" : "#999", border: uploadMode === "qr" ? "1px solid #FFD700" : "1px solid #444", borderRadius: "0", fontSize: "12px", padding: "12px", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", fontWeight: "600", letterSpacing: "0.5px", textTransform: "uppercase", transition: "all 0.2s", cursor: "pointer", whiteSpace: "nowrap" }}
                    onMouseEnter={(e) => { if (uploadMode !== "qr") { e.currentTarget.style.borderColor = "#FFD700"; e.currentTarget.style.color = "#FFD700"; } }}
                    onMouseLeave={(e) => { if (uploadMode !== "qr") { e.currentTarget.style.borderColor = "#444"; e.currentTarget.style.color = "#999"; } }}
                  >
                    <Scan size={14} /> Scan Phone
                  </button>
                </div>
                
                <input type="file" ref={fileInputRef} onChange={(e) => handleFileSelected(e.target.files[0])} accept="image/*" style={{ display: "none" }} />
                
                {uploadMode === "qr" ? (
                  <div style={{ background: "#111", border: "1px solid #333", borderRadius: "0", padding: "24px", display: "flex", flexDirection: "column", alignItems: "center", width: "100%" }}>
                    <div style={{ background: "#fff", padding: "10px", marginBottom: "14px" }}><QRCode value={`https://desaynclaw.com/m/${syncSessionId}`} size={130} /></div>
                    <p style={{ color: "#888", margin: 0, fontSize: "12px", textAlign: "center", lineHeight: 1.5 }}>Scan with your mobile camera to upload directly.</p>
                  </div>
                ) : (
                  <div style={{ marginTop: "12px", color: "#555", fontSize: "12px", textAlign: "center" }}>or drop an image anywhere here</div>
                )}
              </div>
            ) : (
              <div style={{ width: "100%", height: "100%", position: "relative", overflow: "hidden", display: "flex", flexDirection: "column" }}>
                <div 
                  ref={scrollContainerRef}
                  style={{ 
                    flex: 1,
                    width: "100%", height: "100%", 
                    overflow: "auto", 
                    display: "flex", alignItems: "center", justifyContent: "center"
                  }}
                >
                  <div style={{ zoom: zoom, transition: "zoom 0.1s ease-out", display: "flex", justifyContent: "center", alignItems: "center", minWidth: "100%", minHeight: "100%" }}>
                    <img src={upscaledImage || previewImage} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", filter: "drop-shadow(0 10px 20px rgba(0,0,0,0.8))" }} alt="Preview" />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Properties Panel */}
        <div style={{ width: "320px", background: "#1a1a1a", borderLeft: "1px solid #222", display: "flex", flexDirection: "column", overflowY: "auto" }}>
          
          <div style={{ padding: "16px", borderBottom: "1px solid #222" }}>
            <div style={{ fontSize: "10px", color: "#888", letterSpacing: "1px", textTransform: "uppercase", marginBottom: "16px", display: "flex", justifyContent: "space-between" }}>
              <span>ACTIONS</span>
            </div>
            
            <button 
              onClick={handleUpscale} 
              disabled={isProcessing || (!previewImage && !upscaledImage)}
              style={{ width: "100%", marginBottom: "8px", background: "rgba(255, 215, 0, 0.1)", color: "#FFD700", border: "1px solid #FFD700", borderRadius: "0", padding: "10px 16px", transition: "all 0.2s", fontSize: "12px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "1px", opacity: (isProcessing || (!previewImage && !upscaledImage)) ? 0.5 : 1, cursor: (isProcessing || (!previewImage && !upscaledImage)) ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}
              onMouseOver={e => { if(!isProcessing && (previewImage || upscaledImage)) e.currentTarget.style.background = "rgba(255, 215, 0, 0.2)"; }}
              onMouseOut={e => { if(!isProcessing && (previewImage || upscaledImage)) e.currentTarget.style.background = "rgba(255, 215, 0, 0.1)"; }}
            >
              {isProcessing ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />} GENERATE 4K UPSCALE
            </button>

            <button 
              onClick={() => {
                if(upscaledImage) handleDownload(upscaledImage);
              }}
              disabled={!upscaledImage}
              style={{ width: "100%", marginBottom: "16px", background: "#1a1a1a", color: "#aaa", border: "1px solid #444", borderRadius: "0", padding: "8px 16px", transition: "all 0.2s", fontSize: "11px", fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.5px", opacity: !upscaledImage ? 0.4 : 1, cursor: !upscaledImage ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}
              onMouseOver={e => { if(upscaledImage) e.currentTarget.style.background = "rgba(255,255,255,0.06)"; }}
              onMouseOut={e => { if(upscaledImage) e.currentTarget.style.background = "rgba(255,255,255,0.02)"; }}
            >
              <Download size={14} /> DOWNLOAD RESULT
            </button>

            {upscaledImage && (
              <FeedbackWidget 
                projectId={syncSessionId} 
              />
            )}
          </div>

          <div style={{ padding: "16px" }}>
            <div style={{ fontSize: "10px", color: "#888", letterSpacing: "1px", textTransform: "uppercase", marginBottom: "12px", display: "flex", alignItems: "center", gap: "6px" }}>
              <span>HISTORY</span>
            </div>

            {/* Privacy Notice */}
            <div style={{ background: "rgba(255,215,0,0.04)", border: "1px solid rgba(255,215,0,0.15)", borderRadius: "0", padding: "12px", marginBottom: "20px", display: "flex", gap: "10px", alignItems: "flex-start" }}>
              <ShieldAlert size={14} color="#FFD700" style={{ flexShrink: 0, marginTop: "2px" }} />
              <div>
                <p style={{ margin: "0 0 4px", fontSize: "11px", fontWeight: "700", color: "#FFD700" }}>Privacy First</p>
                <p style={{ margin: 0, fontSize: "10px", color: "#aaa", lineHeight: 1.4 }}>All uploaded and generated images are permanently deleted after 3 days to protect your privacy.</p>
              </div>
            </div>
            
            {recentUpscales.length === 0 ? (
              <div style={{ textAlign: "center", padding: "30px 0", border: "1px dashed #2a2a2a", background: "#111" }}>
                <Clock size={24} color="#444" style={{ margin: "0 auto 8px" }} />
                <p style={{ margin: 0, color: "#666", fontSize: "11px" }}>No recent upscales</p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {recentUpscales.map(item => (
                  <div key={item.id} className="history-card" style={{ display: "flex", gap: "12px", padding: "10px", background: "#111", border: "1px solid #2a2a2a", borderRadius: "0", transition: "all 0.2s", position: "relative" }} onMouseEnter={e => { e.currentTarget.style.borderColor = "#444"; e.currentTarget.style.background = "#151515"; }} onMouseLeave={e => { e.currentTarget.style.borderColor = "#2a2a2a"; e.currentTarget.style.background = "#111"; }}>
                    <div style={{ width: "48px", height: "48px", background: "#0a0a0a", border: "1px solid #333", borderRadius: "0", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0 }}>
                      <img src={item.generated_image_url || item.original_image_url} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "cover", transition: "transform 0.3s" }} onMouseEnter={e => e.currentTarget.style.transform = "scale(1.1)"} onMouseLeave={e => e.currentTarget.style.transform = "scale(1)"} />
                    </div>
                    <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", minWidth: 0 }}>
                      <p style={{ margin: "0 0 4px", color: "#ddd", fontSize: "12px", fontWeight: "600", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {item.name || "4K Upscale"}
                      </p>
                      <span style={{ fontSize: "10px", color: "#666", display: "flex", alignItems: "center", gap: "4px" }}>
                        <Clock size={10} /> {new Date(item.created_at).toLocaleDateString()}
                      </span>
                    </div>
                   <button
                      onClick={() => handleDownload(item.generated_image_url)}
                      title="Download Image"
                      style={{ alignSelf: "center", background: "transparent", border: "1px solid #444", color: "#888", width: "28px", height: "28px", borderRadius: "0", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", transition: "all 0.2s", flexShrink: 0 }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = "#FFD700"; e.currentTarget.style.color = "#FFD700"; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = "#444"; e.currentTarget.style.color = "#888"; }}
                    >
                      <Download size={12} strokeWidth={2.5} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>

      </main>

      {showTopUpModal && <TopUpModal onClose={() => setShowTopUpModal(false)} user={user} />}
    </div>
  );
}
