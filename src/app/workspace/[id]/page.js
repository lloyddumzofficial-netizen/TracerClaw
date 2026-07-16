"use client";

// ─── React & Routing ──────────────────────────────────────────────────────────
import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";

// ─── Data & Auth ──────────────────────────────────────────────────────────────
import { createClient } from "@/utils/supabase/client";

// ─── Icons ────────────────────────────────────────────────────────────────────
import { Home, Keyboard } from "lucide-react";

// ─── Hooks ────────────────────────────────────────────────────────────────────
import { useTraceExecution } from "./hooks/useTraceExecution";

// ─── Components ───────────────────────────────────────────────────────────────
import SplitViewCanvas from "./components/SplitViewCanvas";
import PropertiesPanel from "./components/PropertiesPanel";
import CropModal from "./components/CropModal";
import EraseModal from "./components/EraseModal";
import RemoveBgModal from "./components/RemoveBgModal";
import CompareModal from "./components/CompareModal";
import NoCreditsModal from "./components/NoCreditsModal";
import TopUpModal from "@/components/TopUpModal";
import ShortcutsModal from "./components/ShortcutsModal";

// ─── Supabase client — created ONCE at module level, not inside the component ─
const supabase = createClient();


export default function Workspace() {
  const router = useRouter();
  const params = useParams();
  const projectId = params.id;

  // ─── Core State ───────────────────────────────────────────────────────────
  const [project, setProject] = useState(null);
  const [user, setUser] = useState(null);
  const [userCredits, setUserCredits] = useState(null);
  const [activeTool, setActiveTool] = useState("pointer");

  // ─── Modal State ──────────────────────────────────────────────────────────
  const [showCropModal, setShowCropModal] = useState(false);
  const [showEraseModal, setShowEraseModal] = useState(false);
  const [showRemoveBgModal, setShowRemoveBgModal] = useState(false);
  const [showCompare, setShowCompare] = useState(false);
  const [showNoCreditsModal, setShowNoCreditsModal] = useState(false);
  const [showTopUpModal, setShowTopUpModal] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [isSavingCrop, setIsSavingCrop] = useState(false);

  // ─── Hooks ────────────────────────────────────────────────────────────────
  const {

    traceState, nodeErrors, consoleRef,
    logToConsole, clearConsole, handleExecuteTrace,
  } = useTraceExecution({
    project,
    setProject,
    userCredits,
    setUserCredits,
    supabase,
    onNoCredits: () => setShowNoCreditsModal(true),
  });

  // ─── Data Fetching ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!projectId) return;
    const fetchData = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) setUser(session.user);

        const { data: projData, error: projError } = await supabase
          .from("projects").select("*").eq("id", projectId).single();

        if (projError || !projData) {
          router.push("/");
          return;
        }
        setProject(projData);

        if (!projData.generated_image_url) {
          setShowCropModal(true);
        }

        if (session?.user) {
          const { data: profile } = await supabase
            .from("profiles").select("credits").eq("id", session.user.id).single();
          if (profile) setUserCredits(profile.credits);
        }
      } catch (err) {
        console.error("[Workspace] Data fetch error:", err);
      }
    };
    fetchData();
  }, [projectId, router]);

  // Auto-switch away from loading state (if any was needed)
  useEffect(() => {
    if (!project) return;
  }, [project?.id]);

  // ─── Download Handlers ────────────────────────────────────────────────────
  const forceDownload = useCallback(async (url, filename) => {
    const link = document.createElement("a");
    const downloadUrl = new URL(url, window.location.origin);
    downloadUrl.searchParams.set("download", filename);
    link.href = downloadUrl.toString();
    link.download = filename;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, []);

  const handleDownloadSvg = useCallback(async () => {
    if (!project?.svg_url) return;
    const proxyUrl = `/api/proxy?url=${encodeURIComponent(project.svg_url)}`;
    await forceDownload(proxyUrl, `DesaynClaw_${project.name}_Vector.svg`);
  }, [project, forceDownload]);

  const handleDownloadRaster = useCallback(async () => {
    if (!project?.generated_image_url) return;
    const proxyUrl = `/api/proxy?url=${encodeURIComponent(project.generated_image_url)}`;
    await forceDownload(proxyUrl, `DesaynClaw_${project.name}_Raster.png`);
  }, [project, forceDownload]);

  // Dedicated 4K download — uses upscaled_image_url (Step 2 ESRGAN output), NOT generated_image_url
  const handleDownloadUpscaled = useCallback(async () => {
    if (!project?.upscaled_image_url) return;
    const proxyUrl = `/api/proxy?url=${encodeURIComponent(project.upscaled_image_url)}`;
    await forceDownload(proxyUrl, `DesaynClaw_${project.name}_4K.png`);
    await new Promise(resolve => setTimeout(resolve, 1500));
  }, [project, forceDownload]);

  const handleDownloadAll = useCallback(async () => {
    if (!project) return;
    logToConsole("[System] Preparing ZIP...");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Unauthorized");

      const res = await fetch("/api/prepare-zip", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ projectId: project.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to prepare ZIP");

      await forceDownload(
        `/api/proxy?url=${encodeURIComponent(data.zipUrl)}`,
        data.fileName || `DesaynClaw_${project.name}_AllFiles.zip`
      );
      await new Promise(resolve => setTimeout(resolve, 1500));
      logToConsole(data.cached ? "[Success] Cached ZIP download started!" : "[Success] ZIP prepared and download started!", "success");
    } catch (err) {
      logToConsole(`[Error] Failed to zip: ${err.message}`, "error");
    }
  }, [project, logToConsole, forceDownload]);

  // ─── Trace Execution Wrapper ──────────────────────────────────────────────
  const onExecuteTrace = useCallback(async (vectorColors) => {
    const result = await handleExecuteTrace(vectorColors);
    if (result?.success) {
      setShowCompare(true);
    }
  }, [handleExecuteTrace]);

  // ─── Crop Handlers ────────────────────────────────────────────────────────
  const handleCropApplied = useCallback((publicUrl, errorMsg) => {
    if (errorMsg) {
      logToConsole(`[Error] Failed to save crop: ${errorMsg}`, "error");
    } else {
      setProject(prev => ({
        ...prev,
        original_image_url: publicUrl,
        generated_image_url: null,
        upscaled_image_url: null,
        svg_url: null,
      }));
      logToConsole("[Success] Crop applied and saved! You can now re-trace.", "success");
    }
    setIsSavingCrop(false);
  }, [logToConsole]);

  const handleEraseApplied = useCallback((publicUrl, errorMsg) => {
    if (errorMsg) {
      logToConsole(`[Error] Failed to save erased image: ${errorMsg}`, "error");
    } else {
      setProject(prev => ({
        ...prev,
        original_image_url: publicUrl,
        generated_image_url: null,
        upscaled_image_url: null,
        svg_url: null,
      }));
      logToConsole("[Success] Erased noise saved! You can now re-trace.", "success");
    }
  }, [logToConsole]);

  const handleRemoveBgApplied = useCallback((publicUrl, errorMsg) => {
    if (errorMsg) {
      logToConsole(`[Error] Failed to remove background: ${errorMsg}`, "error");
    } else if (publicUrl) {
      setProject(prev => ({
        ...prev,
        original_image_url: publicUrl,
        generated_image_url: null,
        upscaled_image_url: null,
        svg_url: null,
      }));
      setUserCredits(prev => (prev > 0 ? prev - 1 : 0));
      logToConsole("[Success] Background removed! You can now re-trace.", "success");
    }
  }, [logToConsole]);

  const handleLogin = useCallback(async () => {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/api/auth/callback` },
    });
  }, []);

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="app-container">

      {/* Top Menu Bar */}
      <header style={{ padding: "16px 32px", display: "flex", alignItems: "center", borderBottom: "1px solid #444", background: "#1a1a1a" }}>
        <button onClick={() => router.push('/')} style={{ display: "flex", alignItems: "center", gap: "8px", background: "none", border: "none", color: "#666", cursor: "pointer", fontSize: "12px", textTransform: "uppercase", letterSpacing: "1px", fontWeight: "600", transition: "color 0.2s" }} onMouseEnter={e => e.currentTarget.style.color="#FFD700"} onMouseLeave={e => e.currentTarget.style.color="#666"}>
          <Home size={16} /> HOME
        </button>
        <div style={{ flex: 1, display: "flex", justifyContent: "center", alignItems: "center", gap: "10px" }}>
          <h1 style={{ fontSize: "14px", fontWeight: "600", margin: 0, color: "#fff", textTransform: "uppercase", letterSpacing: "2px" }}>WORKSPACE</h1>
        </div>
        <div style={{ width: "200px", display: "flex", justifyContent: "flex-end", gap: "16px", alignItems: "center" }}>
          <button onClick={() => setShowShortcuts(true)} style={{ display: "flex", alignItems: "center", gap: "8px", background: "none", border: "none", color: "#666", cursor: "pointer", fontSize: "11px", textTransform: "uppercase", letterSpacing: "1px", fontWeight: "600", transition: "color 0.2s" }} onMouseEnter={e => e.currentTarget.style.color="#FFD700"} onMouseLeave={e => e.currentTarget.style.color="#666"}>
            <Keyboard size={14} /> SHORTCUTS
          </button>
          <div onClick={() => setShowTopUpModal(true)} style={{ display: "flex", alignItems: "center", gap: "8px", background: "#2a2a2a", padding: "6px 12px", borderRadius: "0", cursor: "pointer", border: "1px solid #444", transition: "border-color 0.2s" }} onMouseOver={e => e.currentTarget.style.borderColor = "#FFD700"} onMouseOut={e => e.currentTarget.style.borderColor = "#444"}>
            <span style={{ color: "#FFD700", fontWeight: "bold", fontSize: "14px", fontFamily: "monospace" }}>{userCredits !== null ? userCredits : "-"}</span>
            <span style={{ color: "#888", fontSize: "10px", textTransform: "uppercase", letterSpacing: "1px" }}>CREDITS</span>
          </div>
        </div>
      </header>


      <main className="main-workspace" style={{ padding: 0 }}>
        {/* Split View Workspace */}
        <div className="canvas-area" style={{ padding: 0 }}>
          {!project ? (
            <div className="empty-state">
              <h3>Loading Document...</h3>
            </div>
          ) : (
            <SplitViewCanvas
              project={project}
              traceState={traceState}
              nodeErrors={nodeErrors}
              onCropOpen={() => setShowCropModal(true)}
              onEraseOpen={() => setShowEraseModal(true)}
              onRemoveBgOpen={() => setShowRemoveBgModal(true)}
            />
          )}
        </div>

        {/* Right Properties Panel */}
        <PropertiesPanel
          project={project}
          traceState={traceState}
          isSavingCrop={isSavingCrop}
          userCredits={userCredits}
          consoleRef={consoleRef}
          onExecuteTrace={onExecuteTrace}
          onDownloadSvg={handleDownloadSvg}
          onDownloadRaster={handleDownloadUpscaled}
          onDownloadAll={handleDownloadAll}
          onOpenCompare={() => setShowCompare(true)}
          onOpenCrop={() => setShowCropModal(true)}
          onOpenRemoveBg={() => setShowRemoveBgModal(true)}
          onOpenTopUp={() => setShowTopUpModal(true)}
        />
      </main>

      {/* ─── Modals ─────────────────────────────────────────────────────────── */}
      <CropModal
        show={showCropModal}
        project={project}
        supabase={supabase}
        onClose={() => setShowCropModal(false)}
        onCropApplied={handleCropApplied}
        onLoginRequired={handleLogin}
      />

      <EraseModal
        show={showEraseModal}
        project={project}
        supabase={supabase}
        onClose={() => setShowEraseModal(false)}
        onEraseApplied={handleEraseApplied}
        onLoginRequired={handleLogin}
      />

      <RemoveBgModal
        show={showRemoveBgModal}
        project={project}
        supabase={supabase}
        onClose={() => setShowRemoveBgModal(false)}
        onRemoveBgApplied={handleRemoveBgApplied}
      />

      <CompareModal
        show={showCompare}
        project={project}
        onClose={() => setShowCompare(false)}
        onDownloadAll={handleDownloadAll}
        onDownloadSvg={handleDownloadSvg}
      />

      <NoCreditsModal
        show={showNoCreditsModal}
        onClose={() => setShowNoCreditsModal(false)}
        onTopUp={() => setShowTopUpModal(true)}
      />

      <TopUpModal
        show={showTopUpModal}
        user={user}
        supabase={supabase}
        onClose={() => setShowTopUpModal(false)}
      />

      <ShortcutsModal
        show={showShortcuts}
        onClose={() => setShowShortcuts(false)}
      />
    </div>
  );
}
