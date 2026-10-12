"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import { CheckCircle2, Clock, Columns2, Download, ImageIcon, Loader2, Monitor, Plus, RotateCcw, Scan, ShieldCheck, Wand2 } from "lucide-react";
import { toast } from "@/components/ui/Toast";
import { createClient } from "@/utils/supabase/client";
import { useRouter } from "next/navigation";
import { analytics } from "@/lib/analytics";
import { formatUploadLimit, resolveImageUploadLimit } from "@/lib/uploadLimits";
import { safeJson } from "@/lib/safeJson";
import FeedbackWidget from "@/components/shared/FeedbackWidget";
import DesktopRequiredNotice from "@/components/shared/DesktopRequiredNotice";
import StudioShell from "@/components/shared/StudioShell";
import StudioWorkflow from "@/components/shared/StudioWorkflow";
import { useIsMobileDevice } from "@/hooks/useIsMobileDevice";
import "../home.css";

const QRCode = dynamic(() => import("react-qr-code"), { ssr: false });
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
  const match = String(project?.ai_prompt || "").match(/^fal:[a-z0-9.-]+:(.+)$/i);
  return match ? match[1] : null;
};

export default function UpscalePage() {
  const router = useRouter();
  const fileInputRef = useRef(null);
  const isProcessingRef = useRef(false);
  const upscaleRequestKeyRef = useRef(null);
  const activePollsRef = useRef(new Map());
  const supabase = createClient();
  const isMobileDevice = useIsMobileDevice();

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
  const [viewMode, setViewMode] = useState("original");
  const [activeHistoryId, setActiveHistoryId] = useState(null);
  const [activeProjectName, setActiveProjectName] = useState(null);
  const [sourceMeta, setSourceMeta] = useState(null);
  const [comparePosition, setComparePosition] = useState(50);

  const noCredits = credits < UPSCALE_CREDIT_COST;

  const getHistoryPreviewUrl = (item) => (
    item.original_image_url
      || (item.generated_image_url && item.generated_image_url !== "REFUNDED" ? item.generated_image_url : null)
  );

  const getHistoryResultUrl = (item) => (
    item.generated_image_url && item.generated_image_url !== "REFUNDED"
      ? item.generated_image_url
      : null
  );

  const getHistoryStatus = (item) => {
    if (getHistoryResultUrl(item)) return "Ready";
    if (getPendingUpscaleRequestId(item)) return "Processing";
    return "Unavailable";
  };

  const [uploadMode, setUploadMode] = useState("file"); // "file" | "qr"
  const scrollContainerRef = useRef(null);
  const compareContainerRef = useRef(null);
  const isDraggingCompare = useRef(false);
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
  }, [previewImage, upscaledImage, viewMode]); // reattach when the preview surface changes

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
        outputWidth: width * 6,
        outputHeight: height * 6,
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

  const updateCompareFromPointer = useCallback((clientX) => {
    const container = compareContainerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const nextPosition = ((clientX - rect.left) / rect.width) * 100;
    setComparePosition(Math.max(0, Math.min(100, nextPosition)));
  }, []);
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
        setViewMode("original");
        setActiveHistoryId(null);
        setActiveProjectName("Mobile upload");
        setZoom(1);
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
    setSelectedUrl(null);
    setUpscaledImage(null);
    setViewMode("original");
    setActiveHistoryId(null);
    setActiveProjectName(file.name);
    setZoom(1);
    upscaleRequestKeyRef.current = null;
  };

  const resetWorkspace = () => {
    if (previewImage?.startsWith("blob:")) URL.revokeObjectURL(previewImage);
    setPreviewImage(null);
    setSelectedFile(null);
    setSelectedUrl(null);
    setUpscaledImage(null);
    setViewMode("original");
    setActiveHistoryId(null);
    setActiveProjectName(null);
    setUploadMode("file");
    setZoom(1);
    upscaleRequestKeyRef.current = null;
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const openRecentProject = (item) => {
    const sourceUrl = item.original_image_url || null;
    const resultUrl = getHistoryResultUrl(item);
    if (!sourceUrl && !resultUrl) {
      toast.error("This project no longer has an available image.");
      return;
    }
    if (previewImage?.startsWith("blob:")) URL.revokeObjectURL(previewImage);
    setPreviewImage(sourceUrl || resultUrl);
    setSelectedFile(null);
    setSelectedUrl(sourceUrl);
    setUpscaledImage(resultUrl);
    setViewMode(resultUrl ? "result" : "original");
    setActiveHistoryId(item.id);
    setActiveProjectName(item.name || "6X Upscale");
    setZoom(1);
    upscaleRequestKeyRef.current = null;
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
        body: JSON.stringify({ imageUrl: finalUrl, idempotencyKey: requestKey }),
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
      setViewMode("result");
      toast.success("Image upscaled successfully! (1 Claw deducted)");
      fetchCredits(user.id);
      fetchRecentUpscales(user.id);

    } catch (err) {
      upscaleRequestKeyRef.current = null;
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
  const hasProcessableSource = Boolean(selectedFile || selectedUrl);
  const shownImage = viewMode === "result" && upscaledImage ? upscaledImage : previewImage;
  const workflowStep = upscaledImage ? 3 : previewImage ? 2 : 1;

  return (
    <>
      <StudioShell
        title="UPSCALE STUDIO"
        projectName={activeFileName}
        credits={credits}
        onHome={() => router.push("/")}
        onCreditsClick={() => setShowTopUpModal(true)}
        commandBar={(
          <div className="workspace-command-bar">
            <div className="workspace-command-group">
              <span className="workspace-command-label">Input</span>
              <button
                className="workspace-command-btn is-accent"
                onClick={() => fileInputRef.current?.click()}
                disabled={isProcessing}
                title="Open image from this computer"
              >
                <Monitor size={14} />
                Open File
              </button>
              <button
                className={`workspace-command-btn ${uploadMode === "qr" ? "is-active" : ""}`}
                onClick={() => setUploadMode(prev => prev === "qr" ? "file" : "qr")}
                disabled={isProcessing}
                title="Upload from phone"
              >
                <Scan size={14} />
                Phone
              </button>
            </div>
            <div className="workspace-command-divider" />
            <div className="workspace-command-group">
              <span className="workspace-command-label">Process</span>
              <button
                className="workspace-command-btn is-primary"
                onClick={handleUpscale}
                disabled={isProcessing || !hasProcessableSource}
                title="Generate 6X upscale"
              >
                {isProcessing ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
                6X Upscale
              </button>
            </div>
            <div className="workspace-command-spacer" />
            <div className="workspace-command-group">
              <span className="workspace-command-label">Export</span>
              <button
                className="workspace-command-btn is-primary"
                onClick={() => upscaledImage && handleDownload(upscaledImage)}
                disabled={!upscaledImage}
                title="Download upscaled image"
              >
                <Download size={14} />
                PNG
              </button>
            </div>
          </div>
        )}
        statusLeft={upscaledImage ? (
          <>
            <CheckCircle2 size={12} color="#4ade80" />
            <span style={{ color: "#4ade80" }}>Upscale complete</span>
            <small>6X image is ready for download.</small>
          </>
        ) : (
          <span>{isProcessing ? "Generating 6X upscale..." : previewImage ? "Ready to upscale" : "Waiting for image"}</span>
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

        <main className="main-workspace upscale-studio">
          <aside className="upscale-settings-panel" aria-label="Upscale settings and actions">
            <div className="upscale-panel-section upscale-job-panel">
              <div className="upscale-panel-heading">
                <div>
                  <span className="upscale-panel-eyebrow">Production upscale</span>
                  <h2>6× HD enhancement</h2>
                </div>
                <span className="upscale-cost">1 Claw</span>
              </div>

              <div className="upscale-spec-list">
                <div><span>Output</span><strong>PNG</strong></div>
                <div><span>Scale</span><strong>6×</strong></div>
                <div><span>Best for</span><strong>Raster artwork</strong></div>
              </div>

              {sourceMeta && (
                <div className="upscale-source-analysis" aria-label="Source image analysis">
                  <div className="upscale-analysis-heading">
                    <span>Source analysis</span>
                    <strong className={`is-${sourceMeta.quality.tone}`}>{sourceMeta.quality.label}</strong>
                  </div>
                  <dl>
                    <div><dt>Original</dt><dd>{sourceMeta.width} × {sourceMeta.height}</dd></div>
                    <div><dt>6× output</dt><dd>{sourceMeta.outputWidth} × {sourceMeta.outputHeight}</dd></div>
                    <div><dt>Format</dt><dd>{sourceMeta.format}</dd></div>
                    <div><dt>File</dt><dd>{sourceMeta.fileSize}</dd></div>
                  </dl>
                </div>
              )}

              <button
                type="button"
                onClick={handleUpscale}
                disabled={isProcessing || !hasProcessableSource}
                className="upscale-action-btn is-process"
              >
                {isProcessing
                  ? <><Loader2 size={15} className="animate-spin" /> Enhancing artwork…</>
                  : noCredits
                    ? <><Wand2 size={15} /> Get more Claws</>
                    : <><Wand2 size={15} /> Generate 6× result</>}
              </button>

              {noCredits && (
                <p className="upscale-credit-warning">
                  Add at least {UPSCALE_CREDIT_COST} Claw to continue.
                </p>
              )}

              <div className="upscale-secondary-actions">
                <button
                  type="button"
                  onClick={() => upscaledImage && handleDownload(upscaledImage)}
                  disabled={!upscaledImage}
                  className="upscale-action-btn"
                >
                  <Download size={14} />
                  Download PNG
                </button>
                <button
                  type="button"
                  onClick={previewImage ? resetWorkspace : () => fileInputRef.current?.click()}
                  className="upscale-action-btn"
                  disabled={isProcessing}
                >
                  <Plus size={14} />
                  New image
                </button>
              </div>

              <div className="upscale-privacy-note">
                <ShieldCheck size={14} />
                <span>Private by default. Source and result files auto-delete after 3 days.</span>
              </div>

              {upscaledImage && <FeedbackWidget projectId={activeHistoryId || syncSessionId} />}
            </div>

          </aside>

          <section className="canvas-area upscale-canvas" aria-label="Upscale workspace">
            <StudioWorkflow
              currentStep={workflowStep}
              label="Upscale workflow"
              steps={[
                { label: "Source", description: previewImage ? "Image ready" : "Choose artwork" },
                { label: "Enhance", description: isProcessing ? "Processing" : upscaledImage ? "6× complete" : "Generate 6×" },
                { label: "Export", description: upscaledImage ? "PNG ready" : "Download result" },
              ]}
            />
            <div className="upscale-viewbar" aria-label="Preview mode">
              <div className="upscale-view-tabs">
                <button
                  type="button"
                  className={"upscale-view-tab " + (viewMode === "original" ? "is-active" : "")}
                  onClick={() => setViewMode("original")}
                  disabled={!previewImage}
                >
                  <ImageIcon size={13} />
                  Original
                </button>
                <button
                  type="button"
                  className={"upscale-view-tab " + (viewMode === "result" ? "is-active" : "")}
                  onClick={() => setViewMode("result")}
                  disabled={!upscaledImage}
                >
                  <Wand2 size={13} />
                  6× Result
                </button>
                <button
                  type="button"
                  className={"upscale-view-tab " + (viewMode === "compare" ? "is-active" : "")}
                  onClick={() => setViewMode("compare")}
                  disabled={!previewImage || !upscaledImage}
                >
                  <Columns2 size={13} />
                  Compare
                </button>
              </div>

              <div className="upscale-view-meta">
                {previewImage && (
                  <>
                    <span>{Math.round(zoom * 100)}%</span>
                    <button type="button" onClick={() => setZoom(1)} title="Reset zoom">
                      <RotateCcw size={12} />
                      Reset view
                    </button>
                  </>
                )}
              </div>
            </div>

            <div
              className={"upscale-canvas-body " + (previewImage ? "has-image" : "")}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
            >
              {!previewImage && !upscaledImage ? (
                <div className="upscale-empty-panel">
                  <div className="upscale-upload-mark" aria-hidden="true">
                    <ImageIcon size={24} strokeWidth={1.5} />
                  </div>
                  <div className="upscale-empty-kicker">Image Upscale</div>
                  <h2>Bring low-resolution artwork up to production size.</h2>
                  <p>Upload a PNG, JPG, or WebP. DesaynClaw creates a cleaner 6× raster while preserving the original for comparison.</p>

                  <div className="upscale-empty-actions">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="upscale-empty-btn is-primary"
                    >
                      <Monitor size={14} />
                      Choose image
                    </button>
                    <button
                      type="button"
                      onClick={() => setUploadMode((mode) => mode === "qr" ? "file" : "qr")}
                      className={"upscale-empty-btn " + (uploadMode === "qr" ? "is-active" : "")}
                    >
                      <Scan size={14} />
                      Upload by phone
                    </button>
                  </div>

                  {uploadMode === "qr" ? (
                    <div className="upscale-qr-panel">
                      <div className="upscale-qr-code">
                        <QRCode value={"https://desaynclaw.com/m/" + syncSessionId} size={118} />
                      </div>
                      <div>
                        <strong>Scan to upload</strong>
                        <p>The image will appear in this workspace automatically.</p>
                      </div>
                    </div>
                  ) : (
                    <div className="upscale-drop-note">
                      <span>Drop an image anywhere in this workspace</span>
                      <small>Maximum {formatUploadLimit(resolveImageUploadLimit())}</small>
                    </div>
                  )}
                </div>
              ) : (
                <div className="upscale-preview-shell">
                  {viewMode === "compare" && previewImage && upscaledImage ? (
                    <div ref={scrollContainerRef} className="upscale-preview-scroll upscale-compare-scroll">
                      <div className="upscale-compare-zoom" style={{ zoom }}>
                        <div
                          ref={compareContainerRef}
                          className="upscale-compare-frame"
                          onPointerDown={(event) => {
                            isDraggingCompare.current = true;
                            event.currentTarget.setPointerCapture?.(event.pointerId);
                            updateCompareFromPointer(event.clientX);
                          }}
                          onPointerMove={(event) => {
                            if (isDraggingCompare.current) updateCompareFromPointer(event.clientX);
                          }}
                          onPointerUp={(event) => {
                            isDraggingCompare.current = false;
                            event.currentTarget.releasePointerCapture?.(event.pointerId);
                          }}
                          onPointerCancel={() => { isDraggingCompare.current = false; }}
                        >
                          <img className="upscale-compare-placeholder" src={previewImage} alt="" aria-hidden="true" />
                          <img className="upscale-compare-result" src={upscaledImage} alt="6× upscaled artwork" draggable={false} />
                          <div className="upscale-compare-original" style={{ clipPath: `inset(0 ${100 - comparePosition}% 0 0)` }}>
                            <img src={previewImage} alt="Original uploaded artwork" draggable={false} />
                          </div>
                          <div className="upscale-compare-divider" style={{ left: `${comparePosition}%` }} aria-hidden="true">
                            <span><Columns2 size={14} /></span>
                          </div>
                          <span className="upscale-compare-label is-original">Original</span>
                          <span className="upscale-compare-label is-result">6× Result</span>
                        </div>
                      </div>
                    </div>) : (
                    <div ref={scrollContainerRef} className="upscale-preview-scroll">
                      <div className="upscale-preview-zoom" style={{ zoom }}>
                        <div className="upscale-image-frame">
                          <span>{viewMode === "result" && upscaledImage ? "6× Result" : "Original"}</span>
                          <img
                            src={shownImage}
                            alt={viewMode === "result" ? "Upscaled artwork result" : "Original uploaded artwork"}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>

          <aside className="upscale-side-panel" aria-label="Recent upscale projects">
            <div className="upscale-panel-section is-history">
              <div className="upscale-panel-heading is-compact">
                <div>
                  <span className="upscale-panel-eyebrow">Your work</span>
                  <h2>Recent projects</h2>
                </div>
                <span className="upscale-history-count">{recentUpscales.length}</span>
              </div>

              {recentUpscales.length === 0 ? (
                <div className="upscale-empty-history">
                  <Clock size={20} />
                  <strong>No recent projects</strong>
                  <p>Your completed upscales will appear here.</p>
                </div>
              ) : (
                <div className="upscale-history-list">
                  {recentUpscales.slice(0, 8).map((item) => {
                    const status = getHistoryStatus(item);
                    const resultUrl = getHistoryResultUrl(item);
                    return (
                      <div
                        key={item.id}
                        className={"upscale-history-card " + (activeHistoryId === item.id ? "is-active" : "")}
                        role="button"
                        tabIndex={0}
                        onClick={() => openRecentProject(item)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            openRecentProject(item);
                          }
                        }}
                      >
                        <div className="upscale-history-thumb">
                          {getHistoryPreviewUrl(item) ? (
                            <img src={getHistoryPreviewUrl(item)} alt="" />
                          ) : (
                            <ImageIcon size={18} />
                          )}
                        </div>
                        <div className="upscale-history-info">
                          <p>{item.name || "6× Upscale"}</p>
                          <span>
                            {new Date(item.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                            <i aria-hidden="true">·</i>
                            <em className={"is-" + status.toLowerCase()}>{status}</em>
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={async (event) => {
                            event.stopPropagation();
                            if (resultUrl) {
                              await handleDownload(resultUrl);
                              return;
                            }
                            try {
                              const readyUrl = await resumePendingUpscale(item, { showToast: true, maxAttempts: 120 });
                              if (readyUrl) await handleDownload(readyUrl);
                              else toast.error("Upscale is still processing. Please try again in a moment.");
                            } catch (error) {
                              toast.error(error.message || "Failed to prepare download");
                            }
                          }}
                          disabled={status === "Unavailable"}
                          title={resultUrl ? "Download result" : "Check processing status"}
                          className="upscale-history-download"
                        >
                          {status === "Processing"
                            ? <Loader2 size={13} className="animate-spin" />
                            : <Download size={13} />}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </aside>
        </main>

      </StudioShell>

      {showTopUpModal && <TopUpModal onClose={() => setShowTopUpModal(false)} user={user} />}
    </>
  );
}
