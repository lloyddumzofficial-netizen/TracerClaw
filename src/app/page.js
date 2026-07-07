"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { ImageIcon, Monitor, LogIn, FilePlus, User, Trash2, LogOut, CheckCircle2, X, Loader2 } from "lucide-react";
import { toast } from "@/components/Toast";
import "./globals.css";
import "./home.css";

// Components
import TopUpModal from "@/components/TopUpModal";
import NewProjectModal from "./components/NewProjectModal";
import OnboardingModal from "./components/OnboardingModal";
import RecentProjects from "./components/RecentProjects";
import EduSection from "./components/EduSection";
import TraceIcon from "./components/TraceIcon";
import BeforeAfterSlider from "./components/BeforeAfterSlider";
import PromoModal from "./components/PromoModal";
import QRCode from "react-qr-code";

export default function StartScreen() {
  const router = useRouter();
  const supabase = createClient();
  const fileInputRef = useRef(null);

  const [syncSessionId, setSyncSessionId] = useState("");
  const [showQrModal, setShowQrModal] = useState(false);
  const [isQrConnected, setIsQrConnected] = useState(false);

  // ─── Data State ─────────────────────────────────────────────────────────────
  const [recentProjects, setRecentProjects] = useState([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [user, setUser] = useState(null);
  const [credits, setCredits] = useState(0);

  // ─── UI State ───────────────────────────────────────────────────────────────
  const [isUploading, setIsUploading] = useState(false);
  const [isDraggingGlobal, setIsDraggingGlobal] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [showTopUpModal, setShowTopUpModal] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  
  // ─── Modal Specific State ───────────────────────────────────────────────────
  const [modalProjectName, setModalProjectName] = useState("Untitled Design");
  const [modalTraceType, setModalTraceType] = useState("mockup");
  const [projectToDelete, setProjectToDelete] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState("");
  const [openMenuId, setOpenMenuId] = useState(null);

  // ─── Initialization ─────────────────────────────────────────────────────────
  useEffect(() => {
    const fetchSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        setUser(session.user);
        fetchRecentProjects(session.user.id);
        fetchCredits(session.user.id);
      } else {
        setIsLoadingProjects(false);
      }
    };
    fetchSession();
    
    const handleGlobalDragOver = (e) => {
      e.preventDefault();
      if (e.dataTransfer.types.includes("Files")) {
        setIsDraggingGlobal(true);
      }
    };
    window.addEventListener("dragover", handleGlobalDragOver);
    
    const handleScroll = () => setScrolled(window.scrollY > 100);
    window.addEventListener("scroll", handleScroll);
    
    return () => {
      window.removeEventListener("dragover", handleGlobalDragOver);
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  // Handle QR Sync Session Generation
  useEffect(() => {
    if (!syncSessionId && typeof window !== "undefined") {
      setSyncSessionId(crypto.randomUUID());
    }
  }, [syncSessionId]);

  // Setup Supabase Realtime Listener for Mobile Uploads
  useEffect(() => {
    if (!syncSessionId || !user) return; 

    const channel = supabase.channel(`mobile_sync_${syncSessionId}`)
      .on('broadcast', { event: 'image_uploaded' }, async (payload) => {
        setIsQrConnected(true);
        const fileUrl = payload.payload.imageUrl;
        
        try {
          const response = await fetch(fileUrl);
          const blob = await response.blob();
          // R2 sometimes returns application/octet-stream which fails the .startsWith("image/") check.
          // We force it to be an image type so the upload logic accepts it.
          const mimeType = blob.type && blob.type.startsWith("image/") ? blob.type : "image/jpeg";
          const file = new File([blob], "mobile-upload.jpg", { type: mimeType });
          
          setShowQrModal(false);
          handleFileUpload(file);
        } catch (error) {
          console.error("Failed to process mobile upload:", error);
          toast.error("Failed to receive image from mobile.");
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [syncSessionId, user, supabase]);

  const fetchCredits = async (userId) => {
    const { data } = await supabase.from("profiles").select("credits, created_at").eq("id", userId).single();
    if (data) {
      setCredits(data.credits);
      const isNew = data.created_at && (Date.now() - new Date(data.created_at).getTime()) < 60000;
      if (isNew && !localStorage.getItem("onboarding_seen")) {
        setShowOnboarding(true);
        localStorage.setItem("onboarding_seen", "1");
      }
    }
  };

  const fetchRecentProjects = async (userId) => {
    setIsLoadingProjects(true);
    const { data, error } = await supabase
      .from("projects")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50);
    
    if (!error && data) setRecentProjects(data);
    setIsLoadingProjects(false);
  };

  // ─── Auth Handlers ──────────────────────────────────────────────────────────
  const handleLogin = async () => {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/api/auth/callback` }
    });
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setRecentProjects([]);
  };

  // ─── Project Actions ────────────────────────────────────────────────────────
  const saveRename = async (e, id) => {
    e.stopPropagation();
    if (!editValue.trim() || editValue === recentProjects.find(p=>p.id===id).name) {
      setEditingId(null);
      return;
    }
    try {
      const res = await fetch("/api/project", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: id, newName: editValue })
      });
      if (res.ok) setRecentProjects(prev => prev.map(p => p.id === id ? { ...p, name: editValue } : p));
    } catch (err) {
      console.error("Failed to rename", err);
    }
    setEditingId(null);
  };

  const deleteProject = async () => {
    if (!projectToDelete) return;
    const id = projectToDelete.id;
    setRecentProjects(prev => prev.filter(p => p.id !== id));
    setProjectToDelete(null);
    setOpenMenuId(null);
    try {
      await fetch(`/api/project?id=${id}`, { method: "DELETE" });
    } catch (err) {
      console.error("Failed to delete", err);
      fetchRecentProjects(user?.id);
    }
  };

  // ─── Upload Logic ───────────────────────────────────────────────────────────
  const handleFileUpload = async (file) => {
    if (!file || !file.type.startsWith("image/")) return;

    // Limit upload to 10MB to save bandwidth and prevent AI processing timeouts
    const maxSizeInMB = 10;
    if (file.size > maxSizeInMB * 1024 * 1024) {
      toast.error(`File is too large! Maximum allowed size is ${maxSizeInMB}MB.`);
      return;
    }

    setIsUploading(true);
    try {
      const sessionRes = await supabase.auth.getSession();
      const token = sessionRes.data.session?.access_token;
      if (!token) { setIsUploading(false); handleLogin(); return; }

      const urlRes = await fetch("/api/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ fileName: file.name, contentType: file.type })
      });
      
      const urlData = await urlRes.json();
      if (!urlRes.ok || !urlData.uploadUrl) throw new Error(urlData.error || "Failed to get upload URL");
      
      const putRes = await fetch(urlData.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file
      });
      if (!putRes.ok) throw new Error("Failed to upload image to storage");

      const response = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageUrl: urlData.publicUrl,
          projectName: modalProjectName || file.name,
          traceType: modalTraceType,
          userId: user.id
        })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.details || "Project creation failed");

      router.push(`/workspace/${data.projectId}`);
    } catch (error) {
      console.error("Upload error:", error);
      toast.error("Failed to create project: " + error.message);
      setIsUploading(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    if (!user) { handleLogin(); return; }
    if (e.dataTransfer.files?.length > 0) handleFileUpload(e.dataTransfer.files[0]);
  };

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="start-screen-container" onDragOver={(e) => e.preventDefault()} onDrop={handleDrop} onClick={() => setOpenMenuId(null)}>
      {/* Global Drag & Drop Overlay */}
      {isDraggingGlobal && (
        <div 
           style={{ position: "fixed", inset: 0, background: "rgba(26,26,26,0.95)", zIndex: 99999, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", border: "4px dashed #FFD700" }}
           onDragOver={(e) => e.preventDefault()}
           onDragLeave={() => setIsDraggingGlobal(false)}
           onDrop={(e) => {
              e.preventDefault();
              setIsDraggingGlobal(false);
              if (e.dataTransfer.files?.length > 0) {
                if (!user) { handleLogin(); return; }
                handleFileUpload(e.dataTransfer.files[0]);
              }
           }}
        >
          <div style={{ background: "#FFD700", padding: "24px", borderRadius: "50%", marginBottom: "24px" }}><ImageIcon size={48} color="#000" /></div>
          <h2 style={{ color: "#FFD700", fontSize: "32px", margin: 0, fontWeight: "800" }}>Drop your image anywhere</h2>
          <p style={{ color: "#aaa", fontSize: "16px", marginTop: "12px" }}>Release to start tracing instantly.</p>
        </div>
      )}

      {/* Top Navigation Bar */}
      <header style={{ position: "fixed", top: 0, left: 0, width: "100%", height: "64px", background: "rgba(17, 17, 17, 0.85)", backdropFilter: "blur(12px)", borderBottom: "1px solid rgba(255,255,255,0.05)", zIndex: 50, display: "flex", justifyContent: "center", padding: "0 20px" }}>
        
        <div style={{ display: "flex", width: "100%", maxWidth: "1200px", alignItems: "center", justifyContent: "space-between" }}>
          {/* Left: Brand/Logo Mini (Hidden at top to avoid redundancy) */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", opacity: scrolled ? 1 : 0, pointerEvents: scrolled ? "auto" : "none", transition: "opacity 0.3s ease" }} onClick={() => window.scrollTo({top: 0, behavior: 'smooth'})}>
            <img src="/nav bar logo.png" alt="DesaynClaw Navbar Logo" style={{ height: "32px", width: "auto" }} />
          </div>

          {/* Right: Auth & Credits */}
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            {user ? (
              <>
                {/* Premium Credits Badge */}
                <div onClick={() => setShowTopUpModal(true)} style={{ display: "flex", alignItems: "center", gap: "8px", background: "linear-gradient(135deg, #2a2a2a, #111)", padding: "6px 14px", borderRadius: "20px", cursor: "pointer", border: "1px solid #333", boxShadow: "0 2px 10px rgba(0,0,0,0.5)", transition: "all 0.2s" }} onMouseOver={e => e.currentTarget.style.borderColor = "#FFD700"} onMouseOut={e => e.currentTarget.style.borderColor = "#333"}>
                  <TraceIcon size={14} color="#FFD700" />
                  <span style={{ fontSize: "13px", fontWeight: "bold", color: "#FFD700" }}>{credits} {credits === 1 ? "Trace" : "Traces"}</span>
                  <span style={{ fontSize: "9px", background: "#FFD700", color: "#000", padding: "2px 6px", borderRadius: "10px", marginLeft: "4px", fontWeight: "900", letterSpacing: "0.5px" }}>TOP UP</span>
                </div>
                
                {/* Profile Pill */}
                <div style={{ display: "flex", alignItems: "center", gap: "8px", background: "rgba(255,255,255,0.05)", padding: "4px 12px 4px 4px", borderRadius: "20px", border: "1px solid rgba(255,255,255,0.05)" }}>
                  {user.user_metadata?.avatar_url ? (
                    <img src={user.user_metadata.avatar_url} referrerPolicy="no-referrer" style={{ width: 24, height: 24, borderRadius: "50%" }} alt="Avatar" />
                  ) : <div style={{ width: 24, height: 24, borderRadius: "50%", background: "#333", display: "flex", alignItems: "center", justifyContent: "center" }}><User size={14} color="#aaa" /></div>}
                  <span style={{ fontSize: "13px", color: "#ddd", fontWeight: "500" }}>{user.user_metadata?.full_name?.split(' ')[0] || user.email?.split('@')[0]}</span>
                </div>
                
                {/* Logout Icon Button */}
                <button onClick={handleLogout} style={{ background: "transparent", border: "none", color: "#888", cursor: "pointer", padding: "8px", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "50%", transition: "all 0.2s" }} onMouseOver={e => {e.currentTarget.style.color = "#ff4444"; e.currentTarget.style.background = "rgba(255,68,68,0.1)";}} onMouseOut={e => {e.currentTarget.style.color = "#888"; e.currentTarget.style.background = "transparent";}} title="Logout">
                  <LogOut size={18} />
                </button>
              </>
            ) : (
              <button onClick={handleLogin} className="start-btn" style={{ background: "#FFD700", color: "#000", borderColor: "#FFD700", display: "flex", alignItems: "center", gap: "8px", fontWeight: "bold", padding: "8px 16px", borderRadius: "20px" }}>
                <LogIn size={16} /> Log in for 1 Free Credit
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content Wrapper */}
      <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "100px 20px 0 20px", width: "100%" }}>

      <div className="hero-section" style={{ justifyContent: !user ? "center" : "flex-start" }}>
        {/* LOGO AND UPLOAD BOX (ALWAYS VISIBLE) */}
        <div className="hero-left" style={{ margin: !user ? "0 auto" : "0" }}>
          <div className="start-logo" style={{ marginBottom: "30px", display: "flex", flexDirection: "column", alignItems: "center", width: "100%" }}>
            <img src="/logo.png" alt="DesaynClaw Logo" style={{ width: "350px", maxWidth: "100%", height: "auto", margin: 0 }} />
            <p style={{ fontSize: "14px", color: "#888", margin: "5px 0 0 0" }}>Developed by desaynbro</p>
            <p style={{ fontSize: "15px", color: "#aaa", textAlign: "center", marginTop: "15px", maxWidth: "420px", lineHeight: "1.6" }}>
              Instantly transform your raster images (PNG, JPG) into ultra-clean, scalable vector graphics (SVG) using our advanced AI neural engine.
            </p>
          </div>
          
          <div style={{ display: "flex", gap: "8px", marginBottom: "20px", flexWrap: "wrap", justifyContent: "center", width: "100%" }}>
            <button className="start-btn" onClick={(e) => { e.stopPropagation(); if (!user) { handleLogin(); return; } setShowModal(true); }} disabled={isUploading} style={{display: "flex", alignItems: "center", gap: "6px", background: "transparent", color: "#d5d5d5", border: "1px solid #444", padding: "10px 14px", borderRadius: "6px", fontSize: "13px", fontWeight: "500", transition: "all 0.2s"}}>
              {isUploading ? <><Monitor size={15} className="animate-pulse" /> Creating...</> : <><FilePlus size={15} /> New Project</>}
            </button>
            <button className="start-btn" onClick={(e) => { e.stopPropagation(); if (!user) { handleLogin(); return; } fileInputRef.current.click(); }} disabled={isUploading} style={{display: "flex", alignItems: "center", gap: "6px", background: "transparent", color: "#d5d5d5", border: "1px solid #444", padding: "10px 14px", borderRadius: "6px", fontSize: "13px", fontWeight: "500", transition: "all 0.2s"}}>
              {isUploading ? <><Monitor size={15} className="animate-pulse" /> Uploading...</> : <><Monitor size={15} /> Open From Computer</>}
            </button>
            <button className="start-btn" onClick={(e) => { e.stopPropagation(); if (!user) { handleLogin(); return; } setShowQrModal(true); }} disabled={isUploading} style={{display: "flex", alignItems: "center", gap: "6px", background: "rgba(255,215,0,0.1)", color: "#FFD700", border: "1px solid rgba(255,215,0,0.3)", padding: "10px 14px", borderRadius: "6px", fontSize: "13px", fontWeight: "600", transition: "all 0.2s"}}>
              <Monitor size={15} /> Scan with Phone
            </button>
          </div>

          <div className="hero-upload-box"
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (e.dataTransfer.files?.length > 0) {
                if (!user) { handleLogin(); return; }
                handleFileUpload(e.dataTransfer.files[0]);
              }
            }}
          >
            <div style={{ marginBottom: "20px", display: "flex", alignItems: "center", gap: "8px" }}>
              <input type="checkbox" id="aiEnhance" defaultChecked style={{ width: "16px", height: "16px", accentColor: "#FFD700" }} />
              <label htmlFor="aiEnhance" style={{ fontSize: "14px", color: "#ccc", cursor: "pointer" }}><strong>Enhance image with AI</strong> (Removes noise)</label>
            </div>
            
            <button className="start-btn" onClick={(e) => { e.stopPropagation(); if (!user) { handleLogin(); return; } fileInputRef.current.click(); }} disabled={isUploading} style={{ background: "#2d2d2d", color: "#e0e0e0", border: "1px solid #424242", borderRadius: "8px", fontSize: "16px", padding: "16px 24px", width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: "10px", fontWeight: "500", transition: "all 0.2s" }} onMouseEnter={(e) => e.currentTarget.style.background = "#3e3e3e"} onMouseLeave={(e) => e.currentTarget.style.background = "#2d2d2d"}>
              {isUploading ? <><Monitor size={18} className="animate-pulse" /> Uploading...</> : <><Monitor size={18} /> Upload Images</>}
            </button>
            <div style={{ marginTop: "15px", color: "#888", fontSize: "14px" }}>or drop an image</div>
          </div>
        </div>

        {/* RIGHT PANEL (RECENT PROJECTS) - ONLY SHOW IF LOGGED IN */}
        {user && (
          <div className="hero-right" style={{ width: "100%" }}>
            <RecentProjects 
              user={user}
              isLoadingProjects={isLoadingProjects}
              recentProjects={recentProjects}
              editingId={editingId}
              editValue={editValue}
              setEditValue={setEditValue}
              openMenuId={openMenuId}
              setOpenMenuId={setOpenMenuId}
              onNavigate={(id) => router.push(`/workspace/${id}`)}
              onStartEditing={(e, proj) => { e.stopPropagation(); setOpenMenuId(null); setEditingId(proj.id); setEditValue(proj.name); }}
              onCancelEditing={(e) => { e.stopPropagation(); setEditingId(null); }}
              onSaveRename={saveRename}
              onConfirmDelete={(e, proj) => { e.stopPropagation(); setProjectToDelete(proj); }}
            />
          </div>
        )}
      </div>

      {/* Feature Cards below Hero */}
      <div id="samples-section" style={{ marginTop: '80px', marginBottom: '60px' }}>
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <h3 style={{ color: "#FFD700", fontSize: "12px", textTransform: "uppercase", letterSpacing: "1.5px", margin: 0, fontWeight: "bold" }}>Sample Extractions</h3>
          <h2 style={{ color: "#fff", fontSize: "24px", margin: "8px 0 0 0", fontWeight: "700" }}>Pixel-Perfect Vectorization</h2>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '24px' }}>
          <BeforeAfterSlider 
            title="EMPOWER Custom Jersey (Auto-Traced)"
            rasterUrl="https://pub-c1f9daa772cc48a394341ecc043e63a5.r2.dev/users/30f2a02b-2b1a-4ce3-9ec2-585a21b741b1/1783338326367_crop_1783338342234.jpg"
            vectorUrl="https://pub-c1f9daa772cc48a394341ecc043e63a5.r2.dev/projects/bdf18f96-9332-44c3-8b77-e82917acbffa/vector_1783338385589.svg"
          />
          <BeforeAfterSlider 
            title="Graphic Tees (Auto-Traced)"
            rasterUrl="https://pub-c1f9daa772cc48a394341ecc043e63a5.r2.dev/users/30f2a02b-2b1a-4ce3-9ec2-585a21b741b1/1783337357357_crop_1783337373451.jpg"
            vectorUrl="https://pub-c1f9daa772cc48a394341ecc043e63a5.r2.dev/projects/59e847c9-93d3-48e4-b822-4b9c3523c8eb/vector_1783337410425.svg"
          />
        </div>
      </div>
      <EduSection />

      {/* Hidden File Input */}
      <input type="file" ref={fileInputRef} onChange={(e) => handleFileUpload(e.target.files[0])} accept="image/*" style={{ display: "none" }} />

      {/* ─── Modals ────────────────────────────────────────────────────────── */}
      <NewProjectModal 
        show={showModal} 
        projectName={modalProjectName} setProjectName={setModalProjectName}
        traceType={modalTraceType} setTraceType={setModalTraceType}
        isUploading={isUploading}
        onClose={() => setShowModal(false)}
        onSelectImage={() => fileInputRef.current.click()}
      />

      <OnboardingModal 
        show={showOnboarding} 
        onClose={() => setShowOnboarding(false)} 
      />

      <TopUpModal 
        show={showTopUpModal} 
        user={user} 
        supabase={supabase} 
        onClose={() => setShowTopUpModal(false)} 
      />

      {/* Delete Confirmation Modal */}
      {projectToDelete && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: "400px", textAlign: "center" }}>
            <div className="modal-icon text-danger" style={{ marginBottom: "15px" }}>
              <Trash2 size={48} strokeWidth={1} color="#ff4444" />
            </div>
            <h3 style={{ marginBottom: "10px" }}>Delete Project?</h3>
            <p style={{ color: "#888", marginBottom: "25px", fontSize: "13px" }}>
              Are you sure you want to delete <strong>"{projectToDelete.name}"</strong>? This will permanently remove the project and its files from the cloud. This action cannot be undone.
            </p>
            <div className="modal-actions" style={{ justifyContent: "center" }}>
              <button className="btn-secondary" onClick={() => setProjectToDelete(null)}>Cancel</button>
              <button className="btn-primary bg-danger" style={{ backgroundColor: "#ff4444", color: "#fff" }} onClick={deleteProject}>Delete Forever</button>
            </div>
          </div>
        </div>
      )}

      {/* QR Sync Modal */}
      {showQrModal && (
        <div className="modal-overlay" onClick={() => setShowQrModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "420px", textAlign: "center", padding: "40px", position: "relative" }}>
            
            {/* Minimal Close Button */}
            <button 
              onClick={() => setShowQrModal(false)}
              style={{
                position: "absolute",
                top: "16px",
                right: "16px",
                background: "none",
                border: "none",
                color: "#666",
                cursor: "pointer",
                padding: "4px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: "50%",
                transition: "all 0.2s"
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "#fff"; e.currentTarget.style.background = "rgba(255,255,255,0.1)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "#666"; e.currentTarget.style.background = "none"; }}
            >
              <X size={20} />
            </button>

            <h3 style={{ margin: "0 0 10px 0", fontSize: "24px" }}>Scan to Upload</h3>
            <p style={{ color: "#aaa", margin: "0 0 30px 0", fontSize: "14px" }}>
              Point your phone's camera at this QR code. Take a picture of your logo or business card, and it will magically appear here.
            </p>
            
            <div style={{ background: "#fff", padding: "20px", borderRadius: "16px", display: "inline-block", marginBottom: "30px" }}>
              <QRCode 
                value={`${typeof window !== 'undefined' ? window.location.origin : ''}/mobile?sync=${syncSessionId}`}
                size={220}
                bgColor="#ffffff"
                fgColor="#000000"
                level="H"
              />
            </div>
            
            {isQrConnected ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", color: "#22c55e" }}>
                <CheckCircle2 size={18} /> <span style={{ fontWeight: "bold" }}>Receiving Image...</span>
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", color: "#888" }}>
                <Monitor size={16} className="animate-pulse" /> <span>Waiting for your phone...</span>
              </div>
            )}
            
          </div>
        </div>
      )}

      {/* Uploading Overlay */}
      {isUploading && !showModal && (
        <div className="modal-overlay" style={{ zIndex: 9999 }}>
          <div className="modal-content" style={{ maxWidth: "340px", textAlign: "center", padding: "40px 30px" }}>
            <div style={{ position: "relative", display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: "28px" }}>
              <div style={{ position: "absolute", width: "80px", height: "80px", border: "4px solid rgba(255,204,0,0.1)", borderRadius: "50%" }}></div>
              <Loader2 size={40} color="#ffcc00" className="animate-spin" />
            </div>
            <h3 style={{ margin: "0 0 12px 0", fontSize: "22px", fontWeight: "700" }}>Preparing Image...</h3>
            <p style={{ color: "#aaa", margin: 0, fontSize: "14px", lineHeight: "1.6" }}>
              Transferring your photo to the Auto-Tracer Workspace. Please hold on a moment.
            </p>
          </div>
        </div>
      )}

      {/* FOOTER */}
      <footer style={{ marginTop: "100px", borderTop: "1px solid #222", padding: "40px 0", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "20px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "15px" }}>
          <img src="/logo.png" alt="DesaynClaw Logo" style={{ width: "140px", height: "auto", filter: "grayscale(100%) opacity(0.7)" }} />
          <span style={{ color: "#555", fontSize: "13px" }}>© 2024-2026</span>
        </div>
        
        <div style={{ display: "flex", gap: "24px", flexWrap: "wrap" }}>
          <a href="#" className="footer-link">Privacy Policy</a>
          <a href="#" className="footer-link">Terms of Service</a>
          <a href="#" className="footer-link">Cookie Policy</a>
          <a href="#" className="footer-link">FAQ</a>
          <a href="#" className="footer-link">API</a>
          <a href="#" className="footer-link">Contact</a>
        </div>
      </footer>

      </div>

      {/* Promo Popup */}
      <PromoModal onBuyClick={() => window.open('https://m.me/105884602605306', '_blank')} />
    </div>
  );
}
