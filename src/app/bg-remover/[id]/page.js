"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useParams } from "next/navigation";
import { useTrackedRouter } from "@/hooks/useTrackedRouter";
import { createClient } from "@/utils/supabase/client";
import { analytics } from "@/lib/analytics";
import { CheckCircle2, Columns2, Download, Image as ImageIcon, Loader2, Minus, Plus, RotateCcw, Scissors, ShieldCheck } from "lucide-react";
import LogoLoader from "@/components/ui/LogoLoader";
import DesktopRequiredNotice from "@/components/shared/DesktopRequiredNotice";
import StudioShell from "@/components/shared/StudioShell";
import { useIsMobileDevice } from "@/hooks/useIsMobileDevice";
import { safeJson } from "@/lib/safeJson";
import { clearGenerationRequestKey, getOrCreateGenerationRequestKey } from "@/lib/generationRequestKey";

const supabase = createClient();
const PREVIEW_SURFACES = [
  { id: "checker", label: "Transparent" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

export default function BgRemoverPage() {
  const router = useTrackedRouter();
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
  const [viewMode, setViewMode] = useState("original");
  const [previewSurface, setPreviewSurface] = useState("checker");

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
    if (isCompleted) {
      setComparePosition(50);
      setViewMode("compare");
    }
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

  const noCredits = userCredits !== null && userCredits <= 0;

  return (
    <StudioShell
      title="BG REMOVER"
      credits={userCredits}
      onHome={() => router.push("/")}
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
        <section className="bg-settings-panel bg-control-deck" aria-label="Background removal controls">
          <div className="bg-inspector-preview">
            <img src={isCompleted ? project.generated_image_url : project.original_image_url} alt="Current background removal preview" />
            <span>{isCompleted ? "Transparent result" : "Source image"}</span>
          </div>
          <section className="bg-panel-section bg-job-panel">
            <div className="bg-tool-heading">
              <div>
                <span className="bg-panel-eyebrow">Background removal</span>
                <h2>Transparent cutout</h2>
              </div>
              <span className="bg-tool-rate">PNG output · 1 Claw</span>
            </div>

            <div className="bg-source-card bg-inline-source">
              <div className="bg-source-thumb">
                <img src={project.original_image_url} alt="Source artwork thumbnail" />
              </div>
              <div>
                <strong title={project.name}>{project.name}</strong>
                <span>{isCompleted ? "Cutout complete" : "Ready to process"}</span>
              </div>
            </div>

            {errorMsg && <div className="bg-error" role="alert">{errorMsg}</div>}

            <div className="bg-deck-actions">
              {!isCompleted ? (
                <button type="button" className="bg-action-btn is-primary" onClick={handleRemoveBg} disabled={isProcessing || noCredits}>
                  {isProcessing
                    ? <><Loader2 size={15} className="animate-spin" /> Extracting…</>
                    : <><Scissors size={15} /> Remove background</>}
                </button>
              ) : (
                <button type="button" className="bg-action-btn is-primary" onClick={handleDownload} disabled={isDownloading}>
                  {isDownloading
                    ? <><Loader2 size={15} className="animate-spin" /> Preparing…</>
                    : <><Download size={15} /> Download PNG</>}
                </button>
              )}
              {noCredits && !isCompleted && <p className="bg-credit-warning">You need 1 Claw to continue.</p>}
              <div className="bg-privacy-note"><ShieldCheck size={13} /><span>Auto-deletes after 3 days</span></div>
            </div>

            {isCompleted && (
              <div className="bg-inline-proof">
                <div className="bg-panel-heading is-compact">
                  <div>
                    <span className="bg-panel-eyebrow">Result proofing</span>
                    <h2>Preview background</h2>
                  </div>
                </div>
                <p className="bg-proof-copy">Check fine edges against three surfaces before export.</p>
                <div className="bg-surface-picker" role="group" aria-label="Preview background">
                  {PREVIEW_SURFACES.map((surface) => (
                    <button
                      key={surface.id}
                      type="button"
                      className={previewSurface === surface.id ? "is-active" : ""}
                      onClick={() => setPreviewSurface(surface.id)}
                      aria-pressed={previewSurface === surface.id}
                    >
                      <span className={`bg-surface-swatch is-${surface.id}`} aria-hidden="true" />
                      {surface.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="bg-auto-pass" aria-label="Automatic cutout pass">
              <span>Automatic pass</span>
              <ul>
                <li>Subject detection</li>
                <li>Edge refinement</li>
                <li>Transparent export</li>
              </ul>
            </div>
          </section>
        </section>

        <section className="canvas-area bg-canvas" aria-label="Background removal workspace">
          <div className="bg-viewbar">
            <div className="bg-view-tabs" aria-label="Preview mode">
              <button
                type="button"
                className={"bg-view-tab " + (viewMode === "original" ? "is-active" : "")}
                onClick={() => setViewMode("original")}
              >
                <ImageIcon size={13} />
                Original
              </button>
              <button
                type="button"
                className={"bg-view-tab " + (viewMode === "cutout" ? "is-active" : "")}
                onClick={() => setViewMode("cutout")}
                disabled={!isCompleted}
              >
                <Scissors size={13} />
                Cutout
              </button>
              <button
                type="button"
                className={"bg-view-tab " + (viewMode === "compare" ? "is-active" : "")}
                onClick={() => setViewMode("compare")}
                disabled={!isCompleted}
              >
                <Columns2 size={13} />
                Compare
              </button>
            </div>
            <div className="bg-view-tools">
              <span className={`bg-stage-state ${isProcessing ? "is-processing" : isCompleted ? "is-ready" : ""}`}>
                <i aria-hidden="true" />
                {isProcessing ? "Extracting" : isCompleted ? "Cutout ready" : "Source ready"}
              </span>
              <span>{Math.round(zoom * 100)}%</span>
              <button type="button" onClick={() => setZoom((value) => Math.max(0.25, value - 0.25))} title="Zoom out" aria-label="Zoom out">
                <Minus size={12} />
              </button>
              <button type="button" onClick={() => setZoom((value) => Math.min(5, value + 0.25))} title="Zoom in" aria-label="Zoom in">
                <Plus size={12} />
              </button>
              <button type="button" onClick={() => setZoom(1)} title="Reset zoom">
                <RotateCcw size={12} />
                Reset view
              </button>
            </div>
          </div>

          <div ref={scrollContainerRef} className="bg-canvas-scroll">
            <div className="bg-stage-zoom" style={{ zoom }}>
              {!isCompleted && !isProcessing && (
                <div className="bg-start-overlay">
                  <span>Ready for cutout</span>
                  <button type="button" onClick={handleRemoveBg} disabled={noCredits}>
                    <Scissors size={14} /> Remove background
                  </button>
                </div>
              )}
              {viewMode === "original" || !isCompleted ? (
                <figure className="bg-image-frame is-source">
                  <figcaption>Original source</figcaption>
                  <img src={project.original_image_url} alt="Original artwork" draggable={false} />
                </figure>
              ) : viewMode === "cutout" ? (
                <figure className={`bg-image-frame is-cutout is-${previewSurface}`}>
                  <figcaption>Transparent cutout</figcaption>
                  <img src={project.generated_image_url} alt="Artwork with transparent background" draggable={false} />
                </figure>
              ) : (
                <div
                  ref={compareContainerRef}
                  className={`bg-compare-frame is-${previewSurface}`}
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

      </main>
    </StudioShell>
  );
}
