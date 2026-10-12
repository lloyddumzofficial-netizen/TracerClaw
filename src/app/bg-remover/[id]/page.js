"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { analytics } from "@/lib/analytics";
import { CheckCircle2, Columns2, Download, Image as ImageIcon, Loader2, RotateCcw, Scissors, ShieldCheck } from "lucide-react";
import LogoLoader from "@/components/ui/LogoLoader";
import DesktopRequiredNotice from "@/components/shared/DesktopRequiredNotice";
import StudioShell from "@/components/shared/StudioShell";
import StudioWorkflow from "@/components/shared/StudioWorkflow";
import { useIsMobileDevice } from "@/hooks/useIsMobileDevice";
import { safeJson } from "@/lib/safeJson";
import { formatSavedAgo } from "@/lib/formatSavedAgo";
import { clearGenerationRequestKey, getOrCreateGenerationRequestKey } from "@/lib/generationRequestKey";

const supabase = createClient();

export default function BgRemoverPage() {
  const router = useRouter();
  const params = useParams();
  const projectId = params.id;
  const isMobileDevice = useIsMobileDevice();

  const [project, setProject] = useState(null);
  const [, setUser] = useState(null);
  const [userCredits, setUserCredits] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [zoom, setZoom] = useState(1);
  const [comparePosition, setComparePosition] = useState(50);

  const isDraggingCompare = useRef(false);
  const currentZoom = useRef(1);
  const scrollContainerRef = useRef(null);
  const compareContainerRef = useRef(null);

  useEffect(() => {
    currentZoom.current = zoom;
  }, [zoom]);

  useEffect(() => {
    if (isMobileDevice !== false) return;
    if (!projectId) return;

    let isMounted = true;
    async function fetchData() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          setUser(session.user);
          analytics.authSession(session.user, { source: "bg_remover" });
        }

        const { data: projData, error: projError } = await supabase
          .from("projects").select("*").eq("id", projectId).single();

        if (projError || !projData || projData.trace_type !== "bg_remover") {
          router.push("/");
          return;
        }

        if (isMounted) setProject(projData);

        if (session?.user) {
          const { data: profile } = await supabase
            .from("profiles").select("credits").eq("id", session.user.id).single();
          if (profile && isMounted) setUserCredits(profile.credits);
        }
      } catch (err) {
        console.error("Data fetch error:", err);
        analytics.error(err, { area: "bg_remover_fetch", project_id: projectId });
      }
    }
    fetchData();

    return () => { isMounted = false; };
  }, [isMobileDevice, projectId, router]);

  const handleRemoveBg = async () => {
    // Fix #5: Guard against double-click / re-triggering while already processing
    if (!project?.id || isProcessing) return;
    setIsProcessing(true);
    setErrorMsg("");

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const requestKey = getOrCreateGenerationRequestKey("remove_bg", project.id);

      const res = await fetch("/api/remove-bg", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { "Authorization": `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ projectId: project.id, keepOriginal: true, requestKey })
      });

      const data = await safeJson(res, "Failed to remove background");

      // Handle ALREADY_PROCESSED gracefully — no error, just reload
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

      // Update credits locally
      if (userCredits !== null) {
        setUserCredits(prev => prev - 1);
      }

    } catch (err) {
      console.error(err);
      analytics.error(err, { area: "bg_remove_processing", project_id: project.id });
      setErrorMsg(err.message);

      // Fix #6: Re-fetch actual credit balance after failure
      // Server may have refunded the credit — sync the real value
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          const { data: profile } = await supabase
            .from("profiles").select("credits").eq("id", session.user.id).single();
          if (profile) setUserCredits(profile.credits);
        }
      } catch { /* non-fatal */ }
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

  const isCompleted = !!project?.generated_image_url;

  useEffect(() => {
    if (isCompleted) setComparePosition(50);
  }, [isCompleted]);

  // Wheel to zoom logic
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleWheel = (e) => {
      e.preventDefault();
      const z = currentZoom.current;
      const delta = Math.sign(e.deltaY) * 0.15; // slightly smoother zoom
      const newZ = Math.min(Math.max(0.25, z - delta), 5);
      if (newZ !== z) {
        setZoom(newZ);
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [isCompleted]);

  const updateCompareFromPointer = useCallback((clientX) => {
    const container = compareContainerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const nextPosition = ((clientX - rect.left) / rect.width) * 100;
    setComparePosition(Math.max(0, Math.min(100, nextPosition)));
  }, []);

  if (isMobileDevice !== false) {
    return <DesktopRequiredNotice />;
  }

  if (!project) {
    return (
      <div className="bg-loading-screen">
        <LogoLoader size={72} color="#d8bd48" />
      </div>
    );
  }

  const savedAgo = formatSavedAgo(project.updated_at);
  const noCredits = userCredits !== null && userCredits <= 0;
  const workflowStep = isCompleted ? 3 : isProcessing ? 2 : 1;

  return (
    <StudioShell
      title="BG REMOVER"
      projectName={project.name}
      savedAgo={savedAgo}
      credits={userCredits}
      onHome={() => router.push("/")}
      commandBar={(
        <div className="workspace-command-bar">
          <div className="workspace-command-group">
            <span className="workspace-command-label">Process</span>
            <button className="workspace-command-btn is-primary" onClick={handleRemoveBg} disabled={isProcessing || isCompleted || noCredits} title="Remove image background">
              {isProcessing ? <Loader2 size={14} className="animate-spin" /> : <Scissors size={14} />}
              Remove BG
            </button>
          </div>
          <div className="workspace-command-spacer" />
          <div className="workspace-command-group">
            <span className="workspace-command-label">Export</span>
            <button className="workspace-command-btn is-primary" onClick={handleDownload} disabled={!isCompleted || isDownloading} title="Download transparent PNG">
              {isDownloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              PNG
            </button>
          </div>
        </div>
      )}
      statusLeft={isCompleted ? (
        <>
          <CheckCircle2 size={12} className="studio-success-icon" />
          <span className="studio-success-copy">Background removed</span>
          <small>Transparent PNG is ready for export.</small>
        </>
      ) : (
        <span>{isProcessing ? "Creating transparent cutout…" : "Source ready"}</span>
      )}
    >
      <main className="main-workspace bg-studio">
        <section className="canvas-area bg-canvas" aria-label="Background removal workspace">
          <StudioWorkflow
            currentStep={workflowStep}
            label="Background removal workflow"
            steps={[
              { label: "Source", description: "Artwork loaded" },
              { label: "Cutout", description: isProcessing ? "Processing" : isCompleted ? "Complete" : "Remove background" },
              { label: "Export", description: isCompleted ? "PNG ready" : "Transparent PNG" },
            ]}
          />

          <div className="bg-viewbar">
            <div className="bg-view-title">
              {isCompleted ? <Columns2 size={13} /> : <ImageIcon size={13} />}
              <span>{isCompleted ? "Before / after comparison" : "Source preview"}</span>
            </div>
            <div className="bg-view-tools">
              <span>{Math.round(zoom * 100)}%</span>
              <button type="button" onClick={() => setZoom(1)} title="Reset zoom">
                <RotateCcw size={12} />
                Reset view
              </button>
            </div>
          </div>

          <div ref={scrollContainerRef} className="bg-canvas-scroll">
            <div className="bg-stage-zoom" style={{ zoom }}>
              {!isCompleted ? (
                <figure className="bg-image-frame is-source">
                  <figcaption>Original source</figcaption>
                  <img src={project.original_image_url} alt="Original artwork" draggable={false} />
                </figure>
              ) : (
                <div
                  ref={compareContainerRef}
                  className="bg-compare-frame"
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
                  <img className="bg-compare-placeholder" src={project.original_image_url} alt="" aria-hidden="true" />
                  <img className="bg-compare-result" src={project.generated_image_url} alt="Artwork with transparent background" draggable={false} />
                  <div className="bg-compare-original" style={{ clipPath: `inset(0 ${100 - comparePosition}% 0 0)` }}>
                    <img src={project.original_image_url} alt="Original artwork" draggable={false} />
                  </div>
                  <div className="bg-compare-divider" style={{ left: `${comparePosition}%` }} aria-hidden="true">
                    <span><Columns2 size={14} /></span>
                  </div>
                  <span className="bg-compare-label is-original">Original</span>
                  <span className="bg-compare-label is-result">Transparent</span>
                </div>
              )}

              {isProcessing && (
                <div className="bg-processing-card" role="status" aria-live="polite">
                  <Loader2 size={19} className="animate-spin" />
                  <div>
                    <strong>Building a clean cutout</strong>
                    <span>Detecting the subject and refining transparent edges.</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        <aside className="bg-side-panel" aria-label="Background removal controls">
          <section className="bg-panel-section bg-job-panel">
            <div className="bg-panel-heading">
              <div>
                <span className="bg-panel-eyebrow">Production cutout</span>
                <h2>AI background removal</h2>
              </div>
              <span className="bg-cost">1 Claw</span>
            </div>

            <div className="bg-spec-list">
              <div><span>Output</span><strong>Transparent PNG</strong></div>
              <div><span>Edge handling</span><strong>Automatic</strong></div>
              <div><span>Best for</span><strong>Artwork & products</strong></div>
            </div>

            {errorMsg && <div className="bg-error" role="alert">{errorMsg}</div>}

            {!isCompleted ? (
              <button type="button" className="bg-action-btn is-primary" onClick={handleRemoveBg} disabled={isProcessing || noCredits}>
                {isProcessing
                  ? <><Loader2 size={15} className="animate-spin" /> Removing background…</>
                  : <><Scissors size={15} /> Remove background</>}
              </button>
            ) : (
              <button type="button" className="bg-action-btn is-primary" onClick={handleDownload} disabled={isDownloading}>
                {isDownloading
                  ? <><Loader2 size={15} className="animate-spin" /> Preparing download…</>
                  : <><Download size={15} /> Download transparent PNG</>}
              </button>
            )}

            {noCredits && !isCompleted && (
              <p className="bg-credit-warning">You need 1 Claw to create the transparent cutout.</p>
            )}

            <div className="bg-privacy-note">
              <ShieldCheck size={14} />
              <span>Private by default. Source and result files auto-delete after 3 days.</span>
            </div>
          </section>

          <section className="bg-panel-section bg-source-panel">
            <div className="bg-panel-heading is-compact">
              <div>
                <span className="bg-panel-eyebrow">Current source</span>
                <h2>Image details</h2>
              </div>
              <ImageIcon size={16} />
            </div>
            <div className="bg-source-card">
              <div className="bg-source-thumb">
                <img src={project.original_image_url} alt="Source artwork thumbnail" />
              </div>
              <div>
                <strong title={project.name}>{project.name}</strong>
                <span>{isCompleted ? "Cutout complete" : "Ready to process"}</span>
              </div>
            </div>

            <div className="bg-delivery-list" aria-label="Output readiness">
              <div className="is-complete"><CheckCircle2 size={13} /><span>Source received</span></div>
              <div className={isCompleted ? "is-complete" : isProcessing ? "is-active" : ""}>
                {isProcessing ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                <span>Transparent cutout</span>
              </div>
              <div className={isCompleted ? "is-active" : ""}><Download size={13} /><span>PNG delivery</span></div>
            </div>
          </section>
        </aside>
      </main>
    </StudioShell>
  );
}
