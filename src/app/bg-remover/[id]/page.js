"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { Scissors, Download, Home, Loader2, ArrowRight, Settings2, Image as ImageIcon, ZoomIn, ZoomOut, Maximize } from "lucide-react";

const supabase = createClient();

export default function BgRemoverPage() {
  const router = useRouter();
  const params = useParams();
  const projectId = params.id;

  const [project, setProject] = useState(null);
  const [user, setUser] = useState(null);
  const [userCredits, setUserCredits] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [zoom, setZoom] = useState(1);
  
  const isDraggingCompare = useRef(false);
  const currentZoom = useRef(1);
  const scrollContainerRef = useRef(null);

  useEffect(() => {
    currentZoom.current = zoom;
  }, [zoom]);

  useEffect(() => {
    if (!projectId) return;

    let isMounted = true;
    async function fetchData() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) setUser(session.user);

        const { data: projData, error: projError } = await supabase
          .from("projects").select("*").eq("id", projectId).single();

        if (projError || !projData || projData.trace_type !== "bg_remover") {
          router.push("/");
          return;
        }
        
        if (isMounted) setProject(projData);

        if (session?.user) {
          const { data: profile } = await supabase
            .from("profiles").select("credits").eq("id", session.user.id).single();
          if (profile && isMounted) setUserCredits(profile.credits);
        }
      } catch (err) {
        console.error("Data fetch error:", err);
      }
    }
    fetchData();

    return () => { isMounted = false; };
  }, [projectId, router]);

  const handleRemoveBg = async () => {
    // Fix #5: Guard against double-click / re-triggering while already processing
    if (!project?.id || isProcessing) return;
    setIsProcessing(true);
    setErrorMsg("");

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      
      const res = await fetch("/api/remove-bg", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { "Authorization": `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ projectId: project.id, keepOriginal: true })
      });

      const data = await res.json();

      // Handle ALREADY_PROCESSED gracefully — no error, just reload
      if (res.status === 409 && data.error === "ALREADY_PROCESSED") {
        const { data: freshProj } = await supabase.from("projects").select("*").eq("id", project.id).single();
        if (freshProj) setProject(freshProj);
        return;
      }

      if (!res.ok) {
        throw new Error(data.error || "Failed to remove background");
      }

      setProject(prev => ({ ...prev, generated_image_url: data.transparent_image_url }));
      
      // Update credits locally
      if (userCredits !== null) {
        setUserCredits(prev => prev - 1);
      }
      
    } catch (err) {
      console.error(err);
      setErrorMsg(err.message);

      // Fix #6: Re-fetch actual credit balance after failure
      // Server may have refunded the credit — sync the real value
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          const { data: profile } = await supabase
            .from("profiles").select("credits").eq("id", session.user.id).single();
          if (profile) setUserCredits(profile.credits);
        }
      } catch { /* non-fatal */ }
    } finally {
      setIsProcessing(false);
    }
  };

  const forceDownload = useCallback(async (url, filename) => {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error("Fetch failed");
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(objectUrl);
    } catch {
      window.open(url, "_blank");
    }
  }, []);

  const handleDownload = async () => {
    if (!project?.generated_image_url || isDownloading) return;
    setIsDownloading(true);
    try {
      const proxyUrl = `/api/proxy?url=${encodeURIComponent(project.generated_image_url)}`;
      await forceDownload(proxyUrl, `DesaynClaw_${project.name}_Transparent.png`);
    } finally {
      setIsDownloading(false);
    }
  };

  const isCompleted = !!project?.generated_image_url;

  // Add the smooth animation when background removal finishes
  useEffect(() => {
    if (isCompleted) {
      setTimeout(() => {
        const overlayImg = document.getElementById("compare-overlay-img");
        const sliderLine = document.getElementById("compare-slider-line");
        if (overlayImg) overlayImg.style.clipPath = `inset(0 50% 0 0)`;
        if (sliderLine) sliderLine.style.left = `50%`;
      }, 100);
    }
  }, [isCompleted]);

  // Wheel to zoom logic
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    
    const handleWheel = (e) => {
      e.preventDefault();
      const z = currentZoom.current;
      const delta = Math.sign(e.deltaY) * 0.15; // slightly smoother zoom
      const newZ = Math.min(Math.max(0.25, z - delta), 5);
      if (newZ !== z) {
        setZoom(newZ);
      }
    };
    
    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [isCompleted]);

  if (!project) {
    return (
      <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0a0a0a" }}>
        <Loader2 size={32} className="animate-spin text-white opacity-50" />
      </div>
    );
  }

  return (
    <div className="app-container">
      {/* Top Menu Bar */}
      <header style={{ padding: "16px 32px", display: "flex", alignItems: "center", borderBottom: "1px solid #444", background: "#1a1a1a" }}>
        <button onClick={() => router.push('/')} style={{ width: "200px", display: "flex", alignItems: "center", gap: "8px", background: "none", border: "none", color: "#666", cursor: "pointer", fontSize: "12px", textTransform: "uppercase", letterSpacing: "1px", fontWeight: "600", transition: "color 0.2s" }} onMouseEnter={e => e.currentTarget.style.color="#FFD700"} onMouseLeave={e => e.currentTarget.style.color="#666"}>
          <Home size={16} /> HOME
        </button>
        <div style={{ flex: 1, display: "flex", justifyContent: "center", alignItems: "center", gap: "10px" }}>
          <h1 style={{ fontSize: "16px", fontWeight: "700", margin: 0, color: "#fff", textTransform: "uppercase", letterSpacing: "2px" }}>BACKGROUND REMOVER</h1>
        </div>
        <div style={{ width: "200px", display: "flex", justifyContent: "flex-end", gap: "16px", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", background: "#222", padding: "8px 16px", borderRadius: "4px", border: "1px solid #333", cursor: "default" }}>
            <span style={{ color: "#FFD700", fontWeight: "bold", fontSize: "14px" }}>{userCredits !== null ? userCredits : "-"}</span>
            <span style={{ color: "#888", fontSize: "11px", textTransform: "uppercase", letterSpacing: "1px", fontWeight: "600" }}>CREDITS</span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="main-workspace" style={{ padding: 0 }}>
        {/* Canvas Area */}
        <div 
          className="canvas-area"
          style={{ 
            padding: 0,
            display: "flex", 
            alignItems: "center", 
            justifyContent: "center", 
            background: "#111",
            position: "relative",
            overflow: "hidden"
          }}
        >
          <div 
            ref={scrollContainerRef}
            style={{ 
              width: "100%", height: "100%", 
              overflow: "auto", 
              display: "flex", alignItems: "center", justifyContent: "center"
            }}
          >
            <div 
              style={{
                zoom: zoom,
                transition: "zoom 0.1s ease-out",
                display: "flex", alignItems: "center", justifyContent: "center",
                position: "relative", minWidth: "100%", minHeight: "100%"
              }}
              onMouseMove={(e) => {
                if (!isDraggingCompare.current || !isCompleted) return;
                const container = document.getElementById("compare-container");
                if (!container) return;
                const rect = container.getBoundingClientRect();
                let newPos = ((e.clientX - rect.left) / rect.width) * 100;
                newPos = Math.max(0, Math.min(100, newPos));
                
                const overlayImg = document.getElementById("compare-overlay-img");
                const sliderLine = document.getElementById("compare-slider-line");
                if (overlayImg) {
                  overlayImg.style.transition = "none";
                  overlayImg.style.clipPath = `inset(0 ${100 - newPos}% 0 0)`;
                }
                if (sliderLine) {
                  sliderLine.style.transition = "none";
                  sliderLine.style.left = `${newPos}%`;
                }
              }}
              onMouseUp={() => { 
                isDraggingCompare.current = false; 
                // Re-enable transition for smooth snaps later if needed
                const overlayImg = document.getElementById("compare-overlay-img");
                const sliderLine = document.getElementById("compare-slider-line");
                if (overlayImg) overlayImg.style.transition = "clip-path 1.2s cubic-bezier(0.2, 0.8, 0.2, 1)";
                if (sliderLine) sliderLine.style.transition = "left 1.2s cubic-bezier(0.2, 0.8, 0.2, 1)";
              }}
              onMouseLeave={() => { isDraggingCompare.current = false; }}
            >
              {!isCompleted ? (
                // PRE-PROCESS VIEW
                <img 
                  src={project.original_image_url} 
                  alt="Original" 
                  draggable={false}
                  style={{ maxHeight: "80vh", maxWidth: "90%", boxShadow: "0 10px 30px rgba(0,0,0,0.5)", background: "repeating-conic-gradient(#1e1e1e 0% 25%, #141414 0% 50%) 0 0 / 20px 20px" }} 
                />
              ) : (
                // BEFORE/AFTER SLIDER VIEW
                <div
                  id="compare-container"
                  style={{
                    position: "relative",
                    overflow: "hidden", cursor: "ew-resize", userSelect: "none",
                    boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
                    maxWidth: "90%",
                    background: "repeating-conic-gradient(#1e1e1e 0% 25%, #141414 0% 50%) 0 0 / 20px 20px"
                  }}
                  onMouseDown={(e) => {
                    isDraggingCompare.current = true;
                    const rect = e.currentTarget.getBoundingClientRect();
                    const pct = ((e.clientX - rect.left) / rect.width) * 100;
                    const overlayImg = document.getElementById("compare-overlay-img");
                    const sliderLine = document.getElementById("compare-slider-line");
                    if (overlayImg) {
                      overlayImg.style.transition = "none";
                      overlayImg.style.clipPath = `inset(0 ${100 - pct}% 0 0)`;
                    }
                    if (sliderLine) {
                      sliderLine.style.transition = "none";
                      sliderLine.style.left = `${pct}%`;
                    }
                  }}
                >
                  {/* INVISIBLE PLACEHOLDER to dictate the exact aspect ratio */}
                  <img 
                    src={project.original_image_url} 
                    style={{ display: "block", maxHeight: "80vh", maxWidth: "100%", opacity: 0, pointerEvents: "none" }} 
                    alt="" 
                  />

                  {/* AFTER layer (Transparent Image) — stretched to fill */}
                  <img
                    draggable={false}
                    src={project.generated_image_url}
                    alt="Transparent"
                    style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", objectFit: "fill", pointerEvents: "none" }}
                  />

                  {/* BEFORE layer (Original Image) — stretched to fill, clipped */}
                  <div
                    id="compare-overlay-img"
                    style={{
                      position: "absolute", top: 0, left: 0, width: "100%", height: "100%",
                      clipPath: "inset(0 0% 0 0)", // Starts fully covering
                      willChange: "clip-path",
                      transform: "translateZ(0)",
                      transition: "clip-path 1.2s cubic-bezier(0.2, 0.8, 0.2, 1)"
                    }}
                  >
                    <img
                      draggable={false}
                      src={project.original_image_url}
                      alt="Original"
                      style={{ width: "100%", height: "100%", objectFit: "fill", pointerEvents: "none", background: "#000" }}
                    />
                  </div>

                  {/* Slider Line */}
                  <div
                    id="compare-slider-line"
                    style={{
                      position: "absolute", top: 0, bottom: 0, left: "100%", // Starts at edge
                      width: "2px", background: "#FFD700",
                      transform: "translateX(-50%) translateZ(0)", pointerEvents: "none", willChange: "left",
                      transition: "left 1.2s cubic-bezier(0.2, 0.8, 0.2, 1)"
                    }}
                  >
                    <div style={{
                      position: "absolute", top: "50%", left: "50%",
                      transform: "translate(-50%, -50%)",
                      width: "36px", height: "36px", background: "#111", borderRadius: "50%",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      boxShadow: "0 0 12px rgba(0,0,0,0.5)", border: "2px solid #FFD700", gap: "1px",
                    }}>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#FFD700" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#FFD700" strokeWidth="2"><path d="M9 18l6-6-6-6" /></svg>
                    </div>
                  </div>

                  {/* Labels */}
                  <div style={{ position: "absolute", bottom: "14px", left: "14px", background: "rgba(0,0,0,0.75)", padding: "4px 10px", borderRadius: "4px", color: "#FFD700", fontSize: "11px", pointerEvents: "none", letterSpacing: "0.5px", fontWeight: "700" }}>ORIGINAL</div>
                  <div style={{ position: "absolute", bottom: "14px", right: "14px", background: "rgba(0,0,0,0.75)", padding: "4px 10px", borderRadius: "4px", color: "#FFD700", fontSize: "11px", pointerEvents: "none", letterSpacing: "0.5px", fontWeight: "700" }}>NO BACKGROUND</div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Sidebar Properties Panel */}
        <aside className="properties-panel" style={{ width: "320px", display: "flex", flexDirection: "column", background: "#0a0a0a", borderLeft: "1px solid #1a1a1a", zIndex: 10 }}>
          {/* PROPERTIES SECTION */}
          <div className="panel-section">
            <div className="section-header" style={{ background: "#222", borderBottom: "1px solid #444", padding: "12px 16px", fontSize: "11px", letterSpacing: "1px", color: "#888", textTransform: "uppercase" }}>
              <span style={{ display: "flex", alignItems: "center", gap: "8px" }}><ImageIcon size={14} color="#888"/> IMAGE PROPERTIES</span>
            </div>
            <div className="section-content" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <div className="property-row">
                <span className="property-label">Filename</span>
                <span className="property-value" title={project.name} style={{ maxWidth: "150px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {project.name}
                </span>
              </div>
              <div className="property-row">
                <span className="property-label">Mode</span>
                <span className="property-value">AI Background Removal</span>
              </div>
            </div>
          </div>

          {/* ACTIONS SECTION */}
          <div className="panel-section">
            <div className="section-header" style={{ background: "#222", borderBottom: "1px solid #444", padding: "12px 16px", fontSize: "11px", letterSpacing: "1px", color: "#888", textTransform: "uppercase" }}>
              <span style={{ display: "flex", alignItems: "center", gap: "8px" }}><Settings2 size={14} color="#888"/> ACTIONS</span>
            </div>
            <div className="section-content" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              {errorMsg && (
                <div style={{ padding: "12px", background: "rgba(255,50,50,0.1)", border: "1px solid rgba(255,50,50,0.3)", color: "#ff6b6b", borderRadius: "6px", fontSize: "12px", marginBottom: "8px" }}>
                  {errorMsg}
                </div>
              )}

              {!isCompleted ? (
                <button
                  className="btn-primary"
                  onClick={handleRemoveBg}
                  disabled={isProcessing || (userCredits !== null && userCredits <= 0)}
                  style={{
                    width: "100%", padding: "14px 16px", borderRadius: "0", border: "1px solid #FFD700",
                    background: (userCredits !== null && userCredits <= 0) ? "#1a1a1a" : "#1a1a1a",
                    color: "#FFD700",
                    fontWeight: "600", fontSize: "11px", letterSpacing: "1px", textTransform: "uppercase",
                    cursor: isProcessing || (userCredits !== null && userCredits <= 0) ? "not-allowed" : "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
                    transition: "all 0.2s", opacity: isProcessing ? 0.7 : 1
                  }}
                  onMouseOver={e => !isProcessing && (e.currentTarget.style.background = "rgba(255, 215, 0, 0.1)")}
                  onMouseOut={e => !isProcessing && (e.currentTarget.style.background = "#1a1a1a")}
                >
                  {isProcessing ? <Loader2 size={14} className="animate-spin" /> : <Scissors size={14} />}
                  {isProcessing ? "Processing..." : "Remove Background (-1 Credit)"}
                </button>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <button
                    className="btn-primary"
                    onClick={handleDownload}
                    disabled={isDownloading}
                    style={{
                      width: "100%", padding: "10px 16px", borderRadius: "0", border: "1px solid #FFD700",
                      background: "rgba(255, 215, 0, 0.1)", color: "#FFD700",
                      fontWeight: "600", fontSize: "11px", letterSpacing: "1px", textTransform: "uppercase",
                      cursor: isDownloading ? "not-allowed" : "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
                      transition: "all 0.2s", opacity: isDownloading ? 0.7 : 1
                    }}
                    onMouseOver={e => !isDownloading && (e.currentTarget.style.background = "rgba(255, 215, 0, 0.2)")}
                    onMouseOut={e => !isDownloading && (e.currentTarget.style.background = "rgba(255, 215, 0, 0.1)")}
                  >
                    {isDownloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                    Download Transparent PNG
                  </button>
                </div>
              )}
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
}
