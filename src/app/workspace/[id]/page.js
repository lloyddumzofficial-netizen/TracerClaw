"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { ArrowLeft, Download, Home, MousePointer2, Hand, ZoomIn, Crop, Keyboard } from "lucide-react";

// Hooks
import { useTraceExecution } from "./hooks/useTraceExecution";

// Components
import SplitViewCanvas from "./components/SplitViewCanvas";
import PropertiesPanel from "./components/PropertiesPanel";
import CropModal from "./components/CropModal";
import EraseModal from "./components/EraseModal";
import CompareModal from "./components/CompareModal";
import NoCreditsModal from "./components/NoCreditsModal";
import TopUpModal from "@/components/TopUpModal";
import ShortcutsModal from "./components/ShortcutsModal";

// Supabase client — created ONCE at module level, not inside the component
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

        if (!projData.generated_image_url) setShowCropModal(true);

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
    try {
      const response = await fetch(url);
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

  const handleDownloadSvg = useCallback(() => {
    if (!project?.svg_url) return;
    forceDownload(project.svg_url, `DesaynClaw_${project.name}_Vector.svg`);
  }, [project, forceDownload]);

  const handleDownloadRaster = useCallback(() => {
    if (!project?.generated_image_url) return;
    forceDownload(project.generated_image_url, `DesaynClaw_${project.name}_Raster.png`);
  }, [project, forceDownload]);

  const handleDownloadAll = useCallback(async () => {
    if (!project) return;
    logToConsole("[System] Zipping all assets...");
    try {
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      const urls = [
        project.original_image_url && { url: project.original_image_url, name: `DesaynClaw_${project.name}_Reference.png` },
        project.generated_image_url && { url: project.generated_image_url, name: `DesaynClaw_${project.name}_DesaynVision.png` },
        project.upscaled_image_url && { url: project.upscaled_image_url, name: `DesaynClaw_${project.name}_Upscaled.png` },
        project.svg_url && { url: project.svg_url, name: `DesaynClaw_${project.name}_Vector.svg` },
      ].filter(Boolean);

      for (const item of urls) {
        try {
          const res = await fetch(`/api/proxy-image?url=${encodeURIComponent(item.url)}`);
          zip.file(item.name, await res.blob());
        } catch {
          // Skip failed file — don't abort the whole zip
        }
      }

      const content = await zip.generateAsync({ type: "blob" });
      const objectUrl = URL.createObjectURL(content);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = `DesaynClaw_${project.name}_AllFiles.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(objectUrl);
      logToConsole("[Success] Downloaded ZIP folder!", "success");
    } catch (err) {
      logToConsole(`[Error] Failed to zip: ${err.message}`, "error");
    }
  }, [project, logToConsole]);

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
      <div className="menu-bar">
        <div className="menu-item" onClick={() => router.push("/")} style={{ cursor: "pointer" }}>
          <Home size={12} style={{ marginRight: 4, display: "inline-block" }} /> Home
        </div>
        <div className="brand-title">
          <img src="/logo_full.png" alt="DESAYNBRO" style={{ height: 12 }} />
          DESAYNCLAW WORKSPACE
        </div>
        <div className="menu-item" onClick={() => setShowShortcuts(true)} style={{ cursor: "pointer", marginLeft: "auto", marginRight: "16px" }}>
          <Keyboard size={14} style={{ marginRight: 4, display: "inline-block" }} /> Shortcuts
        </div>
      </div>


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
          onDownloadAll={handleDownloadAll}
          onOpenCompare={() => setShowCompare(true)}
          onOpenCrop={() => setShowCropModal(true)}
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
