"use client";

import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { useAppRouter } from "@/hooks/useAppRouter";
import { createClient } from "@/utils/supabase/client";
import { analytics } from "@/lib/analytics";
import LogoLoader from "@/components/ui/LogoLoader";
import DesktopRequiredNotice from "@/components/shared/DesktopRequiredNotice";
import StudioShell from "@/components/shared/StudioShell";
import ImageToolSplitWorkspace from "@/components/image-tools/ImageToolSplitWorkspace";
import ImageToolPropertiesPanel from "@/components/image-tools/ImageToolPropertiesPanel";
import { BG_REMOVER_TOOL } from "@/components/image-tools/toolPresets";
import styles from "@/components/image-tools/image-tool.module.css";
import { useIsMobileDevice } from "@/hooks/useIsMobileDevice";
import useBgRemoverUpload from "@/hooks/useBgRemoverUpload";
import useImageMetadata from "@/hooks/useImageMetadata";
import { safeJson } from "@/lib/safeJson";
import { clearGenerationRequestKey, getOrCreateGenerationRequestKey } from "@/lib/generationRequestKey";
import "@/components/image-tools/image-tool-workspace.css";

const TopUpModal = dynamic(() => import("@/components/ui/TopUpModal"), { ssr: false });
const LoginModal = dynamic(() => import("@/components/marketing/LoginModal"), { ssr: false });
const supabase = createClient();

