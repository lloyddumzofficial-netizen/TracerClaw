"use client";

import { memo, useMemo, useState, useRef, useEffect, useLayoutEffect, useCallback } from "react";
import { AlertCircle, CheckCircle2, Sparkles } from "lucide-react";
import SafeInlineSVG from "@/components/shared/SafeInlineSVG";
import LogoLoader from "@/components/ui/LogoLoader";
import {
  calculateFittedArtworkLayout,
  calculateSynchronizedPan,
  calculateZoomLayerSize,
} from "@/lib/workspaceCanvasNavigation";
import WorkspaceZoomControls from "./WorkspaceZoomControls";

// Each stage owns a slice of the bar. Progress eases toward the slice ceiling so
// it keeps moving for as long as the stage runs, then the next stage picks up
// where it left off. Previously these were three hardcoded numbers, so the bar
// sat frozen at 34% / 67% / 92% and read as broken.
const STAGE_RANGE = {
  step1: [2, 34],
  step2: [34, 67],
  step3: [67, 96],
};

const STAGE_LABELS = ["Artwork cleanup", "Detail pass", "Vector output"];

// How fast progress closes the remaining gap, per second. Higher = quicker climb.
const STAGE_EASE_RATE = 0.3;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 5;
const WHEEL_ZOOM_SENSITIVITY = 0.00145;
const WHEEL_ZOOM_EASE_MS = 46;
const PREVIEW_TRANSITION_MIN_MS = 720;
const PREVIEW_REVEAL_MS = 320;

function createZoomAnchor(leftPane, rightPane, pointer) {
  const leftRect = leftPane.getBoundingClientRect();
  const rightRect = rightPane.getBoundingClientRect();
  const activeRect = pointer.x < rightRect.left ? leftRect : rightRect;
  const focusX = Math.min(1, Math.max(0, (pointer.x - activeRect.left) / activeRect.width));
  const focusY = Math.min(1, Math.max(0, (pointer.y - activeRect.top) / activeRect.height));

  const capturePane = (pane) => {
    const localX = pane.clientWidth * focusX;
    const localY = pane.clientHeight * focusY;
    return {
      localX,
      localY,
      pointX: pane.scrollLeft + localX,
      pointY: pane.scrollTop + localY,
      scrollWidth: pane.scrollWidth,
      scrollHeight: pane.scrollHeight,
    };
  };

  return {
    leftPane: capturePane(leftPane),
    rightPane: capturePane(rightPane),
  };
}

function resolveZoomAnchor(anchor, leftPane, rightPane) {
  const resolvePane = (captured, current) => ({
    left: captured.pointX * (current.scrollWidth / captured.scrollWidth) - captured.localX,
    top: captured.pointY * (current.scrollHeight / captured.scrollHeight) - captured.localY,
  });

  return {
    leftPane: resolvePane(anchor.leftPane, leftPane),
    rightPane: resolvePane(anchor.rightPane, rightPane),
  };
}

function WorkspaceOutputLoader({ label = "Loading preview" }) {
  return (
    <div className="workspace-output-loader" role="status" aria-label={label}>
      <div className="workspace-output-mark" aria-hidden="true">
        <LogoLoader size={78} color="#f4f4ef" decorative />
      </div>
      <span>{label}</span>
    </div>
  );
}

function OutputRaster({ proxyUrl, directUrl, onReady }) {
  const [attempt, setAttempt] = useState(0);
  const [retry, setRetry] = useState(0);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    if (attempt === 2) onReady?.();
  }, [attempt, onReady]);

  if (attempt === 2) {
    return (
      <div role="alert" style={{ color: "#aaa", textAlign: "center", fontSize: 12, lineHeight: 1.5 }}>
        <div>Saved image preview could not be loaded.</div>
        <button type="button" onClick={() => { setRetry(value => value + 1); setAttempt(0); }} style={{ marginTop: 10, padding: "7px 12px", background: "#222", border: "1px solid #444", borderRadius: 4, color: "#ddd", cursor: "pointer" }}>
          Retry preview
        </button>
      </div>
    );
  }

  const src = attempt === 0
    ? `${proxyUrl}${retry ? `&previewRetry=${retry}` : ""}`
    : directUrl;

  return (
    <div className="workspace-output-raster">
      {!isLoaded && <WorkspaceOutputLoader />}
      <img
        src={src}
        draggable={false}
        alt="Output"
        referrerPolicy="no-referrer"
        onLoad={(event) => {
          const image = event.currentTarget;
          const reveal = () => {
            setIsLoaded(true);
            onReady?.();
          };
          if (typeof image.decode === "function") image.decode().then(reveal, reveal);
          else reveal();
        }}
        onError={() => {
          setIsLoaded(false);
          setAttempt(current => current === 0 && directUrl ? 1 : 2);
        }}
        style={{ opacity: isLoaded ? 1 : 0 }}
      />
    </div>
  );
}

/**
 * Drives the progress bar at display refresh rate, writing straight to the DOM.
 *
 * Two things this deliberately avoids:
 *  - React state per frame, which would re-render the whole canvas 60x/sec.
 *  - A CSS `transition` on width. The width is rewritten every frame, which
 *    restarts the transition before it can resolve and leaves the computed width
 *    pinned at 0 (an empty bar). Frame-level updates are already smooth.
 *
 * Progress eases asymptotically toward the stage ceiling, so it keeps inching
 * forward for as long as the stage runs and never overshoots into the next one.
 */
