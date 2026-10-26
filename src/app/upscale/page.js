"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import { CheckCircle2 } from "lucide-react";
import { toast } from "@/components/ui/Toast";
import { createClient } from "@/utils/supabase/client";
import { useAppRouter } from "@/hooks/useAppRouter";
import { analytics } from "@/lib/analytics";
import { formatUploadLimit, resolveImageUploadLimit } from "@/lib/uploadLimits";
import { safeJson } from "@/lib/safeJson";
import { UPSCALE_FACTOR, UPSCALE_LIMIT_MESSAGE, getUpscalePlan, parseUpscaleJobMarker } from "@/lib/standaloneUpscale";
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

// Marker format is fal:<model-slug>:<requestId>. Matched generically so jobs
// queued under an older upscaler model still resume after a model swap.
const getPendingUpscaleRequestId = (project) => {
  return parseUpscaleJobMarker(project?.ai_prompt)?.requestId || null;
};

export default function UpscalePage() {
  const router = useAppRouter();
  const fileInputRef = useRef(null);
  const isProcessingRef = useRef(false);
  const upscaleRequestKeyRef = useRef(null);
  const activePollsRef = useRef(new Map());
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
  const [recentUpscales, setRecentUpscales] = useState([]);
  const [activeProjectName, setActiveProjectName] = useState(null);
  const [sourceMeta, setSourceMeta] = useState(null);
  const [upscaleProfile, setUpscaleProfile] = useState("photo");

  const noCredits = credits < UPSCALE_CREDIT_COST;

  const [uploadComparePosition, setUploadComparePosition] = useState(50);

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
        fetchRecentUpscales(session.user.id);
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

  const fetchRecentUpscales = async (userId) => {
    const retentionCutoff = new Date(Date.now() - (3 * 24 * 60 * 60 * 1000)).toISOString();
    const { data } = await supabase
      .from("projects")
      .select("id, name, created_at, original_image_url, generated_image_url, ai_prompt")
      .eq("user_id", userId)
      .eq("trace_type", "upscale")
      .gte("created_at", retentionCutoff)
      .order("created_at", { ascending: false })
      .limit(20);
    if (data) setRecentUpscales(data);
  };
  useEffect(() => {
    const checkPendingImage = () => {
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
        upscaleRequestKeyRef.current = null;
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
    if (previewImage?.startsWith("blob:")) URL.revokeObjectURL(previewImage);
    const objUrl = URL.createObjectURL(file);
    setPreviewImage(objUrl);
    setSelectedFile(file);
    setSourceMeta(null);
    setSelectedUrl(null);
    setUpscaledImage(null);
    setUpscaleError(null);
    setActiveProjectName(file.name);
    upscaleRequestKeyRef.current = null;
  };

  const resetWorkspace = () => {
    if (previewImage?.startsWith("blob:")) URL.revokeObjectURL(previewImage);
    setPreviewImage(null);
    setSelectedFile(null);
    setSelectedUrl(null);
    setUpscaledImage(null);
    setUpscaleError(null);
    setActiveProjectName(null);
    upscaleRequestKeyRef.current = null;
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
        const statusRes = await fetch(`/api/upscale?requestId=${encodeURIComponent(requestId)}&projectId=${encodeURIComponent(projectId)}`, {
          headers: { "Authorization": `Bearer ${token}` },
          cache: "no-store",
        });
        const statusData = await safeJson(statusRes, "Failed to check upscale status");
        if (!statusRes.ok) throw new Error(statusData.error || "Failed to check upscale status");

        if (statusData.status === "COMPLETED" && statusData.upscaledUrl) {
          setRecentUpscales(prev => prev.map(item => (
            item.id === projectId ? { ...item, generated_image_url: statusData.upscaledUrl } : item
          )));
          return statusData.upscaledUrl;
        }

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

  const resumePendingUpscale = useCallback(async (item, { showToast = false, maxAttempts = 1 } = {}) => {
    const requestId = getPendingUpscaleRequestId(item);
    if (!requestId || !user) return null;
    const sessionRes = await supabase.auth.getSession();
    const token = sessionRes.data.session?.access_token;
    if (!token) throw new Error("Unauthorized");
    const upscaledUrl = await pollUpscaleJob({ requestId, projectId: item.id, token, maxAttempts });
    if (upscaledUrl && showToast) toast.success("Upscale is ready to download.");
    return upscaledUrl;
  }, [pollUpscaleJob, supabase, user]);

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
    isProcessingRef.current = true;
    setIsProcessing(true);
    setUpscaledImage(null);
    setUpscaleError(null);

    try {
      const requestKey = upscaleRequestKeyRef.current || crypto.randomUUID();
      upscaleRequestKeyRef.current = requestKey;
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
        body: JSON.stringify({ imageUrl: finalUrl, idempotencyKey: requestKey, profile: upscaleProfile }),
      });

      const data = await safeJson(res, "Failed to process image");
      if (!res.ok) throw new Error(data.error || "Failed to process image");

      let upscaledUrl = data.upscaledUrl;
      if (!upscaledUrl && data.requestId && data.projectId) {
        upscaledUrl = await pollUpscaleJob({ requestId: data.requestId, projectId: data.projectId, token });
      }

      if (!upscaledUrl) {
        throw new Error("Upscale is taking too long. Please try again.");
      }

      setUpscaledImage(upscaledUrl);
      toast.success("Image upscaled successfully! (1 Claw deducted)");
      fetchCredits(user.id);
      fetchRecentUpscales(user.id);

    } catch (err) {
      upscaleRequestKeyRef.current = null;
      setUpscaleError(err.message || "The upscale could not be completed.");
      analytics.error(err, { area: "upscale_processing" });
      toast.error(err.message || "An error occurred");
    } finally {
      isProcessingRef.current = false;
      setIsProcessing(false);
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
    if (!user || recentUpscales.length === 0) return;
    const pendingItems = recentUpscales
      .filter(item => !item.generated_image_url && getPendingUpscaleRequestId(item))
      .slice(0, 5);
    if (pendingItems.length === 0) return;

    let cancelled = false;
    (async () => {
      for (const item of pendingItems) {
        if (cancelled) return;
        try { await resumePendingUpscale(item, { maxAttempts: 1 }); } catch {}
      }
    })();
    return () => { cancelled = true; };
  }, [recentUpscales, resumePendingUpscale, user]);

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
          <span>{isProcessing ? "Generating 4× upscale..." : previewImage ? "Ready to upscale" : "Waiting for image"}</span>
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
          className={previewImage ? styles.workspaceLayout : "main-workspace upscale-studio is-empty-state"}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          {previewImage ? (
            <>
              <UpscaleSplitWorkspace
                sourceUrl={previewImage}
                resultUrl={upscaledImage}
                isProcessing={isProcessing}
                errorMessage={sourceLimitError || upscaleError}
                onRun={handleUpscale}
                canRun={hasProcessableSource && !isProcessing}
                noCredits={noCredits}
              />
              <UpscalePropertiesPanel
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
              />
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
