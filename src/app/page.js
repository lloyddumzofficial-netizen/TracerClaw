"use client";

// ─── React & Routing ──────────────────────────────────────────────────────────
import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";

// ─── Data & Auth ──────────────────────────────────────────────────────────────
import { createClient } from "@/utils/supabase/client";
import { toast } from "@/components/ui/Toast";
import { compressImageClientSide } from "@/utils/imageUtils";
import { formatUploadLimit, resolveImageUploadLimit } from "@/lib/uploadLimits";
import { useIsMobileDevice } from "@/hooks/useIsMobileDevice";
import { safeJson } from "@/lib/safeJson";

import { ImageIcon, Monitor, LogIn, FilePlus, User, Trash2, LogOut, CheckCircle2, X, Loader2, Scan, Scissors, ShieldCheck, Code2, Star } from "lucide-react";

// ─── Styles ───────────────────────────────────────────────────────────────────
import "./globals.css";
import "./home.css";

// ─── Components ───────────────────────────────────────────────────────────────
import LoginModal from "@/components/marketing/LoginModal";
import NewProjectModal from "@/components/marketing/NewProjectModal";
import OnboardingModal from "@/components/marketing/OnboardingModal";
import RecentProjects from "@/components/marketing/RecentProjects";
import EduSection from "@/components/marketing/EduSection";
import BeforeAfterSlider from "@/components/marketing/BeforeAfterSlider";
import FAQSection from "@/components/marketing/FAQSection";
import LogoLoader from "@/components/ui/LogoLoader";
import AIDisclaimerModal from "@/components/marketing/AIDisclaimerModal";
import TestimonialSection from "@/components/marketing/TestimonialSection";

const TopUpModal = dynamic(() => import("@/components/ui/TopUpModal"), { ssr: false });
const QRCode = dynamic(() => import("react-qr-code"), { ssr: false });

function HomepageWorkflowPreview() {
  return (
    <section className="workflow-preview-section" aria-label="DesaynClaw output preview">
      <div className="workflow-preview-copy">
        <div className="section-kicker">Production Preview</div>
        <h2>From messy mockup to print-ready files.</h2>
        <p>
          Preview the full handoff after upload: cleaned artwork, vector controls, transparent output, and export-ready files for real print shop work.
        </p>
        <div className="workflow-output-grid">
          <div><CheckCircle2 size={15} /> Editable SVG</div>
          <div><CheckCircle2 size={15} /> 4K PNG</div>
          <div><CheckCircle2 size={15} /> Transparent BG</div>
          <div><CheckCircle2 size={15} /> ZIP Package</div>
        </div>
        <div className="workflow-trust-row" aria-label="Workflow trust notes">
          <span><ShieldCheck size={14} /> Files auto-expire after 3 days</span>
          <span><Monitor size={14} /> Desktop workspace protected</span>
          <span><Star size={14} /> Real extraction stats</span>
        </div>
      </div>

      <div className="workflow-mockup" aria-hidden="true">
        <figure className="production-shot production-shot-main">
          <img src="/samples/production-preview/workspace-result.jpg" alt="" loading="lazy" />
        </figure>
        <figure className="production-shot production-shot-process">
          <img src="/samples/production-preview/processing.jpg" alt="" loading="lazy" />
        </figure>
        <figure className="production-shot production-shot-palette">
          <img src="/samples/production-preview/palette-studio.jpg" alt="" loading="lazy" />
        </figure>
      </div>
    </section>
  );
}

function AnimatedCounter({ value }) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!Number.isFinite(value)) return;

    const target = Math.max(0, value);
    const start = count;
    const distance = target - start;

    if (distance === 0) return;

    const duration = 2500; // 2.5 seconds
    let startTime = null;
    let frameId = null;

    const animate = (timestamp) => {
      if (!startTime) startTime = timestamp;
      const progress = timestamp - startTime;
      const percentage = Math.min(progress / duration, 1);

      const easeOut = percentage === 1 ? 1 : 1 - Math.pow(2, -10 * percentage);

      setCount(Math.round(start + (distance * easeOut)));

      if (progress < duration) {
        frameId = requestAnimationFrame(animate);
      }
    };

    frameId = requestAnimationFrame(animate);

    return () => {
      if (frameId) cancelAnimationFrame(frameId);
    };
  }, [value]);

  return (
    <div style={{
      marginTop: "60px",
      padding: "50px 40px",
      background: "linear-gradient(180deg, rgba(20,20,20,0) 0%, rgba(26,26,26,0.8) 100%)",
      borderBottom: "1px solid #2a2a2a",
      textAlign: "center",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: "20px"
    }}>
      {/* Premium Pill Badge */}
      <div style={{
        color: "#FFD700",
        fontSize: "11px",
        fontWeight: "800",
        letterSpacing: "3px",
        textTransform: "uppercase",
        background: "rgba(255, 215, 0, 0.08)",
        border: "1px solid rgba(255, 215, 0, 0.2)",
        padding: "6px 16px",
        borderRadius: "100px",
        boxShadow: "0 0 20px rgba(255, 215, 0, 0.1)"
      }}>
        TRUSTED NATIONWIDE
      </div>

      {/* Gradient Number */}
      <div style={{
        fontSize: "72px",
        fontWeight: "800",
        fontFamily: "'Nexa', 'Nexa Bold', 'Montserrat', sans-serif",
        background: "linear-gradient(135deg, #FFF 0%, #FFD700 100%)",
        WebkitBackgroundClip: "text",
        WebkitTextFillColor: "transparent",
        lineHeight: "1.1",
        letterSpacing: "-2px",
        filter: "drop-shadow(0px 10px 20px rgba(255, 215, 0, 0.15))"
      }}>
        {Number.isFinite(value) ? count.toLocaleString() : "--"}
      </div>

      {/* Clean Description */}
      <div style={{ color: "#aaa", fontSize: "16px", maxWidth: "420px", lineHeight: "1.6", fontWeight: "400" }}>
        Real completed SVG extractions from DesaynClaw projects.
      </div>
    </div>
  );
}

