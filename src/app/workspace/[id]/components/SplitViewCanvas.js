"use client";

import { memo, useMemo, useState, useRef, useEffect, useLayoutEffect } from "react";
import { Scissors, ZoomIn, ZoomOut, Maximize, AlertCircle, Eraser } from "lucide-react";

const SplitViewCanvas = memo(function SplitViewCanvas({
  project,
  traceState,
  nodeErrors,
  onCropOpen,
  onEraseOpen,
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
    // Only allow left mouse button (button 0) for panning
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

  // Sync scroll positions proportionally to handle slight viewport dimension differences perfectly
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

  // Determine what to show on the right based on active tab
  let rightSideContent = null;
  let activeUrl = null;

  if (activeTab === "generated") {
    activeUrl = proxyGenerated;
  } else if (activeTab === "upscaled") {
    activeUrl = proxyUpscaled;
  } else if (activeTab === "svg") {
    activeUrl = proxySvg;
  }

  const hasShownSvgAlert = useRef(false);
  const [showSvgAlert, setShowSvgAlert] = useState(false);

  // Auto-switch tabs when new stages complete OR start
  useEffect(() => {
    // Proactive switching during active tracing
    if (traceState === "step1") setActiveTab("generated");
    else if (traceState === "step2") setActiveTab("upscaled");
    else if (traceState === "step3") setActiveTab("svg");
    // Fallback/initial load state
    else if (traceState === "idle") {
      if (project?.upscaled_image_url) setActiveTab("upscaled");
      else if (project?.generated_image_url) setActiveTab("generated");
      else if (project?.svg_url) setActiveTab("svg");
    }
  }, [traceState, project?.svg_url, project?.upscaled_image_url, project?.generated_image_url]);

  // Separate effect for the SVG educational alert
  useEffect(() => {
    if (project?.svg_url && !hasShownSvgAlert.current && activeTab !== "svg") {
      setShowSvgAlert(true);
      hasShownSvgAlert.current = true;
      const t = setTimeout(() => setShowSvgAlert(false), 12000);
      return () => clearTimeout(t);
    }
  }, [project?.svg_url, activeTab]);

  const renderStatus = () => {
    if (traceState !== "idle") {
      return (
        <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', overflow: 'hidden' }}>
          {proxyOriginal && (
            <img 
              src={proxyOriginal} 
              alt="Processing Background" 
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'contain', filter: 'grayscale(80%) blur(4px) brightness(0.35)', transform: 'scale(1.05)', zIndex: 0 }} 
            />
          )}
          <div style={{ zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', color: '#fff', background: 'rgba(0,0,0,0.6)', padding: '24px 48px', borderRadius: '0', backdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,0.05)', boxShadow: '0 10px 40px rgba(0,0,0,0.8)' }}>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', marginBottom: '8px' }}>
              <span style={{ fontSize: '11px', fontWeight: '600', letterSpacing: '2px', color: '#FFD700' }}>AI TRACE IN PROGRESS</span>
              <span style={{ fontSize: '11px', color: '#888' }}>[||||||]</span>
            </div>
            
            <div style={{ width: '260px', height: '6px', background: 'rgba(255,255,255,0.1)', position: 'relative', overflow: 'hidden', marginBottom: '12px' }}>
              <div className="segmented-progress" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', backgroundImage: 'repeating-linear-gradient(to right, #FFD700 0, #FFD700 4px, transparent 4px, transparent 8px)', backgroundSize: '200% 100%', animation: 'segmentMove 0.8s linear infinite' }} />
            </div>

            <span style={{ fontSize: '10px', color: '#aaa' }}>Optimizing paths and reducing colors...</span>
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
          <div style={{ padding: '12px 24px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px dashed rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '12px', fontWeight: '500' }}>Click</span>
            <span style={{ background: 'linear-gradient(135deg, #FFD700 0%, #E5B800 100%)', color: '#000', padding: '4px 10px', borderRadius: '4px', fontSize: '11px', fontWeight: 'bold' }}>Run Auto-Trace</span>
            <span style={{ fontSize: '12px', fontWeight: '500' }}>in the properties panel to begin</span>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div ref={containerRef} style={{ display: "flex", flexDirection: "column", height: "100%", width: "100%", backgroundColor: "#0f0f0f" }}>
      
      {/* Zoom Toolbar */}
      <div style={{ display: "flex", padding: "12px 20px", background: "rgba(255,255,255,0.02)", borderBottom: "1px solid rgba(255,255,255,0.05)", alignItems: "center", justifyContent: "center", gap: "12px" }}>
        <button onClick={() => setZoomLevel(z => Math.max(0.5, z - 0.25))} style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", color: "#ccc", borderRadius: "20px", padding: "6px 12px", cursor: "pointer", display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", transition: "all 0.2s" }} onMouseOver={e => e.currentTarget.style.background="rgba(255,255,255,0.1)"} onMouseOut={e => e.currentTarget.style.background="rgba(255,255,255,0.05)"}>
          <ZoomOut size={14} /> Zoom Out
        </button>
        <span style={{ color: "#fff", fontSize: "12px", minWidth: "45px", textAlign: "center", fontWeight: "600" }}>{Math.round(zoomLevel * 100)}%</span>
        <button onClick={() => setZoomLevel(z => Math.min(4, z + 0.25))} style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", color: "#ccc", borderRadius: "20px", padding: "6px 12px", cursor: "pointer", display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", transition: "all 0.2s" }} onMouseOver={e => e.currentTarget.style.background="rgba(255,255,255,0.1)"} onMouseOut={e => e.currentTarget.style.background="rgba(255,255,255,0.05)"}>
          <ZoomIn size={14} /> Zoom In
        </button>
        <div style={{ width: "1px", height: "16px", background: "rgba(255,255,255,0.1)", margin: "0 4px" }} />
        <button onClick={() => setZoomLevel(1)} style={{ background: "transparent", border: "none", color: "#888", borderRadius: "20px", padding: "6px 12px", cursor: "pointer", display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", transition: "color 0.2s" }} onMouseOver={e => e.currentTarget.style.color="#fff"} onMouseOut={e => e.currentTarget.style.color="#888"}>
          <Maximize size={14} /> Fit
        </button>
      </div>

      <div 
        style={{ display: "flex", flex: 1, overflow: "hidden", cursor: isGrabbing ? "grabbing" : (zoomLevel > 1 ? "grab" : "default"), userSelect: "none" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        {/* LEFT PANEL: Original Image */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", borderRight: "1px solid rgba(255,255,255,0.05)" }}>
          <div style={{ padding: "12px 24px", background: "rgba(255,255,255,0.01)", borderBottom: "1px solid rgba(255,255,255,0.03)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ color: "#aaa", fontWeight: "500", fontSize: "11px", letterSpacing: "1.5px" }}>ORIGINAL UPLOAD</span>
            {traceState === "idle" && (
              <div style={{ display: "flex", gap: "8px" }}>
                <button onClick={onEraseOpen} style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#ccc", borderRadius: "20px", padding: "4px 12px", cursor: "pointer", fontSize: "11px", display: "flex", alignItems: "center", gap: "6px", transition: "all 0.2s" }} onMouseOver={e => e.currentTarget.style.background="rgba(255,255,255,0.1)"} onMouseOut={e => e.currentTarget.style.background="rgba(255,255,255,0.05)"}>
                  <Eraser size={12} /> Erase Noise
                </button>
                <button onClick={onCropOpen} style={{ background: "rgba(255,215,0,0.1)", border: "1px solid rgba(255,215,0,0.3)", color: "#FFD700", borderRadius: "20px", padding: "4px 12px", cursor: "pointer", fontSize: "11px", display: "flex", alignItems: "center", gap: "6px", transition: "all 0.2s" }} onMouseOver={e => e.currentTarget.style.background="rgba(255,215,0,0.2)"} onMouseOut={e => e.currentTarget.style.background="rgba(255,215,0,0.1)"}>
                  <Scissors size={12} /> Crop Region
                </button>
              </div>
            )}
          </div>
          <div ref={leftScrollRef} onScroll={handleLeftScroll} className="no-scrollbar" style={{ flex: 1, overflow: "auto", backgroundColor: "#111", backgroundImage: "radial-gradient(#333 1px, transparent 1px)", backgroundSize: "20px 20px" }}>
            {proxyOriginal ? (
              <div style={{ position: "relative", width: `${Math.max(100, zoomLevel * 100)}%`, height: `${Math.max(100, zoomLevel * 100)}%`, minWidth: "100%", minHeight: "100%" }}>
                <div style={{ position: "absolute", top: "50%", left: "50%", width: `${100 / Math.max(1, zoomLevel)}%`, height: `${100 / Math.max(1, zoomLevel)}%`, transform: `translate(-50%, -50%) scale(${zoomLevel})`, padding: "40px", boxSizing: "border-box", display: "flex", justifyContent: "center", alignItems: "center" }}>
                  <img src={proxyOriginal} draggable={false} alt="Original" style={{ maxWidth: "100%", maxHeight: "100%", minWidth: 0, minHeight: 0, objectFit: "contain", backgroundColor: "#fff", border: "1px solid rgba(255,255,255,0.2)", boxShadow: "0 10px 40px rgba(0,0,0,0.8)", borderRadius: "2px" }} />
                </div>
              </div>
            ) : (
              <div style={{ color: "#555" }}>Original image not found</div>
            )}
          </div>
        </div>

        {/* RIGHT PANEL: Outputs */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", background: "rgba(255,255,255,0.01)", borderBottom: "1px solid rgba(255,255,255,0.03)", padding: "8px 16px", gap: "8px", alignItems: "center" }}>
            <button 
              onClick={() => setActiveTab("generated")}
              style={{ flex: 1, padding: "8px 0", background: activeTab === "generated" ? "rgba(255,255,255,0.1)" : "transparent", border: "none", borderRadius: "6px", color: activeTab === "generated" ? "#fff" : "#666", fontSize: "12px", fontWeight: activeTab === "generated" ? "600" : "500", cursor: "pointer", transition: "all 0.2s" }}
            >
              1. Flat Extract
            </button>
            <button 
              onClick={() => setActiveTab("upscaled")}
              style={{ flex: 1, padding: "8px 0", background: activeTab === "upscaled" ? "rgba(255,255,255,0.1)" : "transparent", border: "none", borderRadius: "6px", color: activeTab === "upscaled" ? "#fff" : "#666", fontSize: "12px", fontWeight: activeTab === "upscaled" ? "600" : "500", cursor: "pointer", transition: "all 0.2s" }}
            >
              2. HD Upscale
            </button>
            <div style={{ flex: 1, position: "relative", display: "flex" }}>
              <button 
                onClick={() => { setActiveTab("svg"); setShowSvgAlert(false); }}
                style={{ flex: 1, padding: "8px 0", background: activeTab === "svg" ? "rgba(255,255,255,0.1)" : "transparent", border: "none", borderRadius: "6px", color: activeTab === "svg" ? "#fff" : "#666", fontSize: "12px", fontWeight: activeTab === "svg" ? "600" : "500", cursor: "pointer", transition: "all 0.2s" }}
              >
                3. Vector SVG
              </button>
              {showSvgAlert && (
                <div style={{
                  position: "absolute", top: "100%", left: "50%", transform: "translateX(-50%)", marginTop: "12px",
                  background: "#FFD700", color: "#000", padding: "8px 14px", borderRadius: "6px",
                  fontSize: "12px", fontWeight: "700", whiteSpace: "nowrap", zIndex: 100,
                  boxShadow: "0 6px 20px rgba(255, 215, 0, 0.4)", pointerEvents: "none"
                }}>
                  <div style={{ position: "absolute", top: "-6px", left: "50%", transform: "translateX(-50%)", borderLeft: "6px solid transparent", borderRight: "6px solid transparent", borderBottom: "6px solid #FFD700" }} />
                  Vector is Ready! Click here.
                </div>
              )}
            </div>
          </div>
          
          <div ref={rightScrollRef} onScroll={handleRightScroll} className="no-scrollbar" style={{ flex: 1, overflow: "auto", backgroundColor: "#111", backgroundImage: "radial-gradient(#333 1px, transparent 1px)", backgroundSize: "20px 20px" }}>
            {activeUrl && traceState === "idle" ? (
              <div style={{ position: "relative", width: `${Math.max(100, zoomLevel * 100)}%`, height: `${Math.max(100, zoomLevel * 100)}%`, minWidth: "100%", minHeight: "100%" }}>
                <div style={{ position: "absolute", top: "50%", left: "50%", width: `${100 / Math.max(1, zoomLevel)}%`, height: `${100 / Math.max(1, zoomLevel)}%`, transform: `translate(-50%, -50%) scale(${zoomLevel})`, padding: "40px", boxSizing: "border-box", display: "flex", justifyContent: "center", alignItems: "center" }}>
                  {activeTab === "svg" ? (
                    <img src={activeUrl} draggable={false} alt="Output" style={{ maxWidth: "100%", maxHeight: "100%", minWidth: 0, minHeight: 0, objectFit: "contain", backgroundColor: "#fff", border: "1px solid rgba(255,255,255,0.2)", boxShadow: "0 10px 40px rgba(0,0,0,0.8)", borderRadius: "2px" }} />
                  ) : (
                    <img src={activeUrl} draggable={false} alt="Output" style={{ maxWidth: "100%", maxHeight: "100%", minWidth: 0, minHeight: 0, objectFit: "contain", backgroundColor: "#fff", border: "1px solid rgba(255,255,255,0.2)", boxShadow: "0 10px 40px rgba(0,0,0,0.8)", borderRadius: "2px" }} />
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
        @keyframes segmentMove { 0% { background-position: 0 0; } 100% { background-position: 8px 0; } }
      `}} />
    </div>
  );
});

export default SplitViewCanvas;