function useStageProgress(traceState, { fillRef, textRef, trackRef }) {
  const valueRef = useRef(0);

  useEffect(() => {
    const range = STAGE_RANGE[traceState];
    if (!range) {
      valueRef.current = 0;
      return undefined;
    }

    const [start, end] = range;
    // Resume from the previous stage's ceiling rather than snapping backwards.
    if (!(valueRef.current > start && valueRef.current < end)) valueRef.current = start;

    let frame = 0;
    let lastTime = performance.now();
    let lastShown = -1;

    const paint = (now) => {
      // Clamp dt so a backgrounded tab doesn't jump the bar on return.
      const dt = Math.min(now - lastTime, 120) / 1000;
      lastTime = now;

      const current = valueRef.current;
      valueRef.current = current + (end - current) * (1 - Math.exp(-STAGE_EASE_RATE * dt));
      const value = valueRef.current;

      if (fillRef.current) fillRef.current.style.width = `${value.toFixed(2)}%`;

      const rounded = Math.round(value);
      if (rounded !== lastShown) {
        lastShown = rounded;
        if (textRef.current) textRef.current.textContent = `${rounded}%`;
        trackRef.current?.setAttribute("aria-valuenow", String(rounded));
      }

      frame = requestAnimationFrame(paint);
    };

    frame = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(frame);
  }, [traceState, fillRef, textRef, trackRef]);

  return valueRef;
}

