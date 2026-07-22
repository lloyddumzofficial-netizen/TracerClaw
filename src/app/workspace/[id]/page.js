"use client";

// ─── React & Routing ──────────────────────────────────────────────────────────
import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";

// ─── Data & Auth ──────────────────────────────────────────────────────────────
import { createClient } from "@/utils/supabase/client";

// ─── Icons ────────────────────────────────────────────────────────────────────
import { CheckCircle2 } from "lucide-react";

// ─── Hooks ────────────────────────────────────────────────────────────────────
import { useTraceExecution } from "./hooks/useTraceExecution";

// ─── Components ───────────────────────────────────────────────────────────────
import SplitViewCanvas from "./components/SplitViewCanvas";
import PropertiesPanel from "./components/PropertiesPanel";
import CropModal from "./components/CropModal";
import EraseModal from "./components/EraseModal";
import RemoveBgModal from "./components/RemoveBgModal";
import CompareModal from "./components/CompareModal";
import PalettePreviewModal from "./components/PalettePreviewModal";
import NoCreditsModal from "./components/NoCreditsModal";
import ShortcutsModal from "./components/ShortcutsModal";
import WorkspaceCommandBar from "./components/WorkspaceCommandBar";
import DesktopRequiredNotice from "@/app/components/DesktopRequiredNotice";
import StudioShell from "@/app/components/StudioShell";
import { useIsMobileDevice } from "@/app/hooks/useIsMobileDevice";
import { safeJson } from "@/lib/safeJson";
import { formatSavedAgo } from "@/lib/formatSavedAgo";
import { getWorkspaceTitle } from "@/lib/workspaceLabels";

// ─── Supabase client — created ONCE at module level, not inside the component ─
const supabase = createClient();

function svgTextToBase64(svgText) {
  const bytes = new TextEncoder().encode(svgText);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return window.btoa(binary);
}

const TopUpModal = dynamic(() => import("@/components/TopUpModal"), { ssr: false });