export default function StartScreen() {
  const router = useRouter();
  const supabase = createClient();
  const isMobileDevice = useIsMobileDevice();
  const fileInputRef = useRef(null);
  const bgRemoveInputRef = useRef(null);
  const containerRef = useRef(null);

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
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [showCopyrightNotice, setShowCopyrightNotice] = useState(true);
  const [pendingFile, setPendingFile] = useState(null); // holds file waiting for type selection

  // ─── Modal Specific State ───────────────────────────────────────────────────
  const [modalProjectName, setModalProjectName] = useState("Untitled Design");
  const [modalTraceType, setModalTraceType] = useState("mockup_erase");
  const [projectToDelete, setProjectToDelete] = useState(null);

  // ─── Public Stats State ─────────────────────────────────────────────────────
  const [publicStats, setPublicStats] = useState({ totalUsers: 0, completedExtractions: null, reviewCount: 0, avatars: [] });
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState("");
  const [openMenuId, setOpenMenuId] = useState(null);

  // ─── Initialization ─────────────────────────────────────────────────────────
  useEffect(() => {
    setShowCopyrightNotice(localStorage.getItem("desaynclaw-copyright-notice-dismissed") !== "1");
  }, []);

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
    if (typeof window !== "undefined") {
      let syncId = localStorage.getItem("globalSyncSessionId");
      if (!syncId) {
        syncId = crypto.randomUUID();
        localStorage.setItem("globalSyncSessionId", syncId);
      }
      setSyncSessionId(syncId);
    }
  }, []);

  // Handle Routed Mobile Image
  useEffect(() => {
    const checkPendingImage = async () => {
      const pendingUrl = sessionStorage.getItem("pendingMobileImage");
      if (pendingUrl && user) {
        sessionStorage.removeItem("pendingMobileImage");
        setIsQrConnected(true);
        setShowQrModal(false);

        try {
          const response = await fetch(pendingUrl);
          const blob = await response.blob();
          const mimeType = blob.type && blob.type.startsWith("image/") ? blob.type : "image/jpeg";
          const file = new File([blob], "mobile-upload.jpg", { type: mimeType });

          const mobileTraceType = sessionStorage.getItem("mobileTraceType");
          if (mobileTraceType) {
            sessionStorage.removeItem("mobileTraceType");
            handleFileUpload(file, mobileTraceType === "bg_remover", mobileTraceType);
          } else {
            handleFileUpload(file);
          }
        } catch (error) {
          console.error("Failed to process routed mobile upload:", error);
          toast.error("Failed to load received image.");
        }
      }
    };

    checkPendingImage();
    const handleEvent = () => checkPendingImage();
    window.addEventListener("mobileImageRouted", handleEvent);

    return () => {
      window.removeEventListener("mobileImageRouted", handleEvent);
    };
  }, [user]);

  // Fetch Public Stats — re-fetch whenever user returns to this tab/page
  useEffect(() => {
    const fetchStats = () => {
      fetch(`/api/public-stats?t=${Date.now()}`)
        .then(res => safeJson(res, "Failed to load public stats"))
        .then(data => {
          if (data.success) {
            setPublicStats({
              totalUsers: data.totalUsers || 0,
              completedExtractions: Number.isFinite(data.completedExtractions) ? data.completedExtractions : 0,
              reviewCount: data.reviewCount || 0,
              avatars: data.avatars || []
            });
          }
        })
        .catch(console.error);
    };

    fetchStats(); // initial load

    // Re-fetch when user switches back to this tab (catches new sign-ups immediately)
    const handleVisibility = () => { if (document.visibilityState === "visible") fetchStats(); };
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", fetchStats);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", fetchStats);
    };
  }, []);

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

    // Only fetch projects from the last 3 days since R2 objects are auto-deleted after 3 days
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

    const { data, error } = await supabase
      .from("projects")
      .select("*")
      .eq("user_id", userId)
      .gte("created_at", threeDaysAgo.toISOString())
      .order("created_at", { ascending: false })
      .limit(50);

    if (!error && data) setRecentProjects(data);
    setIsLoadingProjects(false);
  };

  // ─── Auth Handlers ──────────────────────────────────────────────────────────
  const handleLogin = () => {
    setShowLoginModal(true);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setRecentProjects([]);
  };

  // ─── Project Actions ────────────────────────────────────────────────────────
  const saveRename = async (e, id) => {
    e.stopPropagation();
    if (!editValue.trim() || editValue === recentProjects.find(p => p.id === id).name) {
      setEditingId(null);
      return;
    }
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch("/api/project", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { "Authorization": `Bearer ${token}` } : {})
        },
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
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      await fetch(`/api/project?id=${id}`, {
        method: "DELETE",
        headers: token ? { "Authorization": `Bearer ${token}` } : {}
      });
    } catch (err) {
      console.error("Failed to delete", err);
      fetchRecentProjects(user?.id);
    }
  };

  // ─── Upload Logic ───────────────────────────────────────────────────────────
  const handleFileUpload = async (file, isBgRemover = false, mobileTraceType = null) => {
    if (!file || !file.type.startsWith("image/")) return;
    if (isMobileDevice) {
      toast.info("Desktop required: please use a computer or laptop to process designs.");
      return;
    }

    // Limit upload to 10MB to save bandwidth and prevent AI processing timeouts
    const maxUploadBytes = resolveImageUploadLimit({ purpose: isBgRemover ? "bg_remover" : "standard" });
    if (file.size > maxUploadBytes) {
      toast.error(`File is too large! Maximum allowed size is ${formatUploadLimit(maxUploadBytes)}.`);
      return;
    }

    setIsUploading(true);
    try {
      // 1. Compress Image
      let fileToUpload = file;
      try {
        fileToUpload = await compressImageClientSide(file, 2048, 0.85); // 2048px max, 85% quality
      } catch (compressErr) {
        console.warn("Compression failed, uploading original:", compressErr);
      }

      if (fileToUpload.size > maxUploadBytes) {
        toast.error(`Compressed file is still too large. Maximum allowed size is ${formatUploadLimit(maxUploadBytes)}.`);
        return;
      }

      const sessionRes = await supabase.auth.getSession();
      const token = sessionRes.data.session?.access_token;
      if (!token) { setIsUploading(false); handleLogin(); return; }

      const urlRes = await fetch("/api/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({
          fileName: fileToUpload.name,
          contentType: fileToUpload.type,
          fileSize: fileToUpload.size,
          purpose: isBgRemover ? "bg_remover" : "standard",
        })
      });

      const urlData = await safeJson(urlRes, "Failed to get upload URL");
      if (!urlRes.ok || !urlData.uploadUrl) throw new Error(urlData.error || "Failed to get upload URL");

      const putRes = await fetch(urlData.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": fileToUpload.type },
        body: fileToUpload
      });
      if (!putRes.ok) throw new Error("Failed to upload image to storage");

      const finalTraceType = isBgRemover ? "bg_remover" : (mobileTraceType || modalTraceType);

      const response = await fetch("/api/upload", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}` // Required: server verifies user server-side
        },
        body: JSON.stringify({
          imageUrl: urlData.publicUrl,
          projectName: isBgRemover ? fileToUpload.name.replace(/\.[^/.]+$/, "") : (modalProjectName || file.name),
          traceType: finalTraceType
          // userId intentionally omitted — server reads from verified token
        })
      });

      const data = await safeJson(response, "Project creation failed");
      if (!response.ok) throw new Error(data.details || data.error || "Project creation failed");

      if (isBgRemover) {
        router.push(`/bg-remover/${data.projectId}`);
      } else {
        router.push(`/workspace/${data.projectId}`);
      }
    } catch (error) {
      console.error("Upload error:", error);
      toast.error("Failed to create project: " + error.message);
      setIsUploading(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    if (!user) { setShowLoginModal(true); return; }
    if (e.dataTransfer.files?.length > 0) handleFileUpload(e.dataTransfer.files[0]);
  };

  // Open type-selection modal with a pre-selected file (from drop or file picker)
  const openModalWithFile = (file) => {
    if (!file || !file.type.startsWith("image/")) return;
    if (isMobileDevice) {
      toast.info("Desktop required: workspace tools are available on computer or laptop only.");
      return;
    }
    if (!user) { setShowLoginModal(true); return; }
    const maxSizeInMB = 10;
    if (file.size > maxSizeInMB * 1024 * 1024) {
      toast.error(`File is too large! Maximum allowed size is ${maxSizeInMB}MB.`);
      return;
    }
    setPendingFile(file);
    setShowModal(true);
  };

  const requireDesktopTool = () => {
    if (!isMobileDevice) return false;
    toast.info("Desktop required: please use a computer or laptop to open DesaynClaw tools.");
    return true;
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
              openModalWithFile(e.dataTransfer.files[0]);
            }
          }}
        >
          <div style={{ background: "#FFD700", padding: "24px", borderRadius: "50%", marginBottom: "24px" }}><ImageIcon size={48} color="#000" /></div>
          <h2 style={{ color: "#FFD700", fontSize: "32px", margin: 0, fontWeight: "800" }}>Drop your image anywhere</h2>
          <p style={{ color: "#aaa", fontSize: "16px", marginTop: "12px" }}>Release to start tracing instantly.</p>
        </div>
      )}

      {/* Top Navigation Bar */}
      <header style={{ boxSizing: "border-box", position: "fixed", top: 0, left: 0, width: "100%", height: "64px", background: "rgba(17, 17, 17, 0.85)", backdropFilter: "blur(12px)", borderBottom: "1px solid rgba(255,255,255,0.05)", zIndex: 50, display: "flex", justifyContent: "center", padding: "0 20px" }}>

        <div style={{ display: "flex", width: "100%", maxWidth: "1200px", alignItems: "center", justifyContent: "space-between" }}>
          {/* Left: Brand/Logo Mini (Hidden at top to avoid redundancy) */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", opacity: scrolled ? 1 : 0, pointerEvents: scrolled ? "auto" : "none", transition: "opacity 0.3s ease" }} onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
            <img src="/nav bar logo.png" alt="DesaynClaw Navbar Logo" style={{ height: "32px", width: "auto" }} />
          </div>

          {/* Right: Auth & Credits */}
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginLeft: "auto" }}>
            {user ? (
              <>
                {/* Premium Credits Badge */}
                <div onClick={() => setShowTopUpModal(true)} style={{ display: "flex", alignItems: "center", gap: "8px", background: "#2a2a2a", padding: "6px 12px", borderRadius: "0", cursor: "pointer", border: "1px solid #444", transition: "border-color 0.2s" }} onMouseOver={e => e.currentTarget.style.borderColor = "#FFD700"} onMouseOut={e => e.currentTarget.style.borderColor = "#444"}>
                  <span style={{ color: "#FFD700", fontWeight: "bold", fontSize: "14px", fontFamily: "monospace" }}>{credits}</span>
                  <span style={{ color: "#888", fontSize: "10px", textTransform: "uppercase", letterSpacing: "1px" }}>CREDITS</span>
                </div>

                {/* Profile Pill */}
                <div style={{ display: "flex", alignItems: "center", gap: "8px", background: "rgba(255,255,255,0.05)", padding: "4px 12px 4px 4px", borderRadius: "0", border: "1px solid rgba(255,255,255,0.05)" }}>
                  {user.user_metadata?.avatar_url ? (
                    <img src={user.user_metadata.avatar_url} referrerPolicy="no-referrer" style={{ width: 24, height: 24, borderRadius: "0" }} alt="Avatar" />
                  ) : <div style={{ width: 24, height: 24, borderRadius: "0", background: "#333", display: "flex", alignItems: "center", justifyContent: "center" }}><User size={14} color="#aaa" /></div>}
                  <span style={{ fontSize: "13px", color: "#ddd", fontWeight: "500", textTransform: "uppercase", letterSpacing: "1px" }}>{user.user_metadata?.full_name?.split(' ')[0] || user.email?.split('@')[0]}</span>
                </div>

                {/* Logout Icon Button */}
                <button onClick={handleLogout} style={{ background: "transparent", border: "none", color: "#888", cursor: "pointer", padding: "8px", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "50%", transition: "all 0.2s" }} onMouseOver={e => { e.currentTarget.style.color = "#ff4444"; e.currentTarget.style.background = "rgba(255,68,68,0.1)"; }} onMouseOut={e => { e.currentTarget.style.color = "#888"; e.currentTarget.style.background = "transparent"; }} title="Logout">
                  <LogOut size={18} />
                </button>
              </>
            ) : (
              <button onClick={handleLogin} className="start-btn" style={{ background: "#FFD700", color: "#000", borderColor: "#FFD700", display: "flex", alignItems: "center", gap: "8px", fontWeight: "bold", padding: "8px 16px", borderRadius: "0", textTransform: "uppercase", letterSpacing: "1px" }}>
                <LogIn size={16} /> Log In
              </button>
            )}
          </div>
        </div>
      </header>

      {/* FULL WIDTH HERO SECTION */}
      <div style={{ position: "relative", width: "calc(100% + 40px)", marginLeft: "-20px", marginRight: "-20px", background: "#1a1a1a", paddingTop: "100px", paddingBottom: "40px", color: "#fff" }}>
        {showCopyrightNotice && (
          <div style={{ position: "absolute", top: 0, left: 0, width: "100%", background: "#111", borderBottom: "1px solid rgba(255,255,255,0.08)", zIndex: 3 }}>
            <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "10px 20px", display: "flex", alignItems: "center", justifyContent: "center", gap: "14px", color: "#d8d8d8", fontSize: "12px", lineHeight: "1.5", textAlign: "center" }}>
              <ShieldCheck size={15} color="#FFD700" style={{ flexShrink: 0 }} />
              <span>
                Copyright reminder: only upload or generate designs you own, are authorized to use, or have rights to process. Unauthorized copyrighted or trademarked content may be removed.
              </span>
              <button
                type="button"
                aria-label="Dismiss copyright notice"
                onClick={() => {
                  localStorage.setItem("desaynclaw-copyright-notice-dismissed", "1");
                  setShowCopyrightNotice(false);
                }}
                style={{ background: "transparent", border: "none", color: "#888", cursor: "pointer", padding: "4px", display: "flex", alignItems: "center", justifyContent: "center", marginLeft: "auto" }}
              >
                <X size={16} />
              </button>
            </div>
          </div>
        )}
        <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "0 20px", position: "relative", zIndex: 2 }}>

          <div className="hero-section" style={{ justifyContent: "flex-start", margin: 0 }}>
            {/* LOGO AND UPLOAD BOX (ALWAYS VISIBLE) */}
            <div className="hero-left" style={{ margin: "0" }}>
              <div className="start-logo" style={{ marginBottom: "30px", display: "flex", flexDirection: "column", alignItems: "center", width: "100%" }}>
                <img src="/logo.png" alt="DesaynClaw Logo" style={{ width: "350px", maxWidth: "100%", height: "auto", margin: 0 }} />

                {/* Refined byline */}
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "8px" }}>
                  <span style={{ width: "20px", height: "1px", background: "rgba(255,255,255,0.15)", display: "inline-block" }} />
                  <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.3)", fontWeight: "500", letterSpacing: "2.5px", textTransform: "uppercase" }}>Developed by Desaynbro</span>
                  <span style={{ width: "20px", height: "1px", background: "rgba(255,255,255,0.15)", display: "inline-block" }} />
                </div>

                {/* PUBLIC STATS — compact single-pill row */}
                {publicStats.totalUsers > 0 && (
                  <div style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0",
                    marginTop: "24px",
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: "100px",
                    padding: "6px 14px 6px 6px",
                  }}>
                    {/* Avatar stack */}
                    <div style={{ display: "flex", alignItems: "center", marginRight: "10px" }}>
                      {publicStats.avatars.length > 0 && publicStats.avatars.map((url, i) => (
                        <img key={i} src={url} alt="User" style={{ width: "28px", height: "28px", borderRadius: "50%", border: "2px solid rgba(255,255,255,0.08)", marginLeft: i > 0 ? "-9px" : "0", backgroundColor: "#2a2a2a", objectFit: "cover", zIndex: 10 - i }} />
                      ))}
                    </div>

                    {/* User count */}
                    <span style={{ fontSize: "13px", color: "#fff", fontWeight: "600", marginRight: "6px" }}>
                      {publicStats.totalUsers.toLocaleString()}+
                    </span>
                    <span style={{ fontSize: "13px", color: "rgba(255,255,255,0.4)", fontWeight: "400", marginRight: "10px" }}>creatives</span>

                    {/* Dot divider */}
                    {publicStats.reviewCount > 0 && (
                      <span style={{ width: "3px", height: "3px", borderRadius: "50%", background: "rgba(255,255,255,0.2)", display: "inline-block", marginRight: "10px" }} />
                    )}

                    {/* Stars */}
                    {publicStats.reviewCount > 0 && (
                      <>
                        <div style={{ display: "flex", gap: "2px", marginRight: "5px" }}>
                          {[1, 2, 3, 4, 5].map((_, i) => (
                            <svg key={i} width="11" height="11" viewBox="0 0 24 24" fill="#FFD700" xmlns="http://www.w3.org/2000/svg">
                              <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
                            </svg>
                          ))}
                        </div>
                        <span style={{ fontSize: "12px", color: "rgba(255,255,255,0.35)", fontWeight: "400" }}>
                          {publicStats.reviewCount} reviews
                        </span>
                      </>
                    )}
                  </div>
                )}

                {/* Description */}
                <p style={{ fontSize: "15px", color: "rgba(255,255,255,0.55)", textAlign: "center", marginTop: "20px", maxWidth: "500px", lineHeight: "1.65", textWrap: "balance", fontWeight: "400" }}>
                  Instantly transform your raster images (PNG, JPG) into ultra-clean, scalable vector graphics (SVG) using our advanced AI neural engine.
                </p>
              </div>

              <div className="hero-action-bar" style={{ display: "flex", flexWrap: "nowrap", alignItems: "center", justifyContent: "center", gap: "6px", marginBottom: "20px", width: "100%", overflowX: "auto", paddingBottom: "2px" }}>
                <button className="start-btn" onClick={(e) => { e.stopPropagation(); if (requireDesktopTool()) return; if (!user) { setShowLoginModal(true); return; } setShowModal(true); }} disabled={isUploading} style={{ flex: "0 0 auto", height: "34px", display: "flex", alignItems: "center", justifyContent: "center", gap: "5px", background: "transparent", color: "#d5d5d5", border: "1px solid #444", padding: "0 11px", borderRadius: "5px", fontSize: "11px", fontWeight: "500", transition: "all 0.2s", whiteSpace: "nowrap", letterSpacing: "0.6px" }}>
                  {isUploading ? <><Monitor size={13} className="animate-pulse" /> Creating...</> : <><FilePlus size={13} /> New Project</>}
                </button>
                <button className="start-btn" onClick={(e) => { e.stopPropagation(); if (requireDesktopTool()) return; if (!user) { setShowLoginModal(true); return; } fileInputRef.current.click(); }} disabled={isUploading} style={{ flex: "0 0 auto", height: "34px", display: "flex", alignItems: "center", justifyContent: "center", gap: "5px", background: "transparent", color: "#d5d5d5", border: "1px solid #444", padding: "0 11px", borderRadius: "5px", fontSize: "11px", fontWeight: "500", transition: "all 0.2s", whiteSpace: "nowrap", letterSpacing: "0.6px" }}>
                  {isUploading ? <><Monitor size={13} className="animate-pulse" /> Uploading...</> : <><Monitor size={13} /> Open PC</>}
                </button>
                <button className="start-btn" onClick={(e) => { e.stopPropagation(); if (requireDesktopTool()) return; if (!user) { setShowLoginModal(true); return; } setShowQrModal(true); }} disabled={isUploading} style={{ flex: "0 0 auto", height: "34px", display: "flex", alignItems: "center", justifyContent: "center", gap: "5px", background: "transparent", color: "#d5d5d5", border: "1px solid #444", padding: "0 11px", borderRadius: "5px", fontSize: "11px", fontWeight: "500", transition: "all 0.2s", whiteSpace: "nowrap", letterSpacing: "0.6px" }}>
                  <Scan size={13} /> Scan Phone
                </button>
                <button className="start-btn" onClick={(e) => { e.stopPropagation(); if (requireDesktopTool()) return; if (!user) { setShowLoginModal(true); return; } router.push('/upscale'); }} disabled={isUploading} style={{ flex: "0 0 auto", height: "34px", display: "flex", alignItems: "center", justifyContent: "center", gap: "5px", background: "transparent", color: "#d5d5d5", border: "1px solid #444", padding: "0 11px", borderRadius: "5px", fontSize: "11px", fontWeight: "500", transition: "all 0.2s", whiteSpace: "nowrap", letterSpacing: "0.6px" }}>
                  <ImageIcon size={13} /> Image Upscale
                </button>
                <button className="start-btn" onClick={(e) => { e.stopPropagation(); if (requireDesktopTool()) return; if (!user) { setShowLoginModal(true); return; } bgRemoveInputRef.current.click(); }} disabled={isUploading} style={{ flex: "0 0 auto", height: "34px", display: "flex", alignItems: "center", justifyContent: "center", gap: "5px", background: "transparent", color: "#FFD700", border: "1px solid rgba(255, 215, 0, 0.4)", padding: "0 11px", borderRadius: "5px", fontSize: "11px", fontWeight: "700", transition: "all 0.2s", whiteSpace: "nowrap", letterSpacing: "0.6px", boxShadow: "0 0 10px rgba(255,215,0,0.1)" }} onMouseEnter={e => e.currentTarget.style.background = "rgba(255,215,0,0.1)"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  <Scissors size={13} color="#FFD700" /> BG Remover
                </button>
              </div>

              <div className="hero-upload-box"
                style={{ flex: 1, background: "#2a2a2a", padding: "30px", borderRadius: "0", border: "2px dashed #444", boxShadow: "none", textAlign: "center" }}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (e.dataTransfer.files?.length > 0) {
                    openModalWithFile(e.dataTransfer.files[0]);
                  }
                }}
              >
                <div style={{ marginBottom: "20px", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
                  <input type="checkbox" id="aiEnhance" defaultChecked style={{ width: "16px", height: "16px", accentColor: "#FFD700" }} />
                  <label htmlFor="aiEnhance" style={{ fontSize: "14px", color: "#ccc", cursor: "pointer" }}><strong>Enhance image with AI</strong> (Removes noise)</label>
                </div>

                <button className="start-btn" onClick={(e) => { e.stopPropagation(); if (requireDesktopTool()) return; if (!user) { setShowLoginModal(true); return; } fileInputRef.current.click(); }} disabled={isUploading} style={{ background: "transparent", color: "#e0e0e0", border: "1px solid #444", borderRadius: "0", fontSize: "16px", padding: "16px 24px", width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: "10px", fontWeight: "500", transition: "all 0.2s" }} onMouseEnter={(e) => e.currentTarget.style.background = "#333"} onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
                  {isUploading ? <><Monitor size={18} className="animate-pulse" /> Uploading...</> : <><Monitor size={18} /> Upload Images</>}
                </button>
                <div style={{ marginTop: "15px", display: "flex", flexDirection: "column", gap: "4px", alignItems: "center" }}>
                  <span style={{ color: "#888", fontSize: "14px" }}>or drop an image</span>
                  <span style={{ color: "#555", fontSize: "12px", fontFamily: "monospace" }}>.png, .jpg, .jpeg, .webp</span>
                </div>
              </div>
            </div>

            {/* RIGHT PANEL — Recent Projects (logged in) OR Sample Extractions (guest) */}
            {user ? (
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
                  onNavigate={(proj) => router.push(proj.trace_type === 'bg_remover' ? `/bg-remover/${proj.id}` : `/workspace/${proj.id}`)}
                  onStartEditing={(e, proj) => { e.stopPropagation(); setOpenMenuId(null); setEditingId(proj.id); setEditValue(proj.name); }}
                  onCancelEditing={(e) => { e.stopPropagation(); setEditingId(null); }}
                  onSaveRename={saveRename}
                  onConfirmDelete={(e, proj) => { e.stopPropagation(); setProjectToDelete(proj); }}
                />
              </div>
            ) : (
              <div className="hero-right" style={{ width: "100%", display: "flex", flexDirection: "column", gap: "16px" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "16px" }}>
                  <BeforeAfterSlider
                    title="Untitled Design 2"
                    rasterUrl="/samples/Reference.png"
                    vectorUrl="/samples/DesaynClaw_Tshirt_Design_4K.webp"
                    height="220px"
                    objectPosition="center 40%"
                  />
                  <BeforeAfterSlider
                    title="Polo Shirt Pattern"
                    rasterUrl="/samples/polo-original.png"
                    vectorUrl="/samples/polo-vector.webp"
                    height="220px"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* CURVED WAVE SVG DIVIDER (Matching the app background) */}
        <div style={{ position: "absolute", bottom: "-1px", left: 0, width: "100%", overflow: "hidden", lineHeight: 0 }}>
          <svg viewBox="0 0 1440 320" xmlns="http://www.w3.org/2000/svg" style={{ display: "block", width: "100%", height: "auto" }}>
            <path fill="#262626" fillOpacity="1" d="M0,160L48,170.7C96,181,192,203,288,197.3C384,192,480,160,576,149.3C672,139,768,149,864,170.7C960,192,1056,224,1152,213.3C1248,203,1344,149,1392,122.7L1440,96L1440,320L1392,320C1344,320,1248,320,1152,320C1056,320,960,320,864,320C768,320,672,320,576,320C480,320,384,320,288,320C192,320,96,320,48,320L0,320Z"></path>
          </svg>
        </div>
      </div>

      {/* Main Content Wrapper (For the rest of the page) */}
      <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "0 20px", width: "100%" }}>

        {/* SCROLLING TRUST MARQUEE (MINIMAL & ALIGNED) */}
        <div className="marquee-container" style={{
          padding: "10px 0",
          background: "transparent",
          borderTop: "1px solid #2a2a2a",
          borderBottom: "1px solid #2a2a2a",
          width: "100%",
          marginBottom: "0px"
        }}>
          <div className="marquee-content">
            {/* 1st Set */}
            <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "0 50px", color: "#777" }}>
              <ShieldCheck size={16} color="#777" />
              <span style={{ fontSize: "13px", fontWeight: "600", letterSpacing: "1.5px", textTransform: "uppercase" }}>100% Private & Secure</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "0 50px", color: "#777" }}>
              <Trash2 size={16} color="#777" />
              <span style={{ fontSize: "13px", fontWeight: "600", letterSpacing: "1.5px", textTransform: "uppercase" }}>Auto-deletes after 3 days</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "0 50px", color: "#777" }}>
              <Code2 size={16} color="#777" />
              <span style={{ fontSize: "13px", fontWeight: "600", letterSpacing: "1.5px", textTransform: "uppercase" }}>Built by Real Developers</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "0 50px", color: "#777" }}>
              <Monitor size={16} color="#777" />
              <span style={{ fontSize: "13px", fontWeight: "600", letterSpacing: "1.5px", textTransform: "uppercase" }}>Highly Scalable Infrastructure</span>
            </div>

            {/* 2nd Set (Duplicate for seamless loop) */}
            <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "0 50px", color: "#777" }}>
              <ShieldCheck size={16} color="#777" />
              <span style={{ fontSize: "13px", fontWeight: "600", letterSpacing: "1.5px", textTransform: "uppercase" }}>100% Private & Secure</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "0 50px", color: "#777" }}>
              <Trash2 size={16} color="#777" />
              <span style={{ fontSize: "13px", fontWeight: "600", letterSpacing: "1.5px", textTransform: "uppercase" }}>Auto-deletes after 3 days</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "0 50px", color: "#777" }}>
              <Code2 size={16} color="#777" />
              <span style={{ fontSize: "13px", fontWeight: "600", letterSpacing: "1.5px", textTransform: "uppercase" }}>Built by Real Developers</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "0 50px", color: "#777" }}>
              <Monitor size={16} color="#777" />
              <span style={{ fontSize: "13px", fontWeight: "600", letterSpacing: "1.5px", textTransform: "uppercase" }}>Highly Scalable Infrastructure</span>
            </div>
          </div>
        </div>

        <HomepageWorkflowPreview />

        {/* ─── GREAT FOR SECTION ────────────────────────────────────────────── */}
        <div style={{ marginTop: "40px", marginBottom: "0" }}>

          {/* Section Header */}
          <div style={{ display: "flex", alignItems: "center", gap: "16px", marginBottom: "32px" }}>
            <div style={{
              background: "#FFD700",
              color: "#000",
              fontSize: "11px",
              fontWeight: "800",
              letterSpacing: "1.5px",
              textTransform: "uppercase",
              padding: "6px 14px",
              transform: "skewX(-8deg)",
              display: "inline-block",
              whiteSpace: "nowrap",
            }}>
              <span style={{ display: "inline-block", transform: "skewX(8deg)" }}>Great For</span>
            </div>
            <div style={{ flex: 1, height: "1px", background: "linear-gradient(to right, #444, transparent)" }} />
          </div>

          {/* Cards Grid */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: "1px",
            background: "#333",
            border: "1px solid #333",
          }}>

            {/* Card 1 — Sublimation Print Shops */}
            <div style={{
              background: "#1e1e1e",
              padding: "28px 24px",
              display: "flex",
              flexDirection: "column",
              gap: "14px",
              transition: "background 0.2s",
              cursor: "default",
            }}
              onMouseEnter={e => e.currentTarget.style.background = "#252525"}
              onMouseLeave={e => e.currentTarget.style.background = "#1e1e1e"}
            >
              <div style={{ width: "44px", height: "44px", background: "rgba(255,215,0,0.08)", border: "1px solid rgba(255,215,0,0.2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#FFD700" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 6 2 18 2 18 9" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="8" /></svg>
              </div>
              <div>
                <div style={{ fontSize: "15px", fontWeight: "700", color: "#fff", marginBottom: "8px", letterSpacing: "0.3px" }}>Sublimation Print Shops</div>
                <div style={{ fontSize: "13px", color: "#888", lineHeight: "1.6" }}>Extract flat sublimation-ready files from jersey mockups. Save hours of manual Photoshop work. Output clean, print-ready rectangles straight to your RIP software.</div>
              </div>
            </div>

            {/* Card 2 — Logos & Branding */}
            <div style={{
              background: "#1e1e1e",
              padding: "28px 24px",
              display: "flex",
              flexDirection: "column",
              gap: "14px",
              transition: "background 0.2s",
              cursor: "default",
            }}
              onMouseEnter={e => e.currentTarget.style.background = "#252525"}
              onMouseLeave={e => e.currentTarget.style.background = "#1e1e1e"}
            >
              <div style={{ width: "44px", height: "44px", background: "rgba(255,215,0,0.08)", border: "1px solid rgba(255,215,0,0.2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#FFD700" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
              </div>
              <div>
                <div style={{ fontSize: "15px", fontWeight: "700", color: "#fff", marginBottom: "8px", letterSpacing: "0.3px" }}>Logos &amp; Branding</div>
                <div style={{ fontSize: "13px", color: "#888", lineHeight: "1.6" }}>Vectorize low-resolution logos into crisp, scalable SVGs. Enhance old or blurry brand marks into professional vector files ready for Illustrator, CorelDRAW, or embroidery.</div>
              </div>
            </div>

            {/* Card 3 — School & Sports Uniforms */}
            <div style={{
              background: "#1e1e1e",
              padding: "28px 24px",
              display: "flex",
              flexDirection: "column",
              gap: "14px",
              transition: "background 0.2s",
              cursor: "default",
            }}
              onMouseEnter={e => e.currentTarget.style.background = "#252525"}
              onMouseLeave={e => e.currentTarget.style.background = "#1e1e1e"}
            >
              <div style={{ width: "44px", height: "44px", background: "rgba(255,215,0,0.08)", border: "1px solid rgba(255,215,0,0.2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#FFD700" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
              </div>
              <div>
                <div style={{ fontSize: "15px", fontWeight: "700", color: "#fff", marginBottom: "8px", letterSpacing: "0.3px" }}>School &amp; Sports Uniforms</div>
                <div style={{ fontSize: "13px", color: "#888", lineHeight: "1.6" }}>Reproduce barangay, basketball, volleyball, and school uniform designs from mockup photos. Get editable flat files for any sport — without touching the original artwork.</div>
              </div>
            </div>

            {/* Card 4 — Freelance Designers */}
            <div style={{
              background: "#1e1e1e",
              padding: "28px 24px",
              display: "flex",
              flexDirection: "column",
              gap: "14px",
              transition: "background 0.2s",
              cursor: "default",
            }}
              onMouseEnter={e => e.currentTarget.style.background = "#252525"}
              onMouseLeave={e => e.currentTarget.style.background = "#1e1e1e"}
            >
              <div style={{ width: "44px", height: "44px", background: "rgba(255,215,0,0.08)", border: "1px solid rgba(255,215,0,0.2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#FFD700" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M15 4V2" /><path d="M15 16v-2" /><path d="M8 9h2" /><path d="M20 9h2" /><path d="M17.8 11.8 19 13" /><path d="M15 9h.01" /><path d="M17.8 6.2 19 5" /><path d="m3 21 9-9" /><path d="M12.2 6.2 11 5" /></svg>
              </div>
              <div>
                <div style={{ fontSize: "15px", fontWeight: "700", color: "#fff", marginBottom: "8px", letterSpacing: "0.3px" }}>Freelance Designers</div>
                <div style={{ fontSize: "13px", color: "#888", lineHeight: "1.6" }}>Remove backgrounds, upscale to 4K, and vectorize client artwork in minutes — not hours. Take on more orders and deliver faster without sacrificing quality.</div>
              </div>
            </div>

          </div>

          <div style={{ width: '100%', marginTop: '40px' }}>
            <img src="/small_banner.jpg" alt="Promo Banner" style={{ width: '100%', height: 'auto', objectFit: 'cover', border: '1px solid #333' }} />
          </div>
        </div>
        {/* Animated Counter Section */}
        <AnimatedCounter value={publicStats.completedExtractions} />

        {/* Banner Image (banner-webapp-2.jpg) */}
        <div style={{ marginTop: "40px", marginBottom: "40px", width: "100%", display: "flex", justifyContent: "center" }}>
          <img src="/banner-webapp-2.jpg" alt="DesaynClaw Features Banner" style={{ width: "100%", maxWidth: "1200px", height: "auto" }} />
        </div>

        {/* ────────────────────────────────────────────────────────────────────── */}

        <EduSection />

        {/* Feature Cards below Hero */}
        <div id="samples-section" style={{ marginTop: '80px', marginBottom: '60px' }}>
          <div style={{ textAlign: 'center', marginBottom: '32px' }}>
            <h3 style={{ color: "#FFD700", fontSize: "12px", textTransform: "uppercase", letterSpacing: "1.5px", margin: 0, fontWeight: "bold" }}>Sample Extractions</h3>
            <h2 style={{ color: "#fff", fontSize: "36px", margin: "8px 0 0 0", fontWeight: "600", letterSpacing: "-1px" }}>Pixel-Perfect Vectorization</h2>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '24px' }}>
            <BeforeAfterSlider
              title="Esports Gaming Apparel (Flat Extracted)"
              rasterUrl="/samples/esports-original.jpg"
              vectorUrl="/samples/esports-vector.png"
            />
            <BeforeAfterSlider
              title="Polo Shirt Pattern (Flat Extracted)"
              rasterUrl="/samples/polo-original.png"
              vectorUrl="/samples/polo-vector.webp"
            />
          </div>
        </div>

        {/* BG Remover Sample Section */}
        <div style={{ marginBottom: '80px', width: '100%', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '60px' }}>
          <div style={{ flex: '1 1 300px', textAlign: 'left' }}>
            <h3 style={{ color: "#FFD700", fontSize: "12px", textTransform: "uppercase", letterSpacing: "1.5px", margin: 0, fontWeight: "bold" }}>AI Background Remover</h3>
            <h2 style={{ color: "#fff", fontSize: "36px", margin: "16px 0", fontWeight: "600", letterSpacing: "-1px", lineHeight: '1.2' }}>Flawless Subject Cutouts</h2>
            <p style={{ color: '#aaa', fontSize: '16px', lineHeight: '1.6', margin: "0 0 24px 0" }}>
              Slide to see how our AI perfectly removes complex backgrounds, including fine details like hair, fur, and difficult edges. Get precise cutouts in seconds without manual tracing.
            </p>
            <button
              onClick={(e) => { e.stopPropagation(); if (requireDesktopTool()) return; if (!user) { setShowLoginModal(true); return; } bgRemoveInputRef.current.click(); }}
              style={{ background: "#FFD700", color: "#000", border: "none", padding: "12px 24px", borderRadius: "6px", fontSize: "15px", fontWeight: "700", display: "inline-flex", alignItems: "center", gap: "8px", cursor: "pointer", transition: "all 0.2s" }}
              onMouseEnter={e => e.currentTarget.style.background = "#e6c200"}
              onMouseLeave={e => e.currentTarget.style.background = "#FFD700"}
            >
              <Scissors size={18} color="#000" />
              Try Background Remover
            </button>
          </div>
          <div style={{ flex: '1 1 450px', minWidth: '300px' }}>
            <BeforeAfterSlider
              rasterUrl="/samples/f3fe3b3f-bf6f-4182-9cc8-79a5a8204c6c.png"
              vectorUrl="/samples/DesaynClaw_f3fe3b3f-bf6f-4182-9cc8-79a5a8204c6c_Transparent.png"
              leftLabel="NO BACKGROUND"
              rightLabel="ORIGINAL"
              layout="vertical"
              aspectRatio="1 / 1"
              showCheckerboard={true}
            />
          </div>
        </div>

        {/* Upscaler Sample Section */}
        <div style={{ marginBottom: '100px', width: '100%', display: 'flex', flexDirection: 'row-reverse', flexWrap: 'wrap', alignItems: 'center', gap: '60px' }}>
          <div style={{ flex: '1 1 300px', textAlign: 'left' }}>
            <h3 style={{ color: "#FFD700", fontSize: "12px", textTransform: "uppercase", letterSpacing: "1.5px", margin: 0, fontWeight: "bold" }}>AI Image Upscaler</h3>
            <h2 style={{ color: "#fff", fontSize: "36px", margin: "16px 0", fontWeight: "600", letterSpacing: "-1px", lineHeight: '1.2' }}>Enhance to 4K Quality</h2>
            <p style={{ color: '#aaa', fontSize: '16px', lineHeight: '1.6', margin: "0 0 24px 0" }}>
              Recover lost details, sharpen blurry edges, and magically enhance low-resolution images. Slide to see the crystal clear difference when upgrading to 4K resolution.
            </p>
            <button
              onClick={(e) => { e.stopPropagation(); if (requireDesktopTool()) return; if (!user) { setShowLoginModal(true); return; } router.push('/upscale'); }}
              style={{ background: "#333", color: "#fff", border: "1px solid #555", padding: "12px 24px", borderRadius: "6px", fontSize: "15px", fontWeight: "700", display: "inline-flex", alignItems: "center", gap: "8px", cursor: "pointer", transition: "all 0.2s" }}
              onMouseEnter={e => e.currentTarget.style.background = "#444"}
              onMouseLeave={e => e.currentTarget.style.background = "#333"}
            >
              <ImageIcon size={18} />
              Try Image Upscaler
            </button>
          </div>
          <div style={{ flex: '1 1 450px', minWidth: '280px' }}>
            <BeforeAfterSlider
              rasterUrl="/samples/upscale-original.png"
              vectorUrl="/samples/upscale-hq.png"
              leftLabel="4K UPSCALE"
              rightLabel="PIXELATED"
              layout="vertical"
              aspectRatio="1 / 1"
              pixelateRaster={true}
            />
          </div>
        </div>

        {/* Banner Image (COVER PAGE.png) */}
        <div style={{ width: '100%', marginBottom: '100px', display: 'flex', justifyContent: 'center' }}>
          <img src="/cover-page.webp" alt="DesaynClaw Banner" style={{ width: "100%", maxWidth: "1200px", height: "auto", borderRadius: "12px", boxShadow: "0 20px 40px rgba(0,0,0,0.4)" }} />
        </div>

        <TestimonialSection />


        {/* Hidden File Input — shows type-selector modal before uploading */}
        <input type="file" ref={fileInputRef} onChange={(e) => { if (e.target.files[0]) openModalWithFile(e.target.files[0]); e.target.value = ""; }} accept="image/*" style={{ display: "none" }} />
        <input type="file" ref={bgRemoveInputRef} onChange={(e) => { if (e.target.files[0]) { if (requireDesktopTool()) { e.target.value = ""; return; } handleFileUpload(e.target.files[0], true); } e.target.value = ""; }} accept="image/*" style={{ display: "none" }} />

        {/* ─── Modals ────────────────────────────────────────────────────────── */}
        <NewProjectModal
          show={showModal}
          projectName={modalProjectName} setProjectName={setModalProjectName}
          traceType={modalTraceType} setTraceType={setModalTraceType}
          isUploading={isUploading}
          onClose={() => { setShowModal(false); setPendingFile(null); }}
          onSelectImage={() => {
            if (requireDesktopTool()) return;
            if (pendingFile) {
              handleFileUpload(pendingFile);
            } else {
              fileInputRef.current.click();
            }
          }}
          onSelectBgRemover={() => {
            if (requireDesktopTool()) return;
            bgRemoveInputRef.current.click();
          }}
        />

        <OnboardingModal
          show={showOnboarding}
          onClose={() => setShowOnboarding(false)}
        />

        {showTopUpModal && (
          <TopUpModal
            show={showTopUpModal}
            user={user}
            supabase={supabase}
            onClose={() => setShowTopUpModal(false)}
            onLoginRequired={() => { setShowTopUpModal(false); setShowLoginModal(true); }}
          />
        )}

        <LoginModal
          show={showLoginModal}
          onClose={() => setShowLoginModal(false)}
          supabase={supabase}
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
            <div className="modal-content" style={{ maxWidth: "340px", textAlign: "center", padding: "40px 30px", display: "flex", flexDirection: "column", alignItems: "center" }}>
              <LogoLoader size={64} color="#FFD700" />
              <div style={{ fontSize: "16px", color: "#fff", fontWeight: "600", marginBottom: "8px" }}>Preparing Image...</div>
              <p style={{ color: "#aaa", margin: 0, fontSize: "13px", lineHeight: "1.6" }}>
                Transferring your photo to the workspace.
              </p>
            </div>
          </div>
        )}

        <FAQSection />

        <footer style={{ marginTop: "100px", borderTop: "1px solid #222", padding: "40px 0", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "15px" }}>
            <img src="/logo.png" alt="DesaynClaw Logo" style={{ width: "140px", height: "auto", filter: "grayscale(100%) opacity(0.7)" }} />
            <span style={{ color: "#555", fontSize: "13px" }}>© 2024-2026</span>
          </div>


          <div style={{ display: "flex", gap: "24px", flexWrap: "wrap" }}>
            <a href="/privacy" className="footer-link">Privacy Policy</a>
            <a href="/terms" className="footer-link">Terms of Service</a>
            <a href="#" className="footer-link">Cookie Policy</a>
            <a href="/privacy" className="footer-link">FAQ</a>
            <a href="/refunds" className="footer-link">Refund Policy</a>
            <a href="https://m.me/105884602605306" target="_blank" rel="noreferrer" className="footer-link">Contact</a>
            <a href="https://m.me/105884602605306" target="_blank" rel="noreferrer" className="footer-link" style={{ color: "#FFD700" }}>Customer Support</a>
          </div>
        </footer>

      </div>



      {/* AI Guidelines Popup */}
      <AIDisclaimerModal />

      {/* ─── SEO: FAQ Structured Data (JSON-LD) ─────────────────────────────── */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "FAQPage",
            "mainEntity": [
              {
                "@type": "Question",
                "name": "What is DesaynClaw?",
                "acceptedAnswer": {
                  "@type": "Answer",
                  "text": "DesaynClaw is an AI-powered tool for sublimation jersey design extraction, vector auto-tracing, logo enhancement, background removal, and 4K image upscaling. It's built specifically for print shops and apparel designers who need clean, print-ready files fast.",
                },
              },
              {
                "@type": "Question",
                "name": "How do I extract a flat sublimation design from a jersey mockup?",
                "acceptedAnswer": {
                  "@type": "Answer",
                  "text": "Simply upload your jersey mockup image to DesaynClaw, choose 'Flat Extract' mode, and our AI will automatically remove the 3D shirt shape, correct the perspective, and output a clean flat rectangular sublimation print file ready for production.",
                },
              },
              {
                "@type": "Question",
                "name": "Can DesaynClaw convert my logo to SVG vector?",
                "acceptedAnswer": {
                  "@type": "Answer",
                  "text": "Yes! DesaynClaw can auto-trace your PNG or JPG logo into a clean, scalable SVG vector file. It removes compression artifacts, enhances the design, and outputs a production-ready SVG you can open in Adobe Illustrator, CorelDRAW, or Inkscape.",
                },
              },
              {
                "@type": "Question",
                "name": "Does DesaynClaw support background removal for sublimation designs?",
                "acceptedAnswer": {
                  "@type": "Answer",
                  "text": "Yes. DesaynClaw has a built-in AI background remover that can cleanly cut out jersey designs, logos, and product photos to produce transparent PNG files — no Photoshop required.",
                },
              },
              {
                "@type": "Question",
                "name": "Can I upscale a low-resolution sublimation design?",
                "acceptedAnswer": {
                  "@type": "Answer",
                  "text": "Absolutely. DesaynClaw's AI upscaler can enhance any low-resolution sublimation design, jersey artwork, or logo to 4K quality — making it suitable for large format printing without quality loss.",
                },
              },
              {
                "@type": "Question",
                "name": "Is DesaynClaw free to use?",
                "acceptedAnswer": {
                  "@type": "Answer",
                  "text": "DesaynClaw offers free credits on sign up so you can try all the tools. Additional credits can be purchased at an affordable rate, making it accessible for small print shops and solo designers.",
                },
              },
              {
                "@type": "Question",
                "name": "What file formats does DesaynClaw support?",
                "acceptedAnswer": {
                  "@type": "Answer",
                  "text": "DesaynClaw accepts PNG and JPG image uploads. It outputs SVG vector files, 4K PNG images, and transparent PNG cutouts depending on the tool you use.",
                },
              },
            ],
          }),
        }}
      />
      {/* ─── SEO: HowTo Structured Data ─────────────────────────────────────── */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "HowTo",
            "name": "How to Extract a Flat Sublimation Design from a Jersey Mockup",
            "description":
              "Use DesaynClaw's AI to extract a clean, flat sublimation print file from any jersey photo or mockup in minutes.",
            "totalTime": "PT2M",
            "tool": {
              "@type": "HowToTool",
              "name": "DesaynClaw AI Tracer",
            },
            "step": [
              {
                "@type": "HowToStep",
                "position": 1,
                "name": "Upload Your Jersey Image",
                "text": "Upload a photo or mockup of the jersey you want to extract. Supported formats: PNG, JPG.",
                "url": "https://desaynclaw.com",
              },
              {
                "@type": "HowToStep",
                "position": 2,
                "name": "Choose Flat Extract Mode",
                "text": "Select the 'Flat Extract' or 'Auto-Trace' option and let the AI remove the 3D shirt shape and correct perspective.",
                "url": "https://desaynclaw.com",
              },
              {
                "@type": "HowToStep",
                "position": 3,
                "name": "Review and Upscale",
                "text": "Review the AI-generated flat design and optionally upscale it to 4K for high-resolution sublimation printing.",
                "url": "https://desaynclaw.com",
              },
              {
                "@type": "HowToStep",
                "position": 4,
                "name": "Export as SVG or PNG",
                "text": "Download your clean, print-ready flat design as an SVG vector or 4K PNG file.",
                "url": "https://desaynclaw.com",
              },
            ],
          }),
        }}
      />
    </div>
  );
}