const SplitViewCanvas = memo(function SplitViewCanvas({
  project,
  traceState,
  nodeErrors,
  commandBar,
}) {
  const isPatternWorkspace = project?.trace_type === "pattern";
  const stageLabels = isPatternWorkspace
    ? ["Pattern retrace", "Detail pass", "Vector output"]
    : STAGE_LABELS;
  const [activeTab, setActiveTab] = useState("generated");
  const progressFillRef = useRef(null);
  const progressTextRef = useRef(null);
  const progressTrackRef = useRef(null);
  useStageProgress(traceState, {
    fillRef: progressFillRef,
    textRef: progressTextRef,
    trackRef: progressTrackRef,
  });
  const [zoomLevel, setZoomLevel] = useState(1);
  const [canvasViewport, setCanvasViewport] = useState({ width: 0, height: 0 });
  const [artworkAspectRatio, setArtworkAspectRatio] = useState(null);
  const leftScrollRef = useRef(null);
  const rightScrollRef = useRef(null);
  const leftZoomSpaceRef = useRef(null);
  const rightZoomSpaceRef = useRef(null);
  const leftArtworkRef = useRef(null);
  const rightArtworkRef = useRef(null);
  const zoomOutputRef = useRef(null);
  const canvasPairRef = useRef(null);
  const isSyncingLeft = useRef(false);
  const isSyncingRight = useRef(false);
  const isApplyingZoomScroll = useRef(false);
  const zoomScrollReleaseFrame = useRef(0);
  const containerRef = useRef(null);

  const currentZoom = useRef(zoomLevel);
  const canvasViewportRef = useRef(canvasViewport);
  canvasViewportRef.current = canvasViewport;
  const artworkAspectRatioRef = useRef(artworkAspectRatio);
  artworkAspectRatioRef.current = artworkAspectRatio;
  const pendingScrollRef = useRef(null);
  const targetZoomRef = useRef(zoomLevel);
  const wheelAnimationRef = useRef(0);
  const wheelAnchorRef = useRef(null);
  const panGestureRef = useRef(null);
  const panFrameRef = useRef(0);
  const panPointRef = useRef({ x: 0, y: 0 });
  const isApplyingPanScroll = useRef(false);
  const panScrollReleaseFrame = useRef(0);
  const previousActiveUrlRef = useRef(null);
  const wasProcessingRef = useRef(false);
  const [completionRevealKey, setCompletionRevealKey] = useState("");
  const [previewTransitionPhase, setPreviewTransitionPhase] = useState("idle");
  const previewTransitionKeyRef = useRef("");
  const previewTransitionStartedRef = useRef(0);
  const previewTransitionTimerRef = useRef(0);
  const previewTransitionEndTimerRef = useRef(0);

  useLayoutEffect(() => {
    const pane = leftScrollRef.current;
    if (!pane) return undefined;

    const measure = () => {
      const next = { width: pane.clientWidth, height: pane.clientHeight };
      setCanvasViewport((current) => (
        current.width === next.width && current.height === next.height ? current : next
      ));
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(pane);
    return () => observer.disconnect();
  }, []);

  // Wheel input updates a target only; the rendered zoom eases toward it. This
  // makes a coarse mouse wheel feel as fluid as a trackpad and prevents event
  // bursts from snapping the heavy SVG between discrete scales.
  useEffect(() => {
    let lastFrameTime = 0;

    const paintZoomLayout = (zoom) => {
      const viewport = canvasViewportRef.current;
      const aspectRatio = artworkAspectRatioRef.current;
      const hasFittedLayout = viewport.width > 0 && viewport.height > 0 && aspectRatio;
      const fitted = hasFittedLayout
        ? calculateFittedArtworkLayout({
            viewportWidth: viewport.width,
            viewportHeight: viewport.height,
            aspectRatio,
            zoom,
          })
        : null;
      const fallback = fitted ? null : calculateZoomLayerSize(zoom);
      const surfaceWidth = fitted ? `${fitted.surfaceWidth}px` : `${fallback.scrollPercent}%`;
      const surfaceHeight = fitted ? `${fitted.surfaceHeight}px` : `${fallback.scrollPercent}%`;
      const artworkWidth = fitted ? `${fitted.artworkWidth}px` : `${fallback.artworkPercent}%`;
      const artworkHeight = fitted ? `${fitted.artworkHeight}px` : `${fallback.artworkPercent}%`;
      const artworkPadding = fitted ? "0px" : "24px";

      for (const space of [leftZoomSpaceRef.current, rightZoomSpaceRef.current]) {
        if (!space) continue;
        space.style.width = surfaceWidth;
        space.style.height = surfaceHeight;
      }
      for (const artwork of [leftArtworkRef.current, rightArtworkRef.current]) {
        if (!artwork) continue;
        artwork.style.width = artworkWidth;
        artwork.style.height = artworkHeight;
        artwork.style.padding = artworkPadding;
      }

      if (zoomOutputRef.current) {
        const percentage = Math.round(zoom * 100);
        zoomOutputRef.current.textContent = `${percentage}%`;
        zoomOutputRef.current.setAttribute("aria-label", `Zoom ${percentage} percent`);
      }
      if (canvasPairRef.current && !panGestureRef.current) {
        canvasPairRef.current.style.cursor = zoom > 1 ? "grab" : "default";
      }
    };

    const applyZoomScroll = (positions) => {
      const leftPane = leftScrollRef.current;
      const rightPane = rightScrollRef.current;
      if (!leftPane || !rightPane) return;

      isApplyingZoomScroll.current = true;
      leftPane.scrollLeft = positions.leftPane.left;
      leftPane.scrollTop = positions.leftPane.top;
      rightPane.scrollLeft = positions.rightPane.left;
      rightPane.scrollTop = positions.rightPane.top;

      if (zoomScrollReleaseFrame.current) cancelAnimationFrame(zoomScrollReleaseFrame.current);
      zoomScrollReleaseFrame.current = requestAnimationFrame(() => {
        isApplyingZoomScroll.current = false;
        isSyncingLeft.current = false;
        isSyncingRight.current = false;
        zoomScrollReleaseFrame.current = 0;
      });
    };

    const animateZoom = (now) => {
      const zoom = currentZoom.current;
      const target = targetZoomRef.current;
      const elapsed = lastFrameTime ? Math.min(now - lastFrameTime, 34) : 16;
      lastFrameTime = now;
      const blend = 1 - Math.exp(-elapsed / WHEEL_ZOOM_EASE_MS);
      const distance = target - zoom;
      const finished = Math.abs(distance) < 0.0015;
      const nextZoom = finished ? target : zoom + distance * blend;

      const leftPane = leftScrollRef.current;
      const rightPane = rightScrollRef.current;
      if (leftPane && rightPane && wheelAnchorRef.current && nextZoom !== zoom) {
        paintZoomLayout(nextZoom);
        applyZoomScroll(resolveZoomAnchor(wheelAnchorRef.current, leftPane, rightPane));
      }

      currentZoom.current = nextZoom;

      if (finished) {
        wheelAnimationRef.current = 0;
        wheelAnchorRef.current = null;
        lastFrameTime = 0;
        setZoomLevel(nextZoom);
      } else {
        wheelAnimationRef.current = requestAnimationFrame(animateZoom);
      }
    };

    const handleWheel = (e) => {
      if (!(e.target instanceof Element) || !e.target.closest(".workspace-canvas-surface")) return;
      if (panGestureRef.current) return;
      e.preventDefault();

      const node = containerRef.current;
      const deltaMultiplier = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? node?.clientHeight || 800 : 1;
      const delta = Math.max(-180, Math.min(180, e.deltaY * deltaMultiplier));
      targetZoomRef.current = Math.min(
        MAX_ZOOM,
        Math.max(MIN_ZOOM, targetZoomRef.current * Math.exp(-delta * WHEEL_ZOOM_SENSITIVITY)),
      );

      if (!wheelAnimationRef.current) {
        const leftPane = leftScrollRef.current;
        const rightPane = rightScrollRef.current;
        if (leftPane && rightPane) {
          wheelAnchorRef.current = createZoomAnchor(
            leftPane,
            rightPane,
            { x: e.clientX, y: e.clientY },
          );
        }
        lastFrameTime = 0;
        wheelAnimationRef.current = requestAnimationFrame(animateZoom);
      }
    };

    const node = containerRef.current;
    if (node) {
      node.addEventListener("wheel", handleWheel, { passive: false });
    }
    return () => {
      if (node) {
        node.removeEventListener("wheel", handleWheel);
      }
      if (wheelAnimationRef.current) cancelAnimationFrame(wheelAnimationRef.current);
      if (zoomScrollReleaseFrame.current) cancelAnimationFrame(zoomScrollReleaseFrame.current);
      if (panFrameRef.current) cancelAnimationFrame(panFrameRef.current);
      if (panScrollReleaseFrame.current) cancelAnimationFrame(panScrollReleaseFrame.current);
      wheelAnchorRef.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    if (pendingScrollRef.current && leftScrollRef.current && rightScrollRef.current) {
      const pending = pendingScrollRef.current;
      const positions = pending.anchor
        ? resolveZoomAnchor(pending.anchor, leftScrollRef.current, rightScrollRef.current)
        : pending;
      const { leftPane, rightPane } = positions;
      isApplyingZoomScroll.current = true;

      leftScrollRef.current.scrollLeft = leftPane.left;
      leftScrollRef.current.scrollTop = leftPane.top;
      rightScrollRef.current.scrollLeft = rightPane.left;
      rightScrollRef.current.scrollTop = rightPane.top;

      pendingScrollRef.current = null;
      if (zoomScrollReleaseFrame.current) cancelAnimationFrame(zoomScrollReleaseFrame.current);
      zoomScrollReleaseFrame.current = requestAnimationFrame(() => {
        isApplyingZoomScroll.current = false;
        isSyncingLeft.current = false;
        isSyncingRight.current = false;
        zoomScrollReleaseFrame.current = 0;
      });
    }
  }, [zoomLevel]);

  // Drag-to-pan uses pointer capture and one DOM update per display frame.
  // Scroll listeners are paused during the gesture so they cannot feed the
  // programmatic positions back into each other and create visible jitter.
  const [isGrabbing, setIsGrabbing] = useState(false);

  const paintPan = () => {
    panFrameRef.current = 0;
    const gesture = panGestureRef.current;
    if (!gesture) return;

    const source = gesture.source;
    const linked = source === leftScrollRef.current ? rightScrollRef.current : leftScrollRef.current;
    if (!source || !linked) return;

    const result = calculateSynchronizedPan({
      sourceStartLeft: gesture.startLeft,
      sourceStartTop: gesture.startTop,
      deltaX: panPointRef.current.x - gesture.startX,
      deltaY: panPointRef.current.y - gesture.startY,
      sourceMaxLeft: source.scrollWidth - source.clientWidth,
      sourceMaxTop: source.scrollHeight - source.clientHeight,
      linkedMaxLeft: linked.scrollWidth - linked.clientWidth,
      linkedMaxTop: linked.scrollHeight - linked.clientHeight,
    });

    isApplyingPanScroll.current = true;
    source.scrollLeft = result.source.left;
    source.scrollTop = result.source.top;
    linked.scrollLeft = result.linked.left;
    linked.scrollTop = result.linked.top;
  };

  const handlePointerDown = (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('button')) return;
    if (currentZoom.current <= 1) return;

    const source = e.target.closest(".workspace-canvas-surface");
    if (source !== leftScrollRef.current && source !== rightScrollRef.current) return;

    if (wheelAnimationRef.current) cancelAnimationFrame(wheelAnimationRef.current);
    wheelAnimationRef.current = 0;
    wheelAnchorRef.current = null;
    targetZoomRef.current = currentZoom.current;
    setZoomLevel(currentZoom.current);

    e.currentTarget.setPointerCapture(e.pointerId);
    panGestureRef.current = {
      pointerId: e.pointerId,
      source,
      startX: e.clientX,
      startY: e.clientY,
      startLeft: source.scrollLeft,
      startTop: source.scrollTop,
    };
    panPointRef.current = { x: e.clientX, y: e.clientY };
    isApplyingPanScroll.current = true;
    setIsGrabbing(true);
  };

  const handlePointerMove = (e) => {
    const gesture = panGestureRef.current;
    if (!gesture || gesture.pointerId !== e.pointerId) return;
    e.preventDefault();
    panPointRef.current = { x: e.clientX, y: e.clientY };
    if (!panFrameRef.current) panFrameRef.current = requestAnimationFrame(paintPan);
  };

  const handlePointerUp = (e) => {
    const gesture = panGestureRef.current;
    if (!gesture || (e.pointerId != null && gesture.pointerId !== e.pointerId)) return;

    if (panFrameRef.current) {
      cancelAnimationFrame(panFrameRef.current);
      panFrameRef.current = 0;
      paintPan();
    }

    panGestureRef.current = null;
    if (e.currentTarget?.hasPointerCapture?.(gesture.pointerId)) {
      e.currentTarget.releasePointerCapture(gesture.pointerId);
    }

    if (panScrollReleaseFrame.current) cancelAnimationFrame(panScrollReleaseFrame.current);
    panScrollReleaseFrame.current = requestAnimationFrame(() => {
      isApplyingPanScroll.current = false;
      isSyncingLeft.current = false;
      isSyncingRight.current = false;
      panScrollReleaseFrame.current = 0;
    });
    setIsGrabbing(false);
  };

  const setZoomFromControl = (nextValue) => {
    const zoom = currentZoom.current;
    const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextValue));
    if (nextZoom === zoom) return;

    if (wheelAnimationRef.current) cancelAnimationFrame(wheelAnimationRef.current);
    wheelAnimationRef.current = 0;
    targetZoomRef.current = nextZoom;

    const leftPane = leftScrollRef.current;
    const rightPane = rightScrollRef.current;
    if (leftPane && rightPane) {
      const rect = leftPane.getBoundingClientRect();
      const anchor = createZoomAnchor(
        leftPane,
        rightPane,
        { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
      );
      pendingScrollRef.current = { anchor };
    }

    currentZoom.current = nextZoom;
    setZoomLevel(nextZoom);
  };

  const fitArtworkToCanvas = () => {
    if (wheelAnimationRef.current) cancelAnimationFrame(wheelAnimationRef.current);
    wheelAnimationRef.current = 0;
    wheelAnchorRef.current = null;
    targetZoomRef.current = 1;
    currentZoom.current = 1;
    pendingScrollRef.current = {
      leftPane: { left: 0, top: 0 },
      rightPane: { left: 0, top: 0 },
    };
    setZoomLevel(1);
    leftScrollRef.current?.scrollTo({ left: 0, top: 0 });
    rightScrollRef.current?.scrollTo({ left: 0, top: 0 });
  };

  // Derive proxy URLs
  const proxyOriginal = useMemo(() =>
    project?.original_image_url
      ? `/api/proxy?url=${encodeURIComponent(project.original_image_url)}`
      : null,
  [project?.original_image_url]);

  const proxyGenerated = useMemo(() =>
    project?.generated_image_url
      ? `/api/proxy?url=${encodeURIComponent(project.generated_image_url)}`
      : null,
  [project?.generated_image_url]);

  const proxyUpscaled = useMemo(() =>
    project?.upscaled_image_url
      ? `/api/proxy?url=${encodeURIComponent(project.upscaled_image_url)}`
      : null,
  [project?.upscaled_image_url]);

  const proxySvg = useMemo(() =>
    project?.svg_url
      ? `/api/proxy?url=${encodeURIComponent(project.svg_url)}`
      : null,
  [project?.svg_url]);

  // Sync scroll positions proportionally
  const handleLeftScroll = (e) => {
    if (isApplyingZoomScroll.current || isApplyingPanScroll.current) return;
    if (isSyncingLeft.current) {
      isSyncingLeft.current = false;
      return;
    }
    if (rightScrollRef.current) {
      isSyncingRight.current = true;
      const l = e.target;
      const r = rightScrollRef.current;
      const maxLX = l.scrollWidth - l.clientWidth;
      const maxRX = r.scrollWidth - r.clientWidth;
      if (maxLX > 0 && maxRX > 0) r.scrollLeft = (l.scrollLeft / maxLX) * maxRX;
      
      const maxLY = l.scrollHeight - l.clientHeight;
      const maxRY = r.scrollHeight - r.clientHeight;
      if (maxLY > 0 && maxRY > 0) r.scrollTop = (l.scrollTop / maxLY) * maxRY;
    }
  };

  const handleRightScroll = (e) => {
    if (isApplyingZoomScroll.current || isApplyingPanScroll.current) return;
    if (isSyncingRight.current) {
      isSyncingRight.current = false;
      return;
    }
    if (leftScrollRef.current) {
      isSyncingLeft.current = true;
      const r = e.target;
      const l = leftScrollRef.current;
      const maxLX = l.scrollWidth - l.clientWidth;
      const maxRX = r.scrollWidth - r.clientWidth;
      if (maxLX > 0 && maxRX > 0) l.scrollLeft = (r.scrollLeft / maxRX) * maxLX;
      
      const maxLY = l.scrollHeight - l.clientHeight;
      const maxRY = r.scrollHeight - r.clientHeight;
      if (maxLY > 0 && maxRY > 0) l.scrollTop = (r.scrollTop / maxRY) * maxLY;
    }
  };

  // Determine active URL
  let activeUrl = null;
  if (activeTab === "generated") activeUrl = proxyGenerated;
  else if (activeTab === "upscaled") activeUrl = proxyUpscaled;
  else if (activeTab === "svg") activeUrl = proxySvg;

  // Auto-switch tabs when new stages complete OR start
  useEffect(() => {
    if (traceState === "step1") setActiveTab("generated");
    else if (traceState === "step2") setActiveTab("upscaled");
    else if (traceState === "step3") setActiveTab("svg");
    else if (traceState === "idle") {
      if (project?.svg_url) setActiveTab("svg");
      else if (project?.upscaled_image_url) setActiveTab("upscaled");
      else if (project?.generated_image_url) setActiveTab("generated");
    }
  }, [traceState, project?.svg_url, project?.upscaled_image_url, project?.generated_image_url]);

  useLayoutEffect(() => {
    if (traceState !== "idle") {
      wasProcessingRef.current = true;
      return;
    }
    if (!activeUrl) return;

    const previousUrl = previousActiveUrlRef.current;
    previousActiveUrlRef.current = activeUrl;

    const shouldReveal = wasProcessingRef.current || (previousUrl && previousUrl !== activeUrl);
    wasProcessingRef.current = false;

    if (!shouldReveal) return;

    const transitionKey = `${activeTab}:${activeUrl}`;
    clearTimeout(previewTransitionTimerRef.current);
    clearTimeout(previewTransitionEndTimerRef.current);
    previewTransitionKeyRef.current = transitionKey;
    previewTransitionStartedRef.current = performance.now();
    setCompletionRevealKey(transitionKey);
    setPreviewTransitionPhase("loading");
  }, [activeUrl, activeTab, traceState]);

  useEffect(() => () => {
    clearTimeout(previewTransitionTimerRef.current);
    clearTimeout(previewTransitionEndTimerRef.current);
  }, []);

  const handlePreviewReady = useCallback(() => {
    const transitionKey = previewTransitionKeyRef.current;
    if (!transitionKey) return;

    clearTimeout(previewTransitionTimerRef.current);
    clearTimeout(previewTransitionEndTimerRef.current);
    const elapsed = performance.now() - previewTransitionStartedRef.current;
    const remaining = Math.max(0, PREVIEW_TRANSITION_MIN_MS - elapsed);

    previewTransitionTimerRef.current = window.setTimeout(() => {
      if (previewTransitionKeyRef.current !== transitionKey) return;
      setPreviewTransitionPhase("revealing");
      previewTransitionEndTimerRef.current = window.setTimeout(() => {
        if (previewTransitionKeyRef.current !== transitionKey) return;
        previewTransitionKeyRef.current = "";
        setCompletionRevealKey("");
        setPreviewTransitionPhase("idle");
      }, PREVIEW_REVEAL_MS);
    }, remaining);
  }, []);

  // Right-side label
  const rightLabel = activeTab === "generated"
    ? isPatternWorkspace ? "PATTERN RETRACE" : "FLAT EXTRACT"
    : activeTab === "upscaled" ? "HD UPSCALE" : "VECTOR PREVIEW";

  const renderStatus = () => {
    if (traceState !== "idle") {
      const stepMeta = traceState === "step1"
        ? isPatternWorkspace
          ? { label: "Pattern Retrace", detail: "Rebuilding the cropped flat artwork at maximum fidelity" }
          : { label: "Flat Extract", detail: "Separating the artwork from the source" }
        : traceState === "step2"
          ? { label: "HD Upscale", detail: "Refining contours and print definition" }
          : { label: "Vector SVG", detail: "Building clean, production-ready paths" };
      const layerState = traceState === "step1" ? 0 : traceState === "step2" ? 1 : 2;
      // Initial paint only — the rAF loop owns these values from the first frame.
      const stageStart = STAGE_RANGE[traceState]?.[0] ?? 0;

      return (
        <div key={traceState} className="processing-blueprint-stage" aria-live="polite">
          <div className="processing-blueprint-bg" />
          <div className="processing-blueprint-board">
            <div className="processing-blueprint-canvas">
              {proxyOriginal && (
                <img
                  src={proxyOriginal}
                  alt="Processing preview"
                  referrerPolicy="no-referrer"
                  decoding="async"
                />
              )}
              <div className="processing-canvas-shade" aria-hidden="true" />
              <span className="processing-canvas-scan" aria-hidden="true" />
              <div className="processing-logo-outline" aria-hidden="true">
                <img className="processing-logo-ghost" src="/SVG/LOGO%20OUTLINE.svg" alt="" decoding="async" />
                <SafeInlineSVG
                  className="processing-logo-vector"
                  url="/SVG/LOGO%20OUTLINE.svg"
                />
                <span className="processing-logo-orbit is-outer" />
                <span className="processing-logo-orbit is-inner" />
                <span className="processing-logo-node n1" />
                <span className="processing-logo-node n2" />
                <span className="processing-logo-node n3" />
                <span className="processing-logo-node n4" />
              </div>
            </div>
          </div>

          <div className="processing-layer-panel">
            <div className="processing-layer-header">
              <span>
                <i className="processing-stage-dot" aria-hidden="true" />
                {stepMeta.label}
              </span>
              <strong>
                <span ref={progressTextRef}>{Math.round(stageStart)}%</span>
                <em>Stage {layerState + 1} of 3</em>
              </strong>
            </div>
            <div
              className="processing-progress-track"
              ref={progressTrackRef}
              role="progressbar"
              aria-valuenow={Math.round(stageStart)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${stepMeta.label}: ${stepMeta.detail}`}
            >
              <i ref={progressFillRef} style={{ width: `${stageStart}%` }} />
            </div>
            <p>{stepMeta.detail}</p>
            <div className="processing-layer-stack">
              {stageLabels.map((label, index) => {
                const state = index < layerState ? "is-done" : index === layerState ? "is-active" : "is-pending";
                return (
                  <div key={label} className={state}>
                    {index < layerState
                      ? <CheckCircle2 size={13} />
                      : index === layerState
                        ? (
                          <span className="processing-stage-activity" aria-hidden="true">
                            <i />
                            <i />
                            <i />
                          </span>
                        )
                        : <span className="processing-stage-pip" aria-hidden="true">{index + 1}</span>}
                    <span>{label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      );
    }
    const failure = nodeErrors?.step3 || nodeErrors?.step2 || nodeErrors?.step1 || nodeErrors?.step4;
    if (failure) {
      return (
        <div role="alert" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#db7777', padding: 24, textAlign: 'center', lineHeight: 1.5 }}>
          <AlertCircle size={32} style={{ marginBottom: '15px' }} />
          <strong>Processing stopped</strong>
          <span style={{ color: '#aaa', fontSize: 12, maxWidth: 340, marginTop: 6 }}>{failure}</span>
          <span style={{ color: '#777', fontSize: 11, marginTop: 12 }}>Your saved work remains available. Use the action on the right to resume.</span>
        </div>
      );
    }
    // Empty state for a stage that has not been generated yet.
    //
    // The previous version of this block styled "Run Auto-Trace" with the same
    // gold gradient as the real button but gave it no onClick — a false
    // affordance that produced dead and rage clicks at the highest-intent
    // moment in the workflow. Two rules keep that from coming back:
    //
    //   1. pointerEvents: none — clicks pass straight through, so this can
    //      never capture one no matter how it is restyled later.
    //   2. No #FFD700 anywhere. Gold is reserved for real controls in this UI,
    //      so muted greys read as information rather than as something to press.
    //
    // Entirely static: no state, no effects, no network, no images. Renders
    // from values already in memory, so it costs nothing on the backend.
    if (!activeUrl) {
      return (
        <div
          style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            height: '100%', gap: '14px', padding: '24px', textAlign: 'center',
            pointerEvents: 'none', userSelect: 'none',
          }}
        >
          <Sparkles size={30} color="#3a3a3a" strokeWidth={1.3} />
          <div>
            <p style={{ margin: '0 0 6px', fontSize: '12px', fontWeight: 600, color: '#5a5a5a', letterSpacing: '0.3px' }}>
              Your {rightLabel.toLowerCase()} will appear here
            </p>
            <p style={{ margin: 0, fontSize: '11px', color: '#444', lineHeight: 1.5 }}>
              Choose your options in the panel on the right, then start the trace.
            </p>
          </div>
        </div>
      );
    }
    return null;
  };

  // Tab config
  const tabs = [
    { id: "generated", label: isPatternWorkspace ? "1. PATTERN RETRACE" : "1. FLAT EXTRACT", hasContent: !!project?.generated_image_url },
    { id: "upscaled",  label: "2. HD UPSCALE",   hasContent: !!project?.upscaled_image_url },
    { id: "svg",       label: "3. VECTOR SVG",    hasContent: !!project?.svg_url },
  ];
  const zoomLayerSize = calculateZoomLayerSize(zoomLevel);
  const fittedArtworkLayout = canvasViewport.width > 0 && canvasViewport.height > 0 && artworkAspectRatio
    ? calculateFittedArtworkLayout({
        viewportWidth: canvasViewport.width,
        viewportHeight: canvasViewport.height,
        aspectRatio: artworkAspectRatio,
        zoom: zoomLevel,
      })
    : null;
  const surfaceWidth = fittedArtworkLayout ? `${fittedArtworkLayout.surfaceWidth}px` : `${zoomLayerSize.scrollPercent}%`;
  const surfaceHeight = fittedArtworkLayout ? `${fittedArtworkLayout.surfaceHeight}px` : `${zoomLayerSize.scrollPercent}%`;
  const artworkWidth = fittedArtworkLayout ? `${fittedArtworkLayout.artworkWidth}px` : `${zoomLayerSize.artworkPercent}%`;
  const artworkHeight = fittedArtworkLayout ? `${fittedArtworkLayout.artworkHeight}px` : `${zoomLayerSize.artworkPercent}%`;
  const artworkPadding = fittedArtworkLayout ? 0 : "24px";

  return (
    <div ref={containerRef} className="garment-split-view" style={{ display: "flex", flexDirection: "column", height: "100%", width: "100%", backgroundColor: "#1a1a1a", position: "relative" }}>

      {/* ── Stage toolbar ── */}
      <div className="garment-stage-toolbar" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", background: "#161616", borderBottom: "1px solid #222", height: "38px", flexShrink: 0 }}>
        <div className="garment-stage-tools" style={{ minWidth: 0, display: "flex", alignItems: "center", padding: "0 12px", gap: "10px", borderRight: "1px solid #222", overflow: "hidden" }}>
          {commandBar || (
            <span style={{ color: "#555", fontSize: "10px", fontWeight: "600", textTransform: "uppercase", letterSpacing: "1px", marginRight: "auto" }}>ORIGINAL UPLOAD</span>
          )}
          <div style={{ marginLeft: "auto", flexShrink: 0 }}>
            <WorkspaceZoomControls
              zoom={zoomLevel}
              min={MIN_ZOOM}
              max={MAX_ZOOM}
              onZoomOut={() => setZoomFromControl(currentZoom.current - 0.25)}
              onZoomIn={() => setZoomFromControl(currentZoom.current + 0.25)}
              onFit={fitArtworkToCanvas}
              outputRef={zoomOutputRef}
            />
          </div>
        </div>

        <div className="garment-stage-tabs" style={{ minWidth: 0, display: "flex", alignItems: "stretch" }}>
          <div style={{ flex: 1, display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", height: "100%" }}>
          {tabs.map((tab, i) => (
            <button
              key={tab.id}
              className={`garment-stage-tab${activeTab === tab.id ? " is-active" : ""}${tab.hasContent ? " has-content" : ""}`}
              onClick={() => setActiveTab(tab.id)}
              style={{
                padding: "0 10px",
                background: activeTab === tab.id ? "#1a1a1a" : "#161616",
                border: "none",
                borderLeft: i > 0 ? "1px solid #333" : "1px solid #333",
                borderRight: i === tabs.length - 1 ? "1px solid #333" : "none",
                color: activeTab === tab.id ? "#FFD700" : tab.hasContent ? "#888" : "#444",
                fontSize: "10px",
                letterSpacing: "0.5px",
                textTransform: "uppercase",
                fontWeight: activeTab === tab.id ? "700" : "600",
                cursor: "pointer",
                transition: "all 0.2s",
                position: "relative",
                whiteSpace: "nowrap",
              }}
            >
              {tab.label}
              {/* Active indicator line at bottom */}
              {activeTab === tab.id && (
                <span className="garment-stage-indicator" style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: "2px", background: "#FFD700" }} />
              )}
            </button>
          ))}
          </div>
        </div>
      </div>

      {/* ── Main canvas area ── */}
      <div ref={canvasPairRef} className="garment-canvas-pair"
        style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", flex: 1, minWidth: 0, overflow: "hidden", cursor: isGrabbing ? "grabbing" : (zoomLevel > 1 ? "grab" : "default"), userSelect: "none", touchAction: "none" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onLostPointerCapture={handlePointerUp}
      >
        {/* LEFT PANEL: Original Image */}
        <div className="garment-canvas-pane is-original" style={{ minWidth: 0, overflow: "hidden", display: "flex", flexDirection: "column", borderRight: "1px solid #2a2a2a" }}>
          <div ref={leftScrollRef} onScroll={handleLeftScroll} className="no-scrollbar workspace-canvas-surface" style={{ width: "100%", minWidth: 0, flex: 1, overflow: "auto", backgroundColor: "#1a1a1a", position: "relative" }}>
            {/* Canvas label */}
            <div className="garment-canvas-label" style={{ position: "absolute", top: "14px", left: "14px", zIndex: 5, fontSize: "10px", fontWeight: "700", color: "#444", letterSpacing: "1.5px", textTransform: "uppercase", pointerEvents: "none" }}>ORIGINAL</div>
            {proxyOriginal ? (
              <div ref={leftZoomSpaceRef} className="workspace-canvas-zoom-space" style={{ position: "relative", width: surfaceWidth, height: surfaceHeight, minWidth: "100%", minHeight: "100%" }}>
                <div ref={leftArtworkRef} className="workspace-canvas-artwork" style={{ position: "absolute", top: "50%", left: "50%", width: artworkWidth, height: artworkHeight, transform: "translate3d(-50%, -50%, 0)", padding: artworkPadding, boxSizing: "border-box", display: "flex", justifyContent: "center", alignItems: "center" }}>
                  <img
                    src={proxyOriginal}
                    draggable={false}
                    alt="Original"
                    onLoad={(event) => {
                      const image = event.currentTarget;
                      if (image.naturalWidth > 0 && image.naturalHeight > 0) {
                        const nextRatio = image.naturalWidth / image.naturalHeight;
                        setArtworkAspectRatio((current) => current === nextRatio ? current : nextRatio);
                      }
                    }}
                    style={{ width: "100%", height: "100%", minWidth: 0, minHeight: 0, objectFit: "contain" }}
                  />
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#444", fontSize: "12px" }}>Original image not found</div>
            )}
          </div>
        </div>

        {/* RIGHT PANEL: Outputs */}
        <div className="garment-canvas-pane is-output" style={{ minWidth: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <div ref={rightScrollRef} onScroll={handleRightScroll} className="no-scrollbar workspace-canvas-surface" style={{ width: "100%", minWidth: 0, flex: 1, overflow: "auto", backgroundColor: "#1c1c1c", position: "relative" }}>
            {/* Canvas label */}
            <div className="garment-canvas-label" style={{ position: "absolute", top: "14px", left: "14px", zIndex: 5, fontSize: "10px", fontWeight: "700", color: activeTab === "svg" ? "rgba(255,215,0,0.35)" : "#444", letterSpacing: "1.5px", textTransform: "uppercase", pointerEvents: "none" }}>{rightLabel}</div>
            {activeUrl && traceState === "idle" ? (
              <div
                ref={rightZoomSpaceRef}
                className={`workspace-canvas-zoom-space${completionRevealKey ? " output-completion-reveal" : ""}`}
                style={{ position: "relative", width: surfaceWidth, height: surfaceHeight, minWidth: "100%", minHeight: "100%" }}
              >
                <div ref={rightArtworkRef} className={`workspace-canvas-artwork${completionRevealKey && previewTransitionPhase === "loading" ? " is-preview-preparing" : ""}`} style={{ position: "absolute", top: "50%", left: "50%", width: artworkWidth, height: artworkHeight, transform: "translate3d(-50%, -50%, 0)", padding: artworkPadding, boxSizing: "border-box", display: "flex", justifyContent: "center", alignItems: "center" }}>
                  {activeTab === "svg" ? (
                    <SafeInlineSVG
                      url={activeUrl}
                      style={{ width: "100%", height: "100%", minWidth: 0, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center" }}
                      loadingFallback={<WorkspaceOutputLoader label="Loading vector preview" />}
                      onReady={handlePreviewReady}
                    />
                  ) : (
                    <OutputRaster
                      key={activeUrl}
                      proxyUrl={activeUrl}
                      directUrl={activeTab === "generated" ? project?.generated_image_url : project?.upscaled_image_url}
                      onReady={handlePreviewReady}
                    />
                  )}
                </div>
                {completionRevealKey && (
                  <div className={`workspace-output-transition${previewTransitionPhase === "revealing" ? " is-revealing" : ""}`} aria-hidden="true">
                    <div className="workspace-output-mark">
                      <LogoLoader size={78} color="#f4f4ef" decorative />
                    </div>
                    <span>Preparing preview</span>
                  </div>
                )}
              </div>
            ) : (
              renderStatus()
            )}
          </div>
        </div>
      </div>

      <style dangerouslySetInnerHTML={{__html: `
        @keyframes spin { 100% { transform: rotate(360deg); } }
      `}} />
    </div>
  );
});

export default SplitViewCanvas;
