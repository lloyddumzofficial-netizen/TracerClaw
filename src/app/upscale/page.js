"use client";

import { Suspense, useState, useRef, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { CheckCircle2 } from "lucide-react";
import { toast } from "@/components/ui/Toast";
import { createClient } from "@/utils/supabase/client";
import { useAppRouter } from "@/hooks/useAppRouter";
import { analytics } from "@/lib/analytics";
import { formatUploadLimit, resolveImageUploadLimit } from "@/lib/uploadLimits";
import { safeJson } from "@/lib/safeJson";
import { UPSCALE_FACTOR, UPSCALE_LIMIT_MESSAGE, getUpscalePlan } from "@/lib/standaloneUpscale";
import { readUpscaleAttempt, saveUpscaleAttempt, resolveUpscaleAttempt, restoreUpscaleProject } from "@/lib/upscaleAttempt";
import useUpscaleProject from "@/hooks/useUpscaleProject";
import useSettingsPanel from "@/hooks/useSettingsPanel";
import ImageToolSettingsToggle from "@/components/image-tools/ImageToolSettingsToggle";
import LogoLoader from "@/components/ui/LogoLoader";
import DesktopRequiredNotice from "@/components/shared/DesktopRequiredNotice";
import StudioShell from "@/components/shared/StudioShell";
import UpscaleSplitWorkspace from "@/components/upscale/UpscaleSplitWorkspace";
import UpscalePropertiesPanel from "@/components/upscale/UpscalePropertiesPanel";
import UpscaleEntryScreen from "@/components/upscale/UpscaleEntryScreen";
import { useIsMobileDevice } from "@/hooks/useIsMobileDevice";
import "../home.css";
import "@/components/image-tools/image-tool-workspace.css";
import styles from "@/components/image-tools/image-tool.module.css";

const TopUpModal = dynamic(() => import("@/components/ui/TopUpModal"), { ssr: false });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const UPSCALE_POLL_MAX_MS = 6 * 60 * 1000;

function formatSourceFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "Cloud source";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function resolveSourceFormat(file, url) {
  if (file?.type) return file.type.replace("image/", "").toUpperCase().replace("JPEG", "JPG");
  const match = String(url || "").match(/\.([a-z0-9]{2,5})(?:[?#]|$)/i);
  return match ? match[1].toUpperCase().replace("JPEG", "JPG") : "Image";
}

function assessSourceQuality(width, height) {
  const longestEdge = Math.max(width, height);
  if (longestEdge < 900) return { label: "Low resolution", tone: "low" };
  if (longestEdge < 1800) return { label: "Usable source", tone: "medium" };
  return { label: "Strong source", tone: "high" };
}

function upscalePollDelay(attempt) {
  if (attempt < 10) return 3000;
  if (attempt < 22) return 5000;
  return 10000;
}

async function uploadImageThroughServer({ token, file }) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("purpose", "standard");

  const response = await fetch("/api/upload-direct", {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}` },
    body: formData,
  });
  const data = await safeJson(response, "Fallback upload failed");

  if (!response.ok || !data.publicUrl) {
    throw new Error(data.error || "Fallback upload failed");
  }

  return data.publicUrl;
}

// Surfaced in the button label so the cost is known before the click, matching
// the workspace trace panel and the background-removal modal. This page was the
// only paid action that revealed its price only after the user had committed.
const UPSCALE_CREDIT_COST = 1;

export default function UpscalePage() {
  return <Suspense fallback={<div className={styles.loadingScreen} role="status"><LogoLoader size={48} color="#F4F4F1" /></div>}><UpscaleStudio /></Suspense>;
}

function UpscaleStudio() {
  const router = useAppRouter();
  const requestedProjectId = useSearchParams().get("projectId");
  const fileInputRef = useRef(null);
  const isProcessingRef = useRef(false);
  const upscaleAttemptRef = useRef(null);
  const restoredUserRef = useRef(null);
  const activePollsRef = useRef(new Map());
  const operationRef = useRef(0);
  const supabase = createClient();
  const isMobileDevice = useIsMobileDevice();

  const [isProcessing, setIsProcessing] = useState(false);
  const [upscaleError, setUpscaleError] = useState(null);
  const [upscaledImage, setUpscaledImage] = useState(null);
  const [previewImage, setPreviewImage] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [selectedUrl, setSelectedUrl] = useState(null);
  const [user, setUser] = useState(null);
  const [credits, setCredits] = useState(0);
  const [showTopUpModal, setShowTopUpModal] = useState(false);
  const [activeProjectName, setActiveProjectName] = useState(null);
  const [sourceMeta, setSourceMeta] = useState(null);
  const [upscaleProfile, setUpscaleProfile] = useState("photo");
  const { settingsOpen, closeSettings, openSettings, closeButtonRef } = useSettingsPanel();
  const [processingStatus, setProcessingStatus] = useState("Enhancing image");
  const { project: requestedProject, error: projectError } = useUpscaleProject(supabase, user?.id, requestedProjectId);

  const noCredits = credits < UPSCALE_CREDIT_COST && !upscaleAttemptRef.current;

  const [uploadComparePosition, setUploadComparePosition] = useState(50);

  useEffect(() => {
    if (!requestedProjectId) return;
    operationRef.current++;
    upscaleAttemptRef.current = null;
    isProcessingRef.current = false;
    setIsProcessing(false);
    setPreviewImage(null);
    setUpscaledImage(null);
    setUpscaleError(null);
  }, [requestedProjectId]);

  useEffect(() => {
    if (!previewImage) {
      setSourceMeta(null);
      return undefined;
    }

    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (cancelled) return;
      const width = image.naturalWidth;
      const height = image.naturalHeight;
      setSourceMeta({
        width,
        height,
        outputWidth: width * UPSCALE_FACTOR,
        outputHeight: height * UPSCALE_FACTOR,
        format: resolveSourceFormat(selectedFile, previewImage),
        fileSize: formatSourceFileSize(selectedFile?.size),
        quality: assessSourceQuality(width, height),
      });
    };
    image.onerror = () => {
      if (!cancelled) setSourceMeta(null);
    };
    image.src = previewImage;

    return () => {
      cancelled = true;
    };
  }, [previewImage, selectedFile]);

  useEffect(() => {
    if (isMobileDevice !== false) return;
    const fetchSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        setUser(session.user);
        analytics.authSession(session.user, { source: "upscale" });
        fetchCredits(session.user.id);
      } else {
        router.push("/");
      }
    };
    fetchSession();
  }, [isMobileDevice, router, supabase]);

  const fetchCredits = async (userId) => {
    const { data } = await supabase.from("profiles").select("credits").eq("id", userId).single();
    if (data) setCredits(data.credits);
  };

  useEffect(() => {
    const checkPendingImage = () => {
      if (requestedProjectId) return;
      const pendingUrl = sessionStorage.getItem("pendingMobileImage");
      if (pendingUrl && user) {
        sessionStorage.removeItem("pendingMobileImage");
        setPreviewImage(pendingUrl);
        setSelectedUrl(pendingUrl);
        setSelectedFile(null);
        setSourceMeta(null);
        setUpscaledImage(null);
        setUpscaleError(null);
        setActiveProjectName("Mobile upload");
        upscaleAttemptRef.current = null;
        saveUpscaleAttempt(user.id, null);
      }
    };
    checkPendingImage();
    const handleEvent = () => checkPendingImage();
    window.addEventListener("mobileImageRouted", handleEvent);
    return () => window.removeEventListener("mobileImageRouted", handleEvent);
  }, [user, requestedProjectId]);

  const handleDragOver = (e) => { e.preventDefault(); e.stopPropagation(); };
  const handleDrop = (e) => {
    e.preventDefault(); e.stopPropagation();
    if (e.dataTransfer.files?.length > 0) handleFileSelected(e.dataTransfer.files[0]);
  };

  const handleFileSelected = (file) => {
    if (!file || isProcessingRef.current) return;
    const maxUploadBytes = resolveImageUploadLimit();
    if (file.size > maxUploadBytes) {
      toast.error(`File is too large! Maximum allowed size is ${formatUploadLimit(maxUploadBytes)}.`);
      return;
    }
    if (previewImage?.startsWith("blob:")) URL.revokeObjectURL(previewImage);
    const objUrl = URL.createObjectURL(file);
    operationRef.current++;
    setPreviewImage(objUrl);
    setSelectedFile(file);
    setSourceMeta(null);
    setSelectedUrl(null);
    setUpscaledImage(null);
    setUpscaleError(null);
    setActiveProjectName(file.name);
    setUpscaleProfile(current => current || "photo");
    if (requestedProjectId) router.replace("/upscale", { scroll: false });
    upscaleAttemptRef.current = null;
    saveUpscaleAttempt(user?.id, null);
  };

  const resetWorkspace = () => {
    operationRef.current++;
    if (previewImage?.startsWith("blob:")) URL.revokeObjectURL(previewImage);
    setPreviewImage(null);
    setSelectedFile(null);
    setSelectedUrl(null);
    setUpscaledImage(null);
    setUpscaleError(null);
    setActiveProjectName(null);
    setUpscaleProfile("photo");
    upscaleAttemptRef.current = null;
    saveUpscaleAttempt(user?.id, null);
    if (requestedProjectId) router.replace("/upscale", { scroll: false });
    if (fileInputRef.current) fileInputRef.current.value = "";
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
      const data = await safeJson(res, "Failed to get upload URL");
      if (!res.ok || !data.uploadUrl) throw new Error(data.error || "Failed to get upload URL");

      const { uploadUrl, publicUrl } = data;

      try {
        const uploadRes = await fetch(uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": file.type },
          body: file,
        });
        if (!uploadRes.ok) throw new Error("Failed to upload image to S3");
      } catch (uploadError) {
        console.warn("Direct upscale upload failed, retrying through server:", uploadError);
        return uploadImageThroughServer({ token, file });
      }
      return publicUrl;
    } catch (error) {
      console.error(error);
      analytics.error(error, { area: "upscale_upload" });
      throw new Error("Image upload failed");
    }
  };

  const pollUpscaleJob = useCallback(async ({ requestId, projectId, token, maxAttempts = 120 }) => {
    const pollKey = `${projectId}:${requestId}`;
    const activePoll = activePollsRef.current.get(pollKey);
    if (activePoll) return activePoll;

    const pollPromise = (async () => {
      const deadline = Date.now() + UPSCALE_POLL_MAX_MS;

      for (let attempt = 0; attempt < maxAttempts && Date.now() < deadline; attempt++) {
        const params = new URLSearchParams({ projectId });
        if (requestId) params.set("requestId", requestId);
        const statusRes = await fetch(`/api/upscale?${params}`, {
          headers: { "Authorization": `Bearer ${token}` },
          cache: "no-store",
        });
        const statusData = await safeJson(statusRes, "Failed to check upscale status");
        if (!statusRes.ok) {
          const error = new Error(statusData.error || "Failed to check upscale status");
          error.attemptFinished = statusData.refunded === true;
          throw error;
        }

        if (statusData.status === "COMPLETED" && statusData.upscaledUrl) {
          return statusData.upscaledUrl;
        }
        if (upscaleAttemptRef.current?.projectId === projectId) setProcessingStatus(statusData.status === "IN_QUEUE" ? "Queued" : "Enhancing image");

        const remainingMs = deadline - Date.now();
        if (attempt < maxAttempts - 1 && remainingMs > 0) {
          await sleep(Math.min(upscalePollDelay(attempt), remainingMs));
        }
      }

      return null;
    })();

    activePollsRef.current.set(pollKey, pollPromise);
    try {
      return await pollPromise;
    } finally {
      activePollsRef.current.delete(pollKey);
    }
  }, []);

  const handleUpscale = async () => {
    if (isProcessingRef.current) return;
    if (!selectedFile && !selectedUrl) return;
    if (!sourceMeta || !getUpscalePlan(sourceMeta.width, sourceMeta.height).allowed) {
      setUpscaleError(UPSCALE_LIMIT_MESSAGE);
      toast.error(UPSCALE_LIMIT_MESSAGE);
      return;
    }
    // Kept as a safety net, but the button now reads "Get More Claws" whenever
    // this would trigger, so the user learns the cost before committing rather
    // than after.
    if (noCredits) {
      setShowTopUpModal(true);
      return;
    }
    if (requestedProjectId && !upscaleAttemptRef.current) {
      restoredUserRef.current = `${user.id}:saved`;
      router.replace("/upscale", { scroll: false });
    }
    isProcessingRef.current = true;
    const operationId = ++operationRef.current;
    setIsProcessing(true);
    setUpscaledImage(null);
    setUpscaleError(null);
    setProcessingStatus(upscaleAttemptRef.current?.projectId ? "Checking saved job" : "Uploading source");

    try {
      let attempt = upscaleAttemptRef.current;
      if (attempt) setUpscaleProfile(attempt.profile);
      let finalUrl = attempt?.imageUrl || selectedUrl;

      // If it's a raw file, we must upload to S3 first
      if (!attempt && selectedFile) {
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

      if (operationRef.current !== operationId) return;
      attempt ||= { requestKey: crypto.randomUUID(), imageUrl: finalUrl, profile: upscaleProfile, name: activeProjectName, createdAt: Date.now() };
      upscaleAttemptRef.current = attempt;
      const save = next => { if (operationRef.current === operationId) saveUpscaleAttempt(user.id, next); };
      save(attempt); // Persist before POST: its response may be lost.
      setProcessingStatus(attempt.projectId ? "Checking saved job" : "Submitting request");
      const upscaledUrl = await resolveUpscaleAttempt({ attempt, token, poll: pollUpscaleJob, onUpdate: save });
      if (operationRef.current !== operationId) return;
      attempt.upscaledUrl = upscaledUrl;
      save(attempt);

      setUpscaledImage(upscaledUrl);
      toast.success("Upscale complete. Your PNG is ready to download.");
      fetchCredits(user.id);

    } catch (err) {
      if (operationRef.current !== operationId) return;
      if (err.attemptFinished) {
        upscaleAttemptRef.current = null;
        setUpscaleProfile(current => current || "photo");
        saveUpscaleAttempt(user.id, null);
        fetchCredits(user.id);
      }
      setUpscaleError(err.message || "The upscale could not be completed.");
      analytics.error(err, { area: "upscale_processing" });
      toast.error(err.message || "An error occurred");
    } finally {
      if (operationRef.current === operationId) {
        isProcessingRef.current = false;
        setIsProcessing(false);
      }
    }
  };

  const handleDownload = async (url) => {
    if (!url || url === "REFUNDED") {
      toast.error("Upscale is still processing. Please try again in a moment.");
      return;
    }

    const fileName = `upscaled_${Date.now()}.png`;
    const proxyUrl = `/api/proxy?url=${encodeURIComponent(url)}&download=${encodeURIComponent(fileName)}`;
    const a = document.createElement('a');
    a.href = proxyUrl;
    a.download = fileName;
    a.rel = "noopener";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  useEffect(() => {
    if (!user || (requestedProjectId && requestedProject?.id !== requestedProjectId)) return;
    const restorationKey = `${user.id}:${requestedProjectId || "saved"}`;
    if (restoredUserRef.current === restorationKey) return;
    restoredUserRef.current = restorationKey;
    const saved = readUpscaleAttempt(user.id);
    const attempt = requestedProjectId ? restoreUpscaleProject(requestedProject, saved) : saved;
    if (!attempt || (!requestedProjectId && (upscaleAttemptRef.current || previewImage || sessionStorage.getItem("pendingMobileImage")))) return;
    upscaleAttemptRef.current = attempt;
    const operationId = ++operationRef.current;
    setUpscaledImage(null);
    isProcessingRef.current = false;
    setIsProcessing(false);
    setSelectedFile(null);
    setSelectedUrl(attempt.imageUrl);
    setPreviewImage(attempt.imageUrl);
    setActiveProjectName(attempt.name || "Uploaded artwork");
    setUpscaleProfile(attempt.profile);
    setUpscaleError(null);
    if (requestedProject?.refunded || requestedProject?.generated_image_url === "REFUNDED") {
      upscaleAttemptRef.current = null;
      setUpscaleProfile("photo");
      setUpscaleError("This generation failed and was refunded. You can choose an image type and start a new generation.");
      return;
    }
    if (attempt.upscaledUrl) {
      saveUpscaleAttempt(user.id, attempt);
      setUpscaledImage(attempt.upscaledUrl);
      return;
    }
    isProcessingRef.current = true;
    setIsProcessing(true);
    setProcessingStatus("Checking saved job");
    let cancelled = false;
    const isCurrent = () => !cancelled && operationRef.current === operationId;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error("Unauthorized");
        const url = await resolveUpscaleAttempt({ attempt, token: session.access_token, poll: pollUpscaleJob,
          onUpdate: next => { if (isCurrent()) saveUpscaleAttempt(user.id, next); } });
        if (!isCurrent()) return;
        attempt.upscaledUrl = url;
        saveUpscaleAttempt(user.id, attempt);
        setUpscaledImage(url);
      } catch (error) {
        if (!isCurrent()) return;
        if (error.attemptFinished) {
          upscaleAttemptRef.current = null;
          setUpscaleProfile(current => current || "photo");
          saveUpscaleAttempt(user.id, null);
        }
        setUpscaleError(error.message);
      } finally {
        if (isCurrent()) {
          isProcessingRef.current = false;
          setIsProcessing(false);
        }
        fetchCredits(user.id);
      }
    })();
    return () => { cancelled = true; };
  }, [user, requestedProjectId, requestedProject, pollUpscaleJob, supabase]);

  if (isMobileDevice !== false) {
    return <DesktopRequiredNotice />;
  }

  const activeFileName = selectedFile?.name || activeProjectName || (previewImage ? "Mobile upload" : null);
  const sourceLimitError = sourceMeta && !getUpscalePlan(sourceMeta.width, sourceMeta.height).allowed ? UPSCALE_LIMIT_MESSAGE : null;
  const hasProcessableSource = Boolean((selectedFile || selectedUrl) && sourceMeta && !sourceLimitError);

  return (
    <>
      <StudioShell
        className={`image-tool-workspace-ui ${styles.toolShell}`}
        title="UPSCALE STUDIO"
        credits={credits}
        onHome={() => router.push("/")}
        onCreditsClick={() => setShowTopUpModal(true)}
        statusLeft={upscaledImage ? (
          <>
            <CheckCircle2 size={12} color="#4ade80" />
            <span style={{ color: "#4ade80" }}>Upscale complete</span>
            <small>Your image is ready for download.</small>
          </>
        ) : (
          <span>{isProcessing ? `${processingStatus}…` : previewImage ? "Ready to upscale" : "Waiting for image"}</span>
        )}
      >


        <input
          type="file"
          ref={fileInputRef}
          onChange={(event) => {
            handleFileSelected(event.target.files?.[0]);
            event.target.value = "";
          }}
          accept="image/png,image/jpeg,image/webp"
          className="upscale-file-input"
        />


        <main
          className={previewImage ? `${styles.workspaceLayout} ${!settingsOpen ? styles.settingsCollapsedLayout : ""}` : "main-workspace upscale-studio is-empty-state"}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          {!previewImage && requestedProjectId ? (
            <section className="canvas-area upscale-canvas" aria-label="Open saved upscale">
              <div className={styles.outputPlaceholder} role={projectError ? "alert" : "status"}>
                {projectError ? <><strong>Could not open this upscale</strong><p>{projectError}</p><button type="button" onClick={resetWorkspace}>Choose another image</button><button type="button" onClick={() => router.push("/")}>Back to projects</button></> : <><LogoLoader size={48} color="#F4F4F1" /><p>Opening saved upscale…</p></>}
              </div>
            </section>
          ) : previewImage ? (
            <>
              <UpscaleSplitWorkspace
                sourceUrl={previewImage}
                resultUrl={upscaledImage}
                isProcessing={isProcessing}
                errorMessage={sourceLimitError || upscaleError}
                onRun={handleUpscale}
                canRun={hasProcessableSource && !isProcessing}
                noCredits={noCredits}
                processingStatus={processingStatus}
              />
              {settingsOpen ? <UpscalePropertiesPanel
                profile={upscaleProfile}
                onProfileChange={setUpscaleProfile}
                fileName={activeFileName}
                sourceMeta={sourceMeta}
                isProcessing={isProcessing}
                hasProcessableSource={hasProcessableSource}
                noCredits={noCredits}
                resultUrl={upscaledImage}
                onRun={handleUpscale}
                onDownload={() => upscaledImage && handleDownload(upscaledImage)}
                onReplace={() => fileInputRef.current?.click()}
                onNewImage={resetWorkspace}
                processingStatus={processingStatus}
                onClose={closeSettings}
                closeButtonRef={closeButtonRef}
              /> : <ImageToolSettingsToggle title="Image Upscale Settings" onOpen={openSettings} />}
            </>
          ) : (
            <section className="canvas-area upscale-canvas" aria-label="Choose artwork to upscale">
              <div className="upscale-canvas-body">
                <UpscaleEntryScreen
                  comparePosition={uploadComparePosition}
                  onChooseFile={() => fileInputRef.current?.click()}
                  onCompareChange={(event) => setUploadComparePosition(Number(event.currentTarget.value))}
                />
              </div>
            </section>
          )}
        </main>

      </StudioShell>

      {showTopUpModal && <TopUpModal onClose={() => setShowTopUpModal(false)} user={user} />}
    </>
  );
}
