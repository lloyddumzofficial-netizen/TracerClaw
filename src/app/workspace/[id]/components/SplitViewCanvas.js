"use client";

import { memo, useMemo, useState, useRef, useEffect, useLayoutEffect } from "react";
import { Scissors, ZoomIn, ZoomOut, Maximize, AlertCircle, Eraser, Loader2 } from "lucide-react";

/**
 * InlineSVG — Fetches SVG text and injects it directly into the DOM.
 * More reliable than <img> (content-type issues) or <object> (doesn't reload on data change).
 */
function InlineSVG({ url, style }) {
  const [svgHtml, setSvgHtml] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!url) { setSvgHtml(null); return; }
    setLoading(true);
    setSvgHtml(null);
    fetch(url)
      .then(r => r.text())
      .then(text => {
        // Sanitize: strip script tags + inline event handlers before injection
        const safe = text
          .replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/\son\w+="[^"]*"/gi, '')
          .replace(/\son\w+='[^']*'/gi, '');
        if (safe.includes('<svg')) {
          // Strip fixed width/height so SVG scales to fit container (Recraft outputs 4096×4096 by default)
          const scaled = safe.replace(/<svg([^>]*?)>/i, (_, attrs) => {
            let clean = attrs;
            const wMatch = attrs.match(/\swidth=["']([^"']+)["']/i);
            const hMatch = attrs.match(/\sheight=["']([^"']+)["']/i);
            const vMatch = attrs.match(/\sviewBox=["']([^"']+)["']/i);

            clean = clean.replace(/\s+width=["'][^"']*["']/gi, '')
                         .replace(/\s+height=["'][^"']*["']/gi, '');

            if (!vMatch && wMatch && hMatch) {
              const w = parseFloat(wMatch[1].replace(/px/i, ''));
              const h = parseFloat(hMatch[1].replace(/px/i, ''));
              if (!isNaN(w) && !isNaN(h)) {
                clean += ` viewBox="0 0 ${w} ${h}"`;
              }
            }
            return `<svg${clean} style="width:100%;height:100%;display:block;" preserveAspectRatio="xMidYMid meet">`;
          });
          setSvgHtml(scaled);
        }
      })
      .catch(err => console.error('[InlineSVG] fetch failed:', err))
      .finally(() => setLoading(false));
  }, [url]);

  if (loading) return <div style={{ ...style, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555', fontSize: 12 }}>Loading SVG...</div>;
  if (!svgHtml) return null;
  return (
    <div
      style={{ ...style, overflow: 'hidden' }}
      dangerouslySetInnerHTML={{ __html: svgHtml }}
    />
  );
}

const SplitViewCanvas = memo(function SplitViewCanvas({
  project,
  traceState,
  nodeErrors,
  onCropOpen,
  onEraseOpen,
  onRemoveBgOpen,
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
            
            <Loader2 size={24} color="#FFD700" className="animate-spin" style={{ marginBottom: "16px" }} />
            <div style={{ fontSize: "14px", color: "#FFD700", fontWeight: "500", marginBottom: "4px" }}>Processing image</div>
            <span style={{ fontSize: "12px", color: "#888" }}>Optimizing paths and reducing colors...</span>
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
    <div ref={containerRef} style={{ display: "flex", flexDirection: "column", height: "100%", width: "100%", backgroundColor: "#1a1a1a", border: "1px solid #444", position: "relative" }}>
      {/* Top Edge Accent */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "2px", background: "linear-gradient(90deg, #FFD700, #444, #1a1a1a)", zIndex: 10 }} />
      
      {/* Zoom Toolbar */}
      <div style={{ display: "flex", padding: "12px 20px", background: "#222", borderBottom: "1px solid #444", alignItems: "center", justifyContent: "center", gap: "12px", zIndex: 5 }}>
        <button onClick={() => setZoomLevel(z => Math.max(0.5, z - 0.25))} style={{ background: "#1a1a1a", border: "1px solid #444", color: "#ccc", borderRadius: "0", padding: "6px 12px", cursor: "pointer", display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", textTransform: "uppercase", letterSpacing: "1px", transition: "all 0.2s" }} onMouseOver={e => e.currentTarget.style.borderColor="#FFD700"} onMouseOut={e => e.currentTarget.style.borderColor="#444"}>
          <ZoomOut size={14} /> Zoom Out
        </button>
        <span style={{ color: "#FFD700", fontSize: "12px", minWidth: "45px", textAlign: "center", fontWeight: "600", fontFamily: "monospace" }}>{Math.round(zoomLevel * 100)}%</span>
        <button onClick={() => setZoomLevel(z => Math.min(4, z + 0.25))} style={{ background: "#1a1a1a", border: "1px solid #444", color: "#ccc", borderRadius: "0", padding: "6px 12px", cursor: "pointer", display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", textTransform: "uppercase", letterSpacing: "1px", transition: "all 0.2s" }} onMouseOver={e => e.currentTarget.style.borderColor="#FFD700"} onMouseOut={e => e.currentTarget.style.borderColor="#444"}>
          <ZoomIn size={14} /> Zoom In
        </button>
        <div style={{ width: "1px", height: "16px", background: "#444", margin: "0 4px" }} />
        <button onClick={() => setZoomLevel(1)} style={{ background: "transparent", border: "none", color: "#888", borderRadius: "0", padding: "6px 12px", cursor: "pointer", display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", textTransform: "uppercase", letterSpacing: "1px", transition: "color 0.2s" }} onMouseOver={e => e.currentTarget.style.color="#FFD700"} onMouseOut={e => e.currentTarget.style.color="#888"}>
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
        <div style={{ flex: 1, display: "flex", flexDirection: "column", borderRight: "1px solid #444" }}>
          <div style={{ padding: "12px 24px", background: "#222", borderBottom: "1px solid #444", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ color: "#888", fontWeight: "600", fontSize: "11px", letterSpacing: "1px", textTransform: "uppercase" }}>ORIGINAL UPLOAD</span>
            {traceState === "idle" && (
              <div style={{ display: "flex", gap: "8px" }}>
                <button onClick={onRemoveBgOpen} style={{ background: "#1a1a1a", border: "1px solid #444", color: "#ccc", borderRadius: "0", padding: "4px 12px", cursor: "pointer", fontSize: "11px", textTransform: "uppercase", letterSpacing: "1px", display: "flex", alignItems: "center", gap: "6px", transition: "all 0.2s" }} onMouseOver={e => e.currentTarget.style.borderColor="#FFD700"} onMouseOut={e => e.currentTarget.style.borderColor="#444"}>
                  <Scissors size={12} /> BG Remove
                </button>
                <button onClick={onEraseOpen} style={{ background: "#1a1a1a", border: "1px solid #444", color: "#ccc", borderRadius: "0", padding: "4px 12px", cursor: "pointer", fontSize: "11px", textTransform: "uppercase", letterSpacing: "1px", display: "flex", alignItems: "center", gap: "6px", transition: "all 0.2s" }} onMouseOver={e => e.currentTarget.style.borderColor="#FFD700"} onMouseOut={e => e.currentTarget.style.borderColor="#444"}>
                  <Eraser size={12} /> Erase Noise
                </button>
                <button onClick={onCropOpen} style={{ background: "rgba(255,215,0,0.1)", border: "1px solid #FFD700", color: "#FFD700", borderRadius: "0", padding: "4px 12px", cursor: "pointer", fontSize: "11px", textTransform: "uppercase", letterSpacing: "1px", display: "flex", alignItems: "center", gap: "6px", transition: "all 0.2s" }} onMouseOver={e => e.currentTarget.style.background="rgba(255,215,0,0.2)"} onMouseOut={e => e.currentTarget.style.background="rgba(255,215,0,0.1)"}>
                  <Scissors size={12} /> Crop Region
                </button>
              </div>
            )}
          </div>
          <div ref={leftScrollRef} onScroll={handleLeftScroll} className="no-scrollbar" style={{ flex: 1, overflow: "auto", backgroundColor: "#222" }}>
            {proxyOriginal ? (
              <div style={{ position: "relative", width: `${Math.max(100, zoomLevel * 100)}%`, height: `${Math.max(100, zoomLevel * 100)}%`, minWidth: "100%", minHeight: "100%" }}>
                <div style={{ position: "absolute", top: "50%", left: "50%", width: `${100 / Math.max(1, zoomLevel)}%`, height: `${100 / Math.max(1, zoomLevel)}%`, transform: `translate(-50%, -50%) scale(${zoomLevel})`, padding: "20px", boxSizing: "border-box", display: "flex", justifyContent: "center", alignItems: "center" }}>
                  <img src={proxyOriginal} draggable={false} alt="Original" style={{ width: "100%", height: "100%", minWidth: 0, minHeight: 0, objectFit: "contain", borderRadius: "2px" }} />
                </div>
              </div>
            ) : (
              <div style={{ color: "#555" }}>Original image not found</div>
            )}
          </div>
        </div>

        {/* RIGHT PANEL: Outputs */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", background: "#222", borderBottom: "1px solid #444", alignItems: "stretch", padding: "0" }}>
            <button 
              onClick={() => setActiveTab("generated")}
              style={{ flex: 1, padding: "12px 0", background: activeTab === "generated" ? "#1a1a1a" : "transparent", border: "none", borderRight: "1px solid #444", borderRadius: "0", color: activeTab === "generated" ? "#FFD700" : "#666", fontSize: "11px", letterSpacing: "1px", textTransform: "uppercase", fontWeight: "600", cursor: "pointer", transition: "all 0.2s" }}
            >
              1. Flat Extract
            </button>
            <button 
              onClick={() => setActiveTab("upscaled")}
              style={{ flex: 1, padding: "12px 0", background: activeTab === "upscaled" ? "#1a1a1a" : "transparent", border: "none", borderRight: "1px solid #444", borderRadius: "0", color: activeTab === "upscaled" ? "#FFD700" : "#666", fontSize: "11px", letterSpacing: "1px", textTransform: "uppercase", fontWeight: "600", cursor: "pointer", transition: "all 0.2s" }}
            >
              2. HD Upscale
            </button>
            <div style={{ flex: 1, position: "relative", display: "flex" }}>
              <button 
                onClick={() => { setActiveTab("svg"); setShowSvgAlert(false); }}
                style={{ flex: 1, padding: "12px 0", background: activeTab === "svg" ? "#1a1a1a" : "transparent", border: "none", borderRadius: "0", color: activeTab === "svg" ? "#FFD700" : "#666", fontSize: "11px", letterSpacing: "1px", textTransform: "uppercase", fontWeight: "600", cursor: "pointer", transition: "all 0.2s" }}
              >
                3. Vector SVG
              </button>
              {showSvgAlert && (
                <div style={{
                  position: "absolute", top: "100%", left: "50%", transform: "translateX(-50%)", marginTop: "12px",
                  background: "#FFD700", color: "#000", padding: "8px 14px", borderRadius: "0",
                  fontSize: "11px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "1px", whiteSpace: "nowrap", zIndex: 100,
                  boxShadow: "0 6px 20px rgba(255, 215, 0, 0.4)", pointerEvents: "none"
                }}>
                  <div style={{ position: "absolute", top: "-6px", left: "50%", transform: "translateX(-50%)", borderLeft: "6px solid transparent", borderRight: "6px solid transparent", borderBottom: "6px solid #FFD700" }} />
                  Vector is Ready! Click here.
                </div>
              )}
            </div>
          </div>
          
          <div ref={rightScrollRef} onScroll={handleRightScroll} className="no-scrollbar" style={{ flex: 1, overflow: "auto", backgroundColor: "#222" }}>
            {activeUrl && traceState === "idle" ? (
              <div style={{ position: "relative", width: `${Math.max(100, zoomLevel * 100)}%`, height: `${Math.max(100, zoomLevel * 100)}%`, minWidth: "100%", minHeight: "100%" }}>
                <div style={{ position: "absolute", top: "50%", left: "50%", width: `${100 / Math.max(1, zoomLevel)}%`, height: `${100 / Math.max(1, zoomLevel)}%`, transform: `translate(-50%, -50%) scale(${zoomLevel})`, padding: "20px", boxSizing: "border-box", display: "flex", justifyContent: "center", alignItems: "center" }}>
                  {activeTab === "svg" ? (
                    <InlineSVG
                      url={activeUrl}
                      style={{ width: "100%", height: "100%", minWidth: 0, minHeight: 0, borderRadius: "2px", display: "flex", alignItems: "center", justifyContent: "center" }}
                    />
                  ) : (
                    <img src={activeUrl} draggable={false} alt="Output" style={{ width: "100%", height: "100%", minWidth: 0, minHeight: 0, objectFit: "contain", borderRadius: "2px" }} />
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
        /* Segment move keyframes removed */
      `}} />
    </div>
  );
});

export default SplitViewCanvas;