export default function Workspace() {
  const router = useRouter();
  const params = useParams();
  const projectId = params.id;
  const isMobileDevice = useIsMobileDevice();

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
  const [showPalettePreview, setShowPalettePreview] = useState(false);
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
    if (isMobileDevice !== false) return;
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
          if (profile) {
            setUserCredits(profile.credits);
          }
        }
      } catch (err) {
        console.error("[Workspace] Data fetch error:", err);
      }
    };
    fetchData();
  }, [isMobileDevice, projectId, router]);

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

  const handleApplyEditedSvg = useCallback(async (svgText) => {
    if (!project?.id || !svgText) return;

    logToConsole("[System] Saving edited SVG to workspace...");

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Please log in again before saving.");

      const res = await fetch("/api/save-asset", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          projectId: project.id,
          step: 3,
          mimeType: "image/svg+xml",
          base64: svgTextToBase64(svgText),
        }),
      });

      const data = await safeJson(res, "Failed to apply edited SVG");
      setProject(prev => prev ? ({
        ...prev,
        svg_url: data.url,
        zip_url: null,
        zip_signature: null,
        zip_generated_at: null,
      }) : prev);
      setShowPalettePreview(false);
      logToConsole("[Success] Edited SVG applied to workspace.", "success");
      return data.url;
    } catch (err) {
      logToConsole(`[Error] Failed to apply edited SVG: ${err.message}`, "error");
      throw err;
    }
  }, [project?.id, logToConsole]);

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
      const data = await safeJson(res, "Failed to prepare ZIP");
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
  const onExecuteTrace = useCallback(async (vectorColors, svgEngine) => {
    const result = await handleExecuteTrace(vectorColors, svgEngine);
    if (result?.success) {
      setShowPalettePreview(true);
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
    setActiveTool("pointer");
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
    setActiveTool("pointer");
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
    setActiveTool("pointer");
  }, [logToConsole]);

  const handleLogin = useCallback(async () => {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/api/auth/callback` },
    });
  }, []);

  // ─── Render ───────────────────────────────────────────────────────────────
  // Format "Saved X minutes ago" for the project bar
  const savedAgo = formatSavedAgo(project?.updated_at);
  const isBusy = traceState !== "idle" || isSavingCrop;
  const hasProject = !!project;
  const hasRaster = !!project?.upscaled_image_url || !!project?.generated_image_url;
  const hasSvg = !!project?.svg_url;
  const workspaceTitle = getWorkspaceTitle(project?.trace_type);

  if (isMobileDevice !== false) {
    return <DesktopRequiredNotice />;
  }

  return (
    <>
      <StudioShell
        title={workspaceTitle}
        projectName={project?.name}
        savedAgo={savedAgo}
        credits={userCredits}
        onHome={() => router.push("/")}
        onCreditsClick={() => setShowTopUpModal(true)}
        onShortcuts={() => setShowShortcuts(true)}
        commandBar={project && (
          <WorkspaceCommandBar
            activeTool={activeTool}
            isBusy={isBusy}
            hasProject={hasProject}
            hasRaster={hasRaster}
            hasSvg={hasSvg}
            hasUpscaled={!!project?.upscaled_image_url}
            onSelectTool={setActiveTool}
            onOpenCrop={() => setShowCropModal(true)}
            onOpenErase={() => setShowEraseModal(true)}
            onOpenRemoveBg={() => setShowRemoveBgModal(true)}
            onOpenCompare={() => setShowCompare(true)}
            onDownloadSvg={handleDownloadSvg}
            onDownloadPng={handleDownloadUpscaled}
            onDownloadZip={handleDownloadAll}
          />
        )}
        statusLeft={project?.svg_url ? (
          <>
            <CheckCircle2 size={12} color="#4ade80" />
            <span style={{ color: "#4ade80" }}>Vectorization complete</span>
            <small>Clean shapes, optimized paths, and high quality output.</small>
          </>
        ) : project ? (
          <span>{traceState !== "idle" ? "Processing trace..." : "Ready"}</span>
        ) : null}
        statusRight={(
          <>
            <button onClick={() => setShowShortcuts(true)}>Need help?</button>
            <span style={{ color: "#333" }}>·</span>
            <button>&gt; View Guide</button>
          </>
        )}
      >


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
          onOpenPalettePreview={() => setShowPalettePreview(true)}
          onOpenCrop={() => setShowCropModal(true)}
          onOpenRemoveBg={() => setShowRemoveBgModal(true)}
          onOpenTopUp={() => setShowTopUpModal(true)}
        />
      </main>

      </StudioShell>

      {/* ─── Modals ─────────────────────────────────────────────────────────── */}
      <CropModal
        show={showCropModal}
        project={project}
        supabase={supabase}
        onClose={() => { setShowCropModal(false); setActiveTool("pointer"); }}
        onCropApplied={handleCropApplied}
        onLoginRequired={handleLogin}
      />

      <EraseModal
        show={showEraseModal}
        project={project}
        supabase={supabase}
        onClose={() => { setShowEraseModal(false); setActiveTool("pointer"); }}
        onEraseApplied={handleEraseApplied}
        onLoginRequired={handleLogin}
      />

      <RemoveBgModal
        show={showRemoveBgModal}
        project={project}
        supabase={supabase}
        onClose={() => { setShowRemoveBgModal(false); setActiveTool("pointer"); }}
        onRemoveBgApplied={handleRemoveBgApplied}
      />

      <CompareModal
        show={showCompare}
        project={project}
        onClose={() => setShowCompare(false)}
        onDownloadAll={handleDownloadAll}
        onDownloadSvg={handleDownloadSvg}
      />

      <PalettePreviewModal
        show={showPalettePreview && Boolean(project?.svg_url)}
        project={project}
        onClose={() => setShowPalettePreview(false)}
        onCompare={() => {
          setShowPalettePreview(false);
          setShowCompare(true);
        }}
        onDownloadAll={handleDownloadAll}
        onDownloadSvg={handleDownloadSvg}
        onApplyEditedSvg={handleApplyEditedSvg}
      />

      <NoCreditsModal
        show={showNoCreditsModal}
        onClose={() => setShowNoCreditsModal(false)}
        onTopUp={() => setShowTopUpModal(true)}
      />

      {showTopUpModal && (
        <TopUpModal
          show={showTopUpModal}
          user={user}
          supabase={supabase}
          onClose={() => setShowTopUpModal(false)}
        />
      )}

      <ShortcutsModal
        show={showShortcuts}
        onClose={() => setShowShortcuts(false)}
      />
    </>
  );
}
