"use client";

import { memo, useMemo, useState, useRef, useEffect, useLayoutEffect } from "react";
import { Maximize, AlertCircle, CheckCircle2 } from "lucide-react";
import SafeInlineSVG from "@/app/components/SafeInlineSVG";

const SplitViewCanvas = memo(function SplitViewCanvas({
  project,
  traceState,
  nodeErrors,
}) {
  const [activeTab, setActiveTab] = useState("generated");
  const [zoomLevel, setZoomLevel] = useState(1);
  const leftScrollRef = useRef(null);
  const rightScrollRef = useRef(null);
  const isSyncingLeft = useRef(false);
  const isSyncingRight = useRef(false);
  const containerRef = useRef(null);

  const currentZoom = useRef(zoomLevel);
  currentZoom.current = zoomLevel;
  const pendingScrollRef = useRef(null);
  const previousActiveUrlRef = useRef(null);
  const wasProcessingRef = useRef(false);
  const wasHiddenRef = useRef(false);
  const focusRevealTimerRef = useRef(null);
  const [completionRevealKey, setCompletionRevealKey] = useState("");
  const [animationResumeKey, setAnimationResumeKey] = useState(0);

  // Scroll to zoom to pointer
  useEffect(() => {
    const handleWheel = (e) => {
      e.preventDefault();
      const z = currentZoom.current;
      const delta = Math.sign(e.deltaY) * 0.25;
      const newZ = Math.min(Math.max(0.25, z - delta), 5);
      if (newZ === z) return;

      const scale = newZ / z;
      const leftScroll = leftScrollRef.current;
      const rightScroll = rightScrollRef.current;
      
      if (leftScroll && rightScroll) {
        const rectL = leftScroll.getBoundingClientRect();
        const rectR = rightScroll.getBoundingClientRect();
        
        let active, rect;
        if (e.clientX >= rectL.left && e.clientX <= rectL.right && e.clientY >= rectL.top && e.clientY <= rectL.bottom) {
          active = leftScroll;
          rect = rectL;
        } else if (e.clientX >= rectR.left && e.clientX <= rectR.right && e.clientY >= rectR.top && e.clientY <= rectR.bottom) {
          active = rightScroll;
          rect = rectR;
        }

        if (active && rect) {
          const mouseX = e.clientX - rect.left;
          const mouseY = e.clientY - rect.top;
          
          const pointX = active.scrollLeft + mouseX;
          const pointY = active.scrollTop + mouseY;
          
          pendingScrollRef.current = { 
            left: pointX * scale - mouseX, 
            top: pointY * scale - mouseY 
          };
        }
      }
      setZoomLevel(newZ);
    };

    const node = containerRef.current;
    if (node) {
      node.addEventListener("wheel", handleWheel, { passive: false });
    }
    return () => {
      if (node) {
        node.removeEventListener("wheel", handleWheel);
      }
    };
  }, []);

  useLayoutEffect(() => {
    if (pendingScrollRef.current && leftScrollRef.current && rightScrollRef.current) {
      const { left, top } = pendingScrollRef.current;
      isSyncingLeft.current = true;
      isSyncingRight.current = true;
      
      leftScrollRef.current.scrollLeft = left;
      leftScrollRef.current.scrollTop = top;
      rightScrollRef.current.scrollLeft = left;
      rightScrollRef.current.scrollTop = top;
      
      pendingScrollRef.current = null;
    }
  }, [zoomLevel]);

  // Drag to pan state
  const [isGrabbing, setIsGrabbing] = useState(false);
  const lastPos = useRef({ x: 0, y: 0 });

  const handlePointerDown = (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('button')) return;
    setIsGrabbing(true);
    lastPos.current = { x: e.clientX, y: e.clientY };
  };

  const handlePointerMove = (e) => {
    if (!isGrabbing) return;
    const dx = e.clientX - lastPos.current.x;
    const dy = e.clientY - lastPos.current.y;
    lastPos.current = { x: e.clientX, y: e.clientY };

    if (leftScrollRef.current && rightScrollRef.current) {
      isSyncingLeft.current = true;
      isSyncingRight.current = true;
      leftScrollRef.current.scrollLeft -= dx;
      leftScrollRef.current.scrollTop -= dy;
      rightScrollRef.current.scrollLeft -= dx;
      rightScrollRef.current.scrollTop -= dy;
    }
  };

  const handlePointerUp = () => {
    setIsGrabbing(false);
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

  const hasShownSvgAlert = useRef(false);
  const [showSvgAlert, setShowSvgAlert] = useState(false);

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

  useEffect(() => {
    if (project?.svg_url && !hasShownSvgAlert.current && activeTab !== "svg") {
      setShowSvgAlert(true);
      hasShownSvgAlert.current = true;
      const t = setTimeout(() => setShowSvgAlert(false), 12000);
      return () => clearTimeout(t);
    }
  }, [project?.svg_url, activeTab]);

  useEffect(() => {
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

    setCompletionRevealKey(`${activeTab}:${activeUrl}`);
    const t = setTimeout(() => setCompletionRevealKey(""), 1150);
    return () => clearTimeout(t);
  }, [activeUrl, activeTab, traceState]);

  useEffect(() => {
    const restartVisibleAnimation = () => {
      if (document.visibilityState === "hidden") {
        wasHiddenRef.current = true;
        return;
      }
      if (!wasHiddenRef.current) return;
      wasHiddenRef.current = false;

      if (traceState !== "idle") {
        setAnimationResumeKey(key => key + 1);
        return;
      }

      if (!activeUrl) return;
      setCompletionRevealKey(`focus:${activeTab}:${activeUrl}:${Date.now()}`);
      if (focusRevealTimerRef.current) clearTimeout(focusRevealTimerRef.current);
      focusRevealTimerRef.current = setTimeout(() => setCompletionRevealKey(""), 1150);
    };

    document.addEventListener("visibilitychange", restartVisibleAnimation);
    window.addEventListener("focus", restartVisibleAnimation);
    return () => {
      document.removeEventListener("visibilitychange", restartVisibleAnimation);
      window.removeEventListener("focus", restartVisibleAnimation);
      if (focusRevealTimerRef.current) clearTimeout(focusRevealTimerRef.current);
    };
  }, [activeUrl, activeTab, traceState]);

  // Right-side label
  const rightLabel = activeTab === "generated" ? "FLAT EXTRACT" : activeTab === "upscaled" ? "HD UPSCALE" : "VECTOR PREVIEW";

  const renderStatus = () => {
    if (traceState !== "idle") {
      const stepMeta = traceState === "step1"
        ? { label: "Flat Extract", detail: "Isolating garment artwork", progress: "34%" }
        : traceState === "step2"
          ? { label: "HD Upscale", detail: "Rebuilding print detail", progress: "67%" }
          : { label: "Vector SVG", detail: "Preparing Illustrator-ready paths", progress: "92%" };
      const layerState = traceState === "step1" ? 0 : traceState === "step2" ? 1 : 2;

      return (
        <div key={`${traceState}:${animationResumeKey}`} className="processing-blueprint-stage" aria-live="polite">
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
              <div className="processing-drafting-frame">
                <span />
                <span />
                <span />
                <span />
              </div>
              <div className="processing-logo-outline" aria-hidden="true">
                <img src="/SVG/LOGO%20OUTLINE.svg" alt="" decoding="async" />
              </div>
              <div className="processing-reveal-sweep" />
              <div className="processing-anchor a1" />
              <div className="processing-anchor a2" />
              <div className="processing-anchor a3" />
              <div className="processing-anchor a4" />
            </div>
          </div>

          <div className="processing-layer-panel">
            <div className="processing-layer-header">
              <span>{stepMeta.label}</span>
              <strong>{stepMeta.progress}</strong>
            </div>
            <div className="processing-progress-track">
              <i style={{ width: stepMeta.progress }} />
            </div>
            <p>
              {stepMeta.detail}
            </p>
            <div className="processing-layer-stack">
              {[
                "Clean artwork",
                "Print detail",
                "Vector paths",
              ].map((label, index) => (
                <div key={label} className={index <= layerState ? "is-active" : ""}>
                  <CheckCircle2 size={13} />
                  <span>{label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      );
    }
    if (nodeErrors?.step2 || nodeErrors?.step3 || nodeErrors?.step4) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#ff4444' }}>
          <AlertCircle size={32} style={{ marginBottom: '15px' }} />
          Trace Failed
        </div>
      );
    }
    if (!activeUrl) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#666', gap: '12px' }}>
          <div style={{ padding: '12px 24px', background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '12px', fontWeight: '500' }}>Click</span>
            <span style={{ background: 'linear-gradient(135deg, #FFD700 0%, #E5B800 100%)', color: '#000', padding: '4px 10px', fontSize: '11px', fontWeight: 'bold' }}>Run Auto-Trace</span>
            <span style={{ fontSize: '12px', fontWeight: '500' }}>to begin</span>
          </div>
        </div>
      );
    }
    return null;
  };

  // Tab config
  const tabs = [
    { id: "generated", label: "1. FLAT EXTRACT", hasContent: !!project?.generated_image_url },
    { id: "upscaled",  label: "2. HD UPSCALE",   hasContent: !!project?.upscaled_image_url },
    { id: "svg",       label: "3. VECTOR SVG",    hasContent: !!project?.svg_url },
  ];

  return (
    <div ref={containerRef} style={{ display: "flex", flexDirection: "column", height: "100%", width: "100%", backgroundColor: "#1a1a1a", position: "relative" }}>

      {/* ── Sub-toolbar: context LEFT, zoom controls CENTER ── */}
      <div style={{ display: "flex", alignItems: "center", padding: "0 16px", background: "#1e1e1e", borderBottom: "1px solid #333", height: "38px", flexShrink: 0, gap: "8px" }}>

        {/* Left: workspace context */}
        <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
          <span style={{ color: "#555", fontSize: "10px", fontWeight: "600", textTransform: "uppercase", letterSpacing: "1px", marginRight: "4px" }}>ORIGINAL UPLOAD</span>
        </div>

        {/* Center: zoom */}
        <div style={{ flex: 1, display: "flex", justifyContent: "center", alignItems: "center", gap: "6px" }}>
          <button onClick={() => setZoomLevel(z => Math.max(0.25, z - 0.25))} style={zoomBtnStyle} onMouseOver={e => e.currentTarget.style.borderColor="#FFD700"} onMouseOut={e => e.currentTarget.style.borderColor="#333"}>−</button>
          <span style={{ color: "#FFD700", fontSize: "11px", minWidth: "42px", textAlign: "center", fontWeight: "600", fontFamily: "monospace" }}>{Math.round(zoomLevel * 100)}%</span>
          <button onClick={() => setZoomLevel(z => Math.min(5, z + 0.25))} style={zoomBtnStyle} onMouseOver={e => e.currentTarget.style.borderColor="#FFD700"} onMouseOut={e => e.currentTarget.style.borderColor="#333"}>+</button>
          <div style={{ width: "1px", height: "14px", background: "#333", margin: "0 4px" }} />
          <button onClick={() => setZoomLevel(1)} style={{ ...zoomBtnStyle, border: "none", color: "#888", padding: "4px 8px" }} onMouseOver={e => e.currentTarget.style.color="#FFD700"} onMouseOut={e => e.currentTarget.style.color="#888"}>
            <Maximize size={12} style={{ display: "inline", marginRight: "4px", verticalAlign: "middle" }} />Fit
          </button>
        </div>

        {/* Right: right-panel tab label */}
        <div style={{ display: "flex", gap: "0", alignItems: "stretch", height: "100%" }}>
          {tabs.map((tab, i) => (
            <button
              key={tab.id}
              onClick={() => { setActiveTab(tab.id); setShowSvgAlert(false); }}
              style={{
                padding: "0 14px",
                background: activeTab === tab.id ? "#111" : "transparent",
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
              onMouseOver={e => { if (activeTab !== tab.id) e.currentTarget.style.color = "#ccc"; }}
              onMouseOut={e => { if (activeTab !== tab.id) e.currentTarget.style.color = tab.hasContent ? "#888" : "#444"; }}
            >
              {tab.label}
              {/* Active indicator line at bottom */}
              {activeTab === tab.id && (
                <span style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: "2px", background: "#FFD700" }} />
              )}
              {/* SVG ready tooltip */}
              {tab.id === "svg" && showSvgAlert && (
                <div style={{
                  position: "absolute", top: "calc(100% + 8px)", left: "50%", transform: "translateX(-50%)",
                  background: "#FFD700", color: "#000", padding: "6px 12px",
                  fontSize: "10px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "1px", whiteSpace: "nowrap", zIndex: 100,
                  boxShadow: "0 4px 16px rgba(255, 215, 0, 0.4)", pointerEvents: "none"
                }}>
                  <div style={{ position: "absolute", top: "-5px", left: "50%", transform: "translateX(-50%)", borderLeft: "5px solid transparent", borderRight: "5px solid transparent", borderBottom: "5px solid #FFD700" }} />
                  Vector is Ready! Click here.
                </div>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── Main canvas area ── */}
      <div 
        style={{ display: "flex", flex: 1, overflow: "hidden", cursor: isGrabbing ? "grabbing" : (zoomLevel > 1 ? "grab" : "default"), userSelect: "none" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        {/* LEFT PANEL: Original Image */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", borderRight: "1px solid #2a2a2a" }}>
          <div ref={leftScrollRef} onScroll={handleLeftScroll} className="no-scrollbar" style={{ flex: 1, overflow: "auto", backgroundColor: "#1a1a1a", position: "relative" }}>
            {/* Canvas label */}
            <div style={{ position: "absolute", top: "14px", left: "14px", zIndex: 5, fontSize: "10px", fontWeight: "700", color: "#444", letterSpacing: "1.5px", textTransform: "uppercase", pointerEvents: "none" }}>ORIGINAL</div>
            {proxyOriginal ? (
              <div style={{ position: "relative", width: `${Math.max(100, zoomLevel * 100)}%`, height: `${Math.max(100, zoomLevel * 100)}%`, minWidth: "100%", minHeight: "100%" }}>
                <div style={{ position: "absolute", top: "50%", left: "50%", width: `${100 / Math.max(1, zoomLevel)}%`, height: `${100 / Math.max(1, zoomLevel)}%`, transform: `translate(-50%, -50%) scale(${zoomLevel})`, padding: "24px", boxSizing: "border-box", display: "flex", justifyContent: "center", alignItems: "center" }}>
                  <img src={proxyOriginal} draggable={false} alt="Original" style={{ width: "100%", height: "100%", minWidth: 0, minHeight: 0, objectFit: "contain" }} />
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#444", fontSize: "12px" }}>Original image not found</div>
            )}
          </div>
        </div>

        {/* RIGHT PANEL: Outputs */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          <div ref={rightScrollRef} onScroll={handleRightScroll} className="no-scrollbar" style={{ flex: 1, overflow: "auto", backgroundColor: "#1c1c1c", position: "relative" }}>
            {/* Canvas label */}
            <div style={{ position: "absolute", top: "14px", left: "14px", zIndex: 5, fontSize: "10px", fontWeight: "700", color: activeTab === "svg" ? "rgba(255,215,0,0.35)" : "#444", letterSpacing: "1.5px", textTransform: "uppercase", pointerEvents: "none" }}>{rightLabel}</div>
            {activeUrl && traceState === "idle" ? (
              <div
                className={completionRevealKey ? "output-completion-reveal" : ""}
                style={{ position: "relative", width: `${Math.max(100, zoomLevel * 100)}%`, height: `${Math.max(100, zoomLevel * 100)}%`, minWidth: "100%", minHeight: "100%" }}
              >
                <div style={{ position: "absolute", top: "50%", left: "50%", width: `${100 / Math.max(1, zoomLevel)}%`, height: `${100 / Math.max(1, zoomLevel)}%`, transform: `translate(-50%, -50%) scale(${zoomLevel})`, padding: "24px", boxSizing: "border-box", display: "flex", justifyContent: "center", alignItems: "center" }}>
                  {activeTab === "svg" ? (
                    <SafeInlineSVG
                      url={activeUrl}
                      style={{ width: "100%", height: "100%", minWidth: 0, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center" }}
                      loadingFallback={<div style={{ width: "100%", height: "100%", display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555', fontSize: 12 }}>Loading SVG...</div>}
                    />
                  ) : (
                    <img src={activeUrl} draggable={false} alt="Output" style={{ width: "100%", height: "100%", minWidth: 0, minHeight: 0, objectFit: "contain" }} />
                  )}
                </div>
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

const zoomBtnStyle = {
  background: "#1a1a1a",
  border: "1px solid #333",
  color: "#ccc",
  padding: "4px 10px",
  cursor: "pointer",
  fontSize: "12px",
  fontWeight: "600",
  transition: "all 0.15s",
  lineHeight: 1,
};

export default SplitViewCanvas;
