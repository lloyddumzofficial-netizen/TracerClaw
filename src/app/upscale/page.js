"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import { CheckCircle2, Clock, Download, Loader2, Monitor, Scan, ShieldAlert, Wand2 } from "lucide-react";
import { toast } from "@/components/ui/Toast";
import { createClient } from "@/utils/supabase/client";
import { useRouter } from "next/navigation";
import { analytics } from "@/lib/analytics";
import { formatUploadLimit, resolveImageUploadLimit } from "@/lib/uploadLimits";
import { safeJson } from "@/lib/safeJson";
import FeedbackWidget from "@/components/shared/FeedbackWidget";
import DesktopRequiredNotice from "@/components/shared/DesktopRequiredNotice";
import StudioShell from "@/components/shared/StudioShell";
import { useIsMobileDevice } from "@/hooks/useIsMobileDevice";
import "../globals.css";
import "../home.css";

const QRCode = dynamic(() => import("react-qr-code"), { ssr: false });
const TopUpModal = dynamic(() => import("@/components/ui/TopUpModal"), { ssr: false });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const UPSCALE_POLL_MAX_MS = 6 * 60 * 1000;

function upscalePollDelay(attempt) {
  if (attempt < 10) return 3000;
  if (attempt < 22) return 5000;
  return 10000;
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

  const noCredits = credits < UPSCALE_CREDIT_COST;

  const getHistoryPreviewUrl = (item) => (
    item.generated_image_url && item.generated_image_url !== "REFUNDED"
      ? item.generated_image_url
      : item.original_image_url
  );

  const [uploadMode, setUploadMode] = useState("file"); // "file" | "qr"
  const scrollContainerRef = useRef(null);
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
  }, [previewImage, upscaledImage]); // attach when image renders

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
    const { data } = await supabase
      .from("projects")
      .select("*")
      .eq("user_id", userId)
      .eq("trace_type", "upscale")
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
    const objUrl = URL.createObjectURL(file);
    setPreviewImage(objUrl);
    setSelectedFile(file);
    setSelectedUrl(null);
    setUpscaledImage(null);
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

      const uploadRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!uploadRes.ok) throw new Error("Failed to upload image to S3");
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

  const activeFileName = selectedFile?.name || (previewImage ? "Mobile upload" : null);

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
                disabled={isProcessing || (!previewImage && !upscaledImage)}
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


        <main className="main-workspace upscale-studio">

          {/* Split View Workspace */}
          <section className="canvas-area upscale-canvas">

            <div className="upscale-stage-tabs">
              <div className={`upscale-stage-tab ${!upscaledImage ? "is-active" : ""}`}>
                <span>1</span>
                Original Upload
              </div>
              <div className={`upscale-stage-tab ${upscaledImage ? "is-active" : ""}`}>
                <span>2</span>
                6X HD Upscale
              </div>
            </div>

            <div className="upscale-canvas-body">
              {(!previewImage && !upscaledImage) ? (
                <div className="upscale-empty-panel"
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                >
                  <div className="upscale-empty-kicker">REAL-ESRGAN X4PLUS / 6X SCALE</div>
                  <h2>Upscale raster artwork before production.</h2>
                  <p>Use this for low-resolution jersey graphics, customer photos, logos, and print references that need more pixel detail before handoff.</p>

                  <div className="upscale-empty-actions">
                    <button
                      onClick={() => fileInputRef.current.click()}
                      className="upscale-empty-btn is-primary"
                    >
                      <Monitor size={14} /> Open PC File
                    </button>
                    <button
                      onClick={() => setUploadMode(prev => prev === "qr" ? "file" : "qr")}
                      className={`upscale-empty-btn ${uploadMode === "qr" ? "is-active" : ""}`}
                    >
                      <Scan size={14} /> Scan Phone
                    </button>
                  </div>

                  <input type="file" ref={fileInputRef} onChange={(e) => handleFileSelected(e.target.files[0])} accept="image/*" style={{ display: "none" }} />

                  {uploadMode === "qr" ? (
                    <div className="upscale-qr-panel">
                      <div className="upscale-qr-code"><QRCode value={`https://desaynclaw.com/m/${syncSessionId}`} size={130} /></div>
                      <p>Scan with your mobile camera to upload directly.</p>
                    </div>
                  ) : (
                    <div className="upscale-drop-note">or drop an image anywhere on this panel</div>
                  )}
                </div>
              ) : (
                <div className="upscale-preview-shell">
                  <div
                    ref={scrollContainerRef}
                    className="upscale-preview-scroll"
                  >
                    <div className="upscale-preview-zoom" style={{ zoom }}>
                      <img src={upscaledImage || previewImage} alt="Preview" />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Right Properties Panel */}
          <aside className="upscale-side-panel">

            <div className="upscale-panel-section">
              <div className="upscale-panel-title">
                <span>ACTIONS</span>
              </div>

              <button
                onClick={handleUpscale}
                disabled={isProcessing || (!previewImage && !upscaledImage)}
                className="upscale-action-btn is-process"
              >
                {isProcessing
                  ? <><Loader2 size={14} className="animate-spin" /> UPSCALING…</>
                  : noCredits
                    ? <><Wand2 size={14} /> GET MORE CLAWS</>
                    : <><Wand2 size={14} /> GENERATE 6X UPSCALE {`(−${UPSCALE_CREDIT_COST} CLAW)`}</>}
              </button>
              {noCredits && (
                <p className="upscale-credit-warning">
                  You need {UPSCALE_CREDIT_COST} claw to upscale
                </p>
              )}

              <button
                onClick={() => {
                  if (upscaledImage) handleDownload(upscaledImage);
                }}
                disabled={!upscaledImage}
                className="upscale-action-btn"
              >
                <Download size={14} /> DOWNLOAD RESULT
              </button>

              {upscaledImage && (
                <FeedbackWidget
                  projectId={syncSessionId}
                />
              )}
            </div>

            <div className="upscale-panel-section is-history">
              <div className="upscale-panel-title">
                <span>HISTORY</span>
              </div>

              {/* Privacy Notice */}
              <div className="upscale-privacy-note">
                <ShieldAlert size={14} />
                <div>
                  <p>Privacy First</p>
                  <small>All uploaded and generated images are permanently deleted after 3 days to protect your privacy.</small>
                </div>
              </div>

              {recentUpscales.length === 0 ? (
                <div className="upscale-empty-history">
                  <Clock size={24} />
                  <p>No recent upscales</p>
                </div>
              ) : (
                <div className="upscale-history-list">
                  {recentUpscales.map(item => (
                    <div key={item.id} className="upscale-history-card">
                      <div className="upscale-history-thumb">
                        <img src={getHistoryPreviewUrl(item)} alt="Upscaled design history preview" />
                      </div>
                      <div className="upscale-history-info">
                        <p>
                          {item.name || "6X Upscale"}
                        </p>
                        <span>
                          <Clock size={10} /> {new Date(item.created_at).toLocaleDateString()}
                        </span>
                      </div>
                      <button
                        onClick={async () => {
                          if (item.generated_image_url && item.generated_image_url !== "REFUNDED") {
                            await handleDownload(item.generated_image_url);
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
                        title={item.generated_image_url ? "Download Image" : "Finish processing"}
                        className="upscale-history-download"
                      >
                        <Download size={12} strokeWidth={2.5} />
                      </button>
                    </div>
                  ))}
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