export default function BgRemoverPage() {
  const router = useAppRouter();
  const params = useParams();
  const projectId = params.id;
  const isMobileDevice = useIsMobileDevice();
  const [project, setProject] = useState(null);
  const [user, setUser] = useState(null);
  const [userCredits, setUserCredits] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [previewSurface, setPreviewSurface] = useState("checker");
  const [showTopUp, setShowTopUp] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const sourceMeta = useImageMetadata(project?.original_image_url);
  const resultMeta = useImageMetadata(project?.generated_image_url);
  const requireLogin = useCallback(() => setShowLogin(true), []);
  const { retryPendingUpload, ...upload } = useBgRemoverUpload({ onRequireLogin: requireLogin });

  useEffect(() => {
    if (isMobileDevice !== false || !projectId) return;
    let isMounted = true;
    setProject(null);
    setErrorMsg("");
    setPreviewSurface("checker");
    async function fetchData() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session && isMounted) {
          setUser(session.user);
          analytics.authSession(session.user, { source: "bg_remover" });
        }
        const { data: projData, error: projError } = await supabase.from("projects").select("*").eq("id", projectId).single();
        if (projError || !projData || projData.trace_type !== "bg_remover") {
          if (isMounted) router.push("/");
          return;
        }
        if (isMounted) setProject(projData);
        if (session?.user) {
          const { data: profile } = await supabase.from("profiles").select("credits").eq("id", session.user.id).single();
          if (profile && isMounted) setUserCredits(profile.credits);
        }
      } catch (error) {
        analytics.error(error, { area: "bg_remover_fetch", project_id: projectId });
        if (isMounted) setErrorMsg("Could not load this image. Please return home and try again.");
      }
    }
    void fetchData();
    return () => { isMounted = false; };
  }, [isMobileDevice, projectId, router]);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) setTimeout(() => { setUser(session.user); setShowLogin(false); retryPendingUpload(); }, 0);
    });
    return () => subscription.unsubscribe();
  }, [retryPendingUpload]);

  const handleRemoveBg = async () => {
    if (!project?.id || isProcessing) return;
    setIsProcessing(true);
    setErrorMsg("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const requestKey = getOrCreateGenerationRequestKey("remove_bg", project.id);
      const res = await fetch("/api/remove-bg", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ projectId: project.id, keepOriginal: true, requestKey }),
      });
      const data = await safeJson(res, "Failed to remove background");
      if (res.status === 409 && data.error === "ALREADY_PROCESSED") {
        const { data: freshProj } = await supabase.from("projects").select("*").eq("id", project.id).single();
        if (freshProj) setProject(freshProj);
        return;
      }
      if (res.status === 409 && data.code === "GENERATION_IN_PROGRESS") {
        setErrorMsg(data.error);
        return;
      }
      if (!res.ok) {
        clearGenerationRequestKey("remove_bg", project.id);
        throw new Error(data.error || "Failed to remove background");
      }
      clearGenerationRequestKey("remove_bg", project.id);
      setProject(prev => ({ ...prev, generated_image_url: data.transparent_image_url }));
      if (userCredits !== null) setUserCredits(prev => prev - 1);
    } catch (error) {
      analytics.error(error, { area: "bg_remove_processing", project_id: project.id });
      setErrorMsg(error.message);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          const { data: profile } = await supabase.from("profiles").select("credits").eq("id", session.user.id).single();
          if (profile) setUserCredits(profile.credits);
        }
      } catch { /* Non-fatal balance refresh after a refunded failure. */ }
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
      analytics.trackEvent?.("download_transparent_png", { project_id: project.id, trace_type: "bg_remover" });
    } finally {
      setIsDownloading(false);
    }
  };

  if (isMobileDevice !== false) return <DesktopRequiredNotice />;
  if (!project) return <div className={styles.loadingScreen}>{errorMsg || <LogoLoader size={72} color="#f4f4f1" />}</div>;

  const resultUrl = project.generated_image_url || null;
  const noCredits = userCredits !== null && userCredits <= 0;
  const resolution = resultMeta || sourceMeta;
  const onCredits = () => user ? setShowTopUp(true) : setShowLogin(true);
  const onRun = noCredits ? onCredits : handleRemoveBg;

  return (
    <>
      <StudioShell
        className={`image-tool-workspace-ui ${styles.toolShell}`}
        title="BG REMOVER" credits={userCredits} onHome={() => router.push("/")} onCreditsClick={onCredits}
        statusLeft={resultUrl ? <><CheckCircle2 size={12} /><span>Background removed</span><small>Transparent PNG is ready for export.</small></> : <span>{isProcessing ? "Creating transparent cutout…" : "Source ready"}</span>}
      >
        <input {...upload.inputProps} />
        <main className={styles.workspaceLayout} onDragOver={upload.dropProps.onDragOver} onDrop={(event) => { if (isProcessing) event.preventDefault(); else upload.dropProps.onDrop(event); }}>
          <ImageToolSplitWorkspace
            key={project.id} tool={BG_REMOVER_TOOL} sourceUrl={project.original_image_url} resultUrl={resultUrl}
            isProcessing={isProcessing} errorMessage={errorMsg} onRun={onRun}
            canRun={!isProcessing && !upload.isUploading} noCredits={noCredits} previewSurface={previewSurface}
          />
          <ImageToolPropertiesPanel
            tool={BG_REMOVER_TOOL} fileName={project.name} sourceMeta={sourceMeta}
            isProcessing={isProcessing} isUploading={upload.isUploading} isDownloading={isDownloading}
            hasProcessableSource={Boolean(project.original_image_url)} noCredits={noCredits} resultUrl={resultUrl}
            onRun={onRun} onDownload={handleDownload}
            onReplace={upload.chooseFile} onNewImage={() => router.push("/bg-remover")}
            previewSurface={previewSurface} onPreviewSurfaceChange={setPreviewSurface}
            outputRows={[
              ["Resolution", resolution ? `${resolution.width} × ${resolution.height}` : "Reading image…"],
              ["Format", "Lossless PNG"], ["Background", "Transparent"], ["Subject", "Preserved"],
            ]}
          />
        </main>
      </StudioShell>
      <LoginModal show={showLogin} onClose={() => setShowLogin(false)} supabase={supabase} />
      {showTopUp && <TopUpModal user={user} onClose={() => setShowTopUp(false)} />}
    </>
  );
}
