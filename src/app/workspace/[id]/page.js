"use client";

import { useState, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { 
  ArrowLeft, Download, Monitor, CheckCircle, 
  Settings2, ChevronDown, ImageIcon, Brain, PenTool, Play, 
  Scissors, X, Home, MousePointer2, Hand, ZoomIn, Shirt, Scan, Crop, FolderDown,
  CreditCard, Package, Tag, Mail, Smartphone, Check, MoreHorizontal, RotateCw
} from "lucide-react";
import ReactCrop from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';

export default function Workspace() {
  const router = useRouter();
  const params = useParams();
  const projectId = params.id;
  const [project, setProject] = useState(null);
  const [activeMode, setActiveMode] = useState("pattern");
  const [activeTool, setActiveTool] = useState("pointer");
  
  // Pan and Zoom State
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });

  // Cropper State
  const [showCropModal, setShowCropModal] = useState(false);
  const [crop, setCrop] = useState();
  const [completedCrop, setCompletedCrop] = useState(null);
  const [cropError, setCropError] = useState("");
  const imgRef = useRef(null);
  
  // Compare Slider State
  const [showCompare, setShowCompare] = useState(false);
  const [sliderPosition, setSliderPosition] = useState(50);
  const isDraggingCompare = useRef(false);
  const [showCompletionModal, setShowCompletionModal] = useState(false);
  const [showNoCreditsModal, setShowNoCreditsModal] = useState(false);
  const [userCredits, setUserCredits] = useState(null); // Track credits in workspace
  const [showTopUpModal, setShowTopUpModal] = useState(false);
  const [topUpStep, setTopUpStep] = useState(1);
  const [topUpForm, setTopUpForm] = useState({ plan: 'pro', txnRef: '', screenshotName: '', screenshotFile: null });
  const [topUpSubmitted, setTopUpSubmitted] = useState(false);
  const [isSubmittingTopUp, setIsSubmittingTopUp] = useState(false);
  const [user, setUser] = useState(null);
  
  const [traceState, setTraceState] = useState("idle"); // idle, step1, step2, step3
  const [svgResult, setSvgResult] = useState(null);
  const [consoleLogs, setConsoleLogs] = useState(["[System] DESAYNCLAW V2.0 Cloud Connected.", "[System] Loading project..."]);
  
  const logMsg = (msg, type = "normal") => {
    setConsoleLogs(prev => [...prev, { text: msg, type }]);
  };

  useEffect(() => {
    const fetchData = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) setUser(session.user);
        
        const { data: projData, error: projError } = await supabase.from('projects').select('*').eq('id', projectId).single();
        if (projError || !projData) {
          router.push('/');
          return;
        }
        setProject(projData);

        // Auto-show crop modal for new untraced projects so users don't forget to crop
        if (!projData.generated_image_url) {
          setShowCropModal(true);
        }

        // Fetch user credits
        if (session?.user) {
          const { data: profile } = await supabase.from('profiles').select('credits').eq('id', session.user.id).single();
          if (profile) setUserCredits(profile.credits);
        }
      } catch (err) {
        console.error(err);
      }
    };
    
    if (projectId) {
      fetchData();
    }
  }, [projectId]);

  const generateCrop = async () => {
    if (!completedCrop || !imgRef.current || !completedCrop.width || !completedCrop.height) {
      if (!project?.generated_image_url) {
        setCropError("Please draw a crop area first! You must choose either the front or the back.");
        return;
      }
      setShowCropModal(false);
      return;
    }
    const canvas = document.createElement("canvas");
    const image = imgRef.current;
    const scaleX = image.naturalWidth / image.width;
    const scaleY = image.naturalHeight / image.height;
    
    const MAX_SIZE = 1024;
    let targetWidth = completedCrop.width * scaleX;
    let targetHeight = completedCrop.height * scaleY;
    
    if (targetWidth > MAX_SIZE || targetHeight > MAX_SIZE) {
      const ratio = Math.min(MAX_SIZE / targetWidth, MAX_SIZE / targetHeight);
      targetWidth *= ratio;
      targetHeight *= ratio;
    }
    
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext("2d");
    
    ctx.drawImage(
      image,
      completedCrop.x * scaleX,
      completedCrop.y * scaleY,
      completedCrop.width * scaleX,
      completedCrop.height * scaleY,
      0,
      0,
      targetWidth,
      targetHeight
    );
    
    const base64 = canvas.toDataURL("image/jpeg", 0.85);
    
    setShowCropModal(false);
    logMsg("[System] Saving cropped image permanently...");
    
    try {
      const res = await fetch("/api/crop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id, croppedBase64: base64 })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      
      setProject(prev => ({ 
        ...prev, 
        original_image_url: data.cropped_image_url,
        generated_image_url: null,
        upscaled_image_url: null,
        svg_url: null 
      }));
      logMsg("[Success] Crop applied and saved! You can now re-trace.", "success");
    } catch (err) {
      logMsg(`[Error] Failed to save crop: ${err.message}`, "error");
    }
  };

  const handleExecuteTrace = async () => {
    if (!project || traceState !== "idle") return;
    
    if (userCredits !== null && userCredits <= 0) {
      setShowNoCreditsModal(true);
      return;
    }

    try {
      // Deduct locally in UI for immediate feedback
      if (userCredits > 0) setUserCredits(prev => prev - 1);

      // Step 1: Gemini
      setTraceState("step1");
      setConsoleLogs([{ text: "[Step 1] Analyzing Image with DesaynVision™...", type: "info" }]);
      const res1 = await fetch("/api/trace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id, step: 1 })
      });
      if (!res1.ok) {
        const isJson = res1.headers.get("content-type")?.includes("application/json");
        if (isJson) {
          const errData = await res1.json();
          throw new Error(errData.error || `Error ${res1.status}`);
        } else {
          throw new Error(res1.status === 504 ? "504 Timeout" : `Server Error ${res1.status}`);
        }
      }
      const data1 = await res1.json();
      
      setProject(prev => ({ ...prev, generated_image_url: data1.generated_image_url }));
      setConsoleLogs(prev => [...prev, { text: "[Success] Image Extracted by DesaynVision™!", type: "success" }]);

      // Step 2: Upscale
      setTraceState("step2");
      setConsoleLogs(prev => [...prev, { text: "[Step 2] Upscaling with ClawScale™ Matrix...", type: "info" }]);
      const res2 = await fetch("/api/trace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id, step: 2 })
      });
      if (!res2.ok) {
        const isJson = res2.headers.get("content-type")?.includes("application/json");
        if (isJson) {
          const errData = await res2.json();
          throw new Error(errData.error || `Error ${res2.status}`);
        } else {
          throw new Error(res2.status === 504 ? "504 Timeout" : `Server Error ${res2.status}`);
        }
      }
      const data2 = await res2.json();

      setProject(prev => ({ ...prev, upscaled_image_url: data2.upscaled_image_url }));
      setConsoleLogs(prev => [...prev, { text: "[Success] Upscale Complete!", type: "success" }]);

      // Step 3: Vectorize
      setTraceState("step3");
      setConsoleLogs(prev => [...prev, { text: "[Step 3] Vectorizing with TrueVector™ Core...", type: "info" }]);
      const res3 = await fetch("/api/trace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id, step: 3 })
      });
      if (!res3.ok) {
        const isJson = res3.headers.get("content-type")?.includes("application/json");
        if (isJson) {
          const errData = await res3.json();
          throw new Error(errData.error || `Error ${res3.status}`);
        } else {
          throw new Error(res3.status === 504 ? "504 Timeout" : `Server Error ${res3.status}`);
        }
      }
      const data3 = await res3.json();

      setSvgResult({ url: data3.svg_url });
      setProject(prev => ({ ...prev, svg_url: data3.svg_url }));
      setConsoleLogs(prev => [...prev, { text: "[Success] Vectorization Complete!", type: "success" }]);
      
      setTraceState("idle");
      // Auto-open the slider compare when done
      setSliderPosition(50);
      setShowCompare(true);
    } catch (error) {
      setTraceState("idle");
      if (error.message === "INSUFFICIENT_CREDITS") {
        // Suppress console.error so Next.js doesn't show the red dev overlay
        setUserCredits(0); // sync local state to 0 if backend caught it
        setShowNoCreditsModal(true);
      } else {
        console.error(error); // Only show overlay for real unexpected errors
        
        // Timeout or failure fallback: Attempt manual refund request to backend
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (session) {
            const refundRes = await fetch("/api/refund", {
              method: "POST",
              headers: { 
                "Content-Type": "application/json",
                "Authorization": `Bearer ${session.access_token}`
              },
              body: JSON.stringify({ projectId: project.id })
            });
            const refundData = await refundRes.json();
            if (refundData.success) {
              setConsoleLogs(prev => [...prev, { text: `[System] The generation timed out or failed. Don't worry, 1 Credit has been successfully refunded!`, type: "success" }]);
              if (userCredits !== null) setUserCredits(prev => prev + 1);
            }
          }
        } catch (refundErr) {
          console.error("Refund request failed", refundErr);
        }

        let errorMsg = error.message;
        if (errorMsg.includes("504") || errorMsg.includes("Failed to fetch")) {
          errorMsg = "Request Timed Out. Please crop the image to make it simpler and try again.";
        }
        setConsoleLogs(prev => [...prev, { text: `[Error] ${errorMsg}`, type: "error" }]);
      }
    }
  };

  const handleDownloadRaster = async () => {
    if (!project || !project.generated_image_url) return;
    forceDownload(project.generated_image_url, `DesaynClaw_${project.name}_Raster.png`);
  };

  const handleDownloadAll = async () => {
    if (!project) return;
    try {
      logMsg(`[System] Zipping all assets...`);
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      
      const urls = [];
      if (project.original_image_url) urls.push({url: project.original_image_url, name: `DesaynClaw_${project.name}_Reference.png`});
      if (project.generated_image_url) urls.push({url: project.generated_image_url, name: `DesaynClaw_${project.name}_DesaynVision.png`});
      if (project.upscaled_image_url) urls.push({url: project.upscaled_image_url, name: `DesaynClaw_${project.name}_Upscaled.png`});
      if (project.svg_url) urls.push({url: project.svg_url, name: `DesaynClaw_${project.name}_Vector.svg`});

      for (const item of urls) {
        try {
          const res = await fetch(item.url);
          const blob = await res.blob();
          zip.file(item.name, blob);
        } catch (e) {
          console.error("Failed to fetch for zip:", e);
        }
      }
      
      const content = await zip.generateAsync({ type: "blob" });
      const objectUrl = URL.createObjectURL(content);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = `DesaynClaw_${project.name}_AllFiles.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(objectUrl);
      logMsg(`[Success] Downloaded ZIP folder!`, "success");
    } catch (err) {
      console.error(err);
      logMsg(`[Error] Failed to zip: ${err.message}`, "error");
    }
  };

  const handleDownload = async () => {
    if (!project || !project.svg_url) return;
    logMsg(`[Export] Downloading SVG...`);
    forceDownload(project.svg_url, `DesaynClaw_${project.name}_Vector.svg`);
  };

  const forceDownload = async (url, filename) => {
    try {
      // Direct fetch using native CORS (Cloudflare R2 must have CORS configured)
      const response = await fetch(url);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(objectUrl);
    } catch (error) {
      console.error("Failed to download directly, falling back to new tab:", error);
      window.open(url, "_blank");
    }
  };

  // --- PAN / ZOOM HANDLERS ---
  const handleWheel = (e) => {
    if (showCropModal) return;
    
    const container = e.currentTarget;
    const rect = container.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    const delta = e.deltaY * -0.001;
    
    setTransform(prev => {
      const newScale = Math.min(Math.max(0.1, prev.scale + delta), 3);
      
      const unscaledX = (mouseX - prev.x) / prev.scale;
      const unscaledY = (mouseY - prev.y) / prev.scale;
      
      const newX = mouseX - unscaledX * newScale;
      const newY = mouseY - unscaledY * newScale;
      
      return { x: newX, y: newY, scale: newScale };
    });
  };

  // Pan with middle mouse, OR left mouse if Hand tool is active
  const handlePointerDown = (e) => {
    if (e.button === 1 || (e.button === 0 && activeTool === "hand")) {
      e.preventDefault();
      isDragging.current = true;
      dragStart.current = { x: e.clientX - transform.x, y: e.clientY - transform.y };
    }

    if (e.button === 0 && activeTool === "zoom") {
      e.preventDefault();
      const container = e.currentTarget;
      const rect = container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      
      const delta = 0.3;
      setTransform(prev => {
        const newScale = Math.min(prev.scale + delta, 3);
        const unscaledX = (mouseX - prev.x) / prev.scale;
        const unscaledY = (mouseY - prev.y) / prev.scale;
        const newX = mouseX - unscaledX * newScale;
        const newY = mouseY - unscaledY * newScale;
        return { x: newX, y: newY, scale: newScale };
      });
    }
  };

  const handlePointerMove = (e) => {
    if (!isDragging.current) return;
    setTransform((prev) => ({
      ...prev,
      x: e.clientX - dragStart.current.x,
      y: e.clientY - dragStart.current.y
    }));
  };

  const handlePointerUp = (e) => {
    if (e.button === 1 || e.button === 0) {
      isDragging.current = false;
    }
  };

  return (
    <div className="app-container">
      {/* Top Menu Bar */}
      <div className="menu-bar">
        <div className="menu-item" onClick={() => router.push('/')} style={{cursor: 'pointer'}}>
          <Home size={12} style={{marginRight: 4, display: 'inline-block'}} /> Home
        </div>
        <div className="brand-title">
          <img src="/logo_full.png" alt="DESAYNBRO" style={{height: 12}} />
          DESAYNCLAW WORKSPACE
        </div>
      </div>

      {/* Control Bar */}
      <div className="control-bar">
        <div className="mode-tabs">
          <div 
            className={`mode-tab ${activeMode === "pattern" ? "active" : ""}`}
            onClick={() => setActiveMode("pattern")}
          >
            <Shirt size={14} /> Pattern Extractor
          </div>
        </div>
      </div>

      <main className="main-workspace">
        
        <div className="toolbar-vertical">
          <div className={`tool-icon ${activeTool === "pointer" ? "active" : ""}`} onClick={() => setActiveTool("pointer")}>
            <MousePointer2 size={16} />
          </div>
          <div className={`tool-icon ${activeTool === "hand" ? "active" : ""}`} onClick={() => setActiveTool("hand")}>
            <Hand size={16} />
          </div>
          <div className={`tool-icon ${activeTool === "zoom" ? "active" : ""}`} onClick={() => setActiveTool("zoom")}>
            <ZoomIn size={16} />
          </div>
          <div className={`tool-icon ${activeTool === "crop" ? "active" : ""}`} onClick={() => { setActiveTool("crop"); setShowCropModal(true); }}>
            <Crop size={16} />
          </div>
        </div>

        {/* Canvas Area */}
        <div 
          className="canvas-area"
          onWheel={handleWheel}
          onMouseDown={handlePointerDown}
          onMouseMove={handlePointerMove}
          onMouseUp={handlePointerUp}
          onMouseLeave={handlePointerUp}
          style={{ 
            cursor: isDragging.current ? 'grabbing' 
                  : activeTool === 'hand' ? 'grab' 
                  : activeTool === 'zoom' ? 'zoom-in' 
                  : activeTool === 'crop' ? 'crosshair'
                  : 'default' 
          }}
        >
          <div className="document-tab">
            {project ? project.name : "Loading..."} {project && project.svg_url ? "(3-Stage Pipeline)" : "(Design)"}
          </div>

          {!project ? (
            <div className="empty-state">
              <h3>Loading Document...</h3>
            </div>
          ) : (
            <div 
              className="pipeline-container"
              style={{
                transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
                transformOrigin: '0 0'
              }}
            >
              
              {/* NODE 1: Reference */}
              <div className="node-card">
                <div className="node-header" style={{ justifyContent: 'space-between' }}>
                  <div className="node-header-title">
                    <ImageIcon size={12}/> Image Reference
                  </div>
                  <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                    {traceState === "idle" && (
                      <button 
                        className="icon-btn-small" 
                        onClick={() => setShowCropModal(true)} 
                        title="Crop Region"
                      >
                        <Scissors size={12} />
                      </button>
                    )}
                  </div>
                </div>
                <div className="node-content checkerboard" style={{ position: 'relative' }}>
                  {project.original_image_url ? (
                    <img src={`/api/proxy?url=${encodeURIComponent(project.original_image_url)}`} alt="Reference" style={{width: '100%', height: '100%', objectFit: 'contain'}} referrerPolicy="no-referrer" />
                  ) : (
                    <div className="placeholder-node">Image not found</div>
                  )}
                </div>
                <div className="node-footer">
                  <span>Model Details ∨</span>
                </div>
                <div className="node-port output"></div>
              </div>

              {/* CONNECTOR 1 */}
              <div className={`node-connector ${traceState === 'step1' ? 'active' : ''}`}></div>

              {/* NODE 2: Gemini Direct Image Generation */}
              <div className={`node-card ${!project.generated_image_url && traceState === 'idle' ? 'dimmed' : ''}`}>
                <div className="node-port input"></div>
                <div className="node-header">
                  <div className="node-header-title"><Brain size={12}/> DesaynVision™ Neural Extractor v3.0</div>
                  <MoreHorizontal size={14} style={{ color: '#52525b', cursor: 'pointer' }} />
                </div>
                <div className="node-content checkerboard" style={{ position: 'relative' }}>
                  {traceState === "step1" && (
                    <div className="node-loading-overlay">
                      <div className="node-spinner"></div>
                      <span>Generating Image...</span>
                    </div>
                  )}
                  {project.generated_image_url ? (
                    <img src={`/api/proxy?url=${encodeURIComponent(project.generated_image_url)}`} alt="Generated Raster" style={{width: '100%', height: '100%', objectFit: 'contain'}} referrerPolicy="no-referrer" />
                  ) : (
                    <div className="placeholder-node">Awaiting Execution</div>
                  )}
                </div>
                <div className="node-footer">
                  <span>Model Details ∨</span>
                </div>
                <div className="node-port output"></div>
              </div>

              {/* CONNECTOR 2 */}
              <div className={`node-connector ${traceState === 'step2' ? 'active' : ''}`}></div>

              {/* NODE 3: Upscaled Raster */}
              <div className={`node-card ${!project.upscaled_image_url && traceState !== 'step2' ? 'dimmed' : ''}`}>
                <div className="node-port input"></div>
                <div className="node-header">
                  <div className="node-header-title"><Scan size={12}/> ClawScale™ Ultra-Res Matrix</div>
                  <MoreHorizontal size={14} style={{ color: '#52525b', cursor: 'pointer' }} />
                </div>
                <div className="node-content checkerboard" style={{ position: 'relative' }}>
                  {traceState === "step2" && (
                    <div className="node-loading-overlay">
                      <div className="node-spinner"></div>
                      <span>Upscaling Image...</span>
                    </div>
                  )}
                  {project.upscaled_image_url ? (
                    <img src={`/api/proxy?url=${encodeURIComponent(project.upscaled_image_url)}`} alt="Upscaled Raster" style={{width: '100%', height: '100%', objectFit: 'contain'}} referrerPolicy="no-referrer" />
                  ) : (
                    <div className="placeholder-node">Awaiting Execution</div>
                  )}
                </div>
                <div className="node-footer">
                  <span>Model Details ∨</span>
                </div>
                <div className="node-port output"></div>
              </div>

              {/* CONNECTOR 3 */}
              <div className={`node-connector ${traceState === 'step3' ? 'active' : ''}`}></div>

              {/* NODE 4: Vectorized SVG */}
              <div className={`node-card ${!project.svg_url && traceState !== 'step3' ? 'dimmed' : ''}`}>
                <div className="node-port input"></div>
                <div className="node-header">
                  <div className="node-header-title"><PenTool size={12}/> TrueVector™ Auto-Bezier Core</div>
                  <MoreHorizontal size={14} style={{ color: '#52525b', cursor: 'pointer' }} />
                </div>
                <div className="node-content checkerboard" style={{ position: 'relative' }}>
                  {traceState === "step3" && (
                    <div className="node-loading-overlay">
                      <div className="node-spinner"></div>
                      <span>Converting to Vector...</span>
                    </div>
                  )}
                  {project.svg_url ? (
                    <img src={`/api/proxy?url=${encodeURIComponent(project.svg_url)}`} alt="Vector" style={{width: '100%', height: '100%', objectFit: 'contain'}} referrerPolicy="no-referrer" />
                  ) : (
                    <div className="placeholder-node">Awaiting Execution</div>
                  )}
                </div>
                <div className="node-footer">
                  <span>Model Details ∨</span>
                </div>
              </div>

            </div>
          )}
        </div>

        {/* Right Properties Panel */}
        <aside className="properties-panel">
          
          <div className="panel-section">
            <div className="section-header">
              <span>PROPERTIES</span>
              <Settings2 size={12} />
            </div>
            <div className="section-content">
              <div className="form-group">
                <label className="form-label" style={{ color: '#4ade80' }}>● AI Auto-Trace Active</label>
                <div style={{ color: '#888', fontSize: '11px', lineHeight: 1.4, marginTop: '4px' }}>
                  DesaynClaw uses a 3-stage AI pipeline to automatically extract, upscale, and vectorize the design. No manual parameter tuning is required.
                </div>
              </div>
            </div>
          </div>

          <div className="panel-section">
            <div className="section-header">
              <span>ACTIONS</span>
              <ChevronDown size={12} />
            </div>
            <div className="section-content">
              <div style={{ background: '#331c00', border: '1px solid #FFD700', borderRadius: '4px', padding: '10px', marginBottom: '12px', fontSize: '11px', color: '#FFD700', display: 'flex', gap: '8px' }}>
                <span>⚠️</span>
                <span><strong>CRITICAL:</strong> If your image shows BOTH the front and back of a shirt, you MUST use the Crop Tool (✂️) to select ONLY ONE SIDE before tracing, or the AI will fail.</span>
              </div>

              {!project?.svg_url && (
                <button 
                  className="btn-primary" 
                  style={{ 
                    width: '100%', 
                    background: (userCredits !== null && userCredits <= 0) ? '#444' : 'linear-gradient(90deg, #FFD700, #FFA500)', 
                    color: (userCredits !== null && userCredits <= 0) ? '#888' : '#000',
                    border: 'none',
                    cursor: (userCredits !== null && userCredits <= 0) ? 'not-allowed' : (traceState !== "idle" ? 'not-allowed' : 'pointer'),
                    opacity: traceState !== "idle" ? 0.7 : 1
                  }} 
                  onClick={handleExecuteTrace}
                  disabled={traceState !== "idle"}
                >
                  {traceState !== "idle" ? "Processing..." : (
                    (userCredits !== null && userCredits <= 0) ? "No Credits Remaining" : "Run Auto-Trace (-1 Credit)"
                  )}
                </button>
              )}

              <button 
                className="btn-primary" 
                onClick={handleDownload}
                disabled={!project || !project.svg_url}
                style={{ marginBottom: '8px', marginTop: '8px' }}
              >
                <Download size={14} /> EXPORT AS SVG
              </button>

              <button 
                className="btn-primary" 
                onClick={handleDownloadAll}
                disabled={!project || !project.original_image_url}
                style={{ marginBottom: '8px', backgroundColor: '#333', color: '#fff', border: '1px solid #555' }}
              >
                <FolderDown size={14} /> DOWNLOAD ALL (ZIP)
              </button>
              
              <button 
                className="btn-primary" 
                onClick={() => setShowCompare(true)}
                disabled={!project || !project.svg_url}
                style={{ backgroundColor: '#2a2a2a', color: '#ddd', border: '1px solid #444' }}
              >
                <Monitor size={14} /> BEFORE/AFTER COMPARE
              </button>
            </div>
          </div>

          <div className="console-area">
            {consoleLogs.map((log, i) => (
              <div key={i} className={`console-msg ${log.type === "success" ? "success" : ""}`}>
                {log.text}
              </div>
            ))}
          </div>
        </aside>
      </main>

      {/* Cropper Modal */}
      {showCropModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '800px', width: '90%', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
            <h3 style={{ marginBottom: '15px' }}><Scissors size={18} style={{ verticalAlign: 'text-bottom', marginRight: '8px' }} /> Please crop the area to trace (e.g., Front only or Back only)</h3>
            <div style={{ flex: 1, overflow: 'auto', backgroundColor: '#0f0f0f', border: '1px solid #2a2a2a', borderRadius: '8px', display: 'flex', justifyContent: 'center', padding: '20px' }}>
              <ReactCrop crop={crop} onChange={c => { setCrop(c); setCropError(""); }} onComplete={c => setCompletedCrop(c)}>
                <img 
                  ref={imgRef} 
                  src={`/api/proxy-image?url=${encodeURIComponent(project.original_image_url)}`} 
                  alt="Crop source" 
                  style={{ maxHeight: '50vh', width: 'auto' }}
                  crossOrigin="anonymous"
                  onLoad={(e) => {
                    imgRef.current = e.currentTarget;
                  }}
                />
              </ReactCrop>
            </div>
            {cropError && <div style={{ color: '#ff4444', fontSize: '13px', marginTop: '12px', textAlign: 'center', fontWeight: 'bold' }}>{cropError}</div>}
            <div className="modal-actions" style={{ marginTop: '20px' }}>
              {project?.generated_image_url && (
                <button className="btn-secondary" onClick={() => setShowCropModal(false)}>Cancel</button>
              )}
              <button className="btn-primary" onClick={generateCrop}>Apply Crop</button>
            </div>
          </div>
        </div>
      )}

      {/* Compare Modal — fixed alignment slider */}
      {showCompare && project && (
        <div className="modal-overlay" 
          onMouseMove={(e) => {
            if (!isDraggingCompare.current) return;
            const container = document.getElementById('compare-container');
            if (!container) return;
            const rect = container.getBoundingClientRect();
            let newPos = ((e.clientX - rect.left) / rect.width) * 100;
            newPos = Math.max(0, Math.min(100, newPos));
            
            // DIRECT DOM MANIPULATION TO PREVENT MASSIVE LAG
            const overlayImg = document.getElementById('compare-overlay-img');
            const sliderLine = document.getElementById('compare-slider-line');
            if (overlayImg) overlayImg.style.clipPath = `inset(0 ${100 - newPos}% 0 0)`;
            if (sliderLine) sliderLine.style.left = `${newPos}%`;
          }}
          onMouseUp={() => isDraggingCompare.current = false}
          onMouseLeave={() => isDraggingCompare.current = false}
        >
          <div className="modal-content" style={{ maxWidth: '820px', width: '95%', padding: '0', overflow: 'hidden' }}>
            {/* Header */}
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #2a2a2a', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <CheckCircle size={18} color="#FFD700" />
                <span style={{ fontWeight: '700', fontSize: '15px', color: '#fff' }}>Generation Complete!</span>
                <span style={{ color: '#666', fontSize: '12px', marginLeft: '10px' }}>Drag slider to compare</span>
              </div>
              <button className="icon-btn-small" onClick={() => setShowCompare(false)}><X size={16} /></button>
            </div>

            {/* Slider Compare Area */}
            <div
              id="compare-container"
              style={{
                position: 'relative',
                width: '100%',
                height: '500px',
                overflow: 'hidden',
                cursor: 'ew-resize',
                userSelect: 'none',
                background: 'repeating-conic-gradient(#1e1e1e 0% 25%, #141414 0% 50%) 0 0 / 20px 20px'
              }}
              onMouseDown={(e) => {
                isDraggingCompare.current = true;
                const rect = e.currentTarget.getBoundingClientRect();
                setSliderPosition(((e.clientX - rect.left) / rect.width) * 100);
              }}
            >
              {/* AFTER layer — full container, image contained */}
              <img
                draggable={false}
                src={project.svg_url}
                alt="Vector"
                style={{
                  position: 'absolute', top: 0, left: 0,
                  width: '100%', height: '100%',
                  objectFit: 'contain',
                  pointerEvents: 'none'
                }}
              />

              {/* BEFORE layer — same size, clipped from LEFT to sliderPosition */}
              <div 
                id="compare-overlay-img"
                style={{
                  position: 'absolute', top: 0, left: 0,
                  width: '100%', height: '100%',
                  clipPath: `inset(0 50% 0 0)`,
                  background: 'repeating-conic-gradient(#1e1e1e 0% 25%, #141414 0% 50%) 0 0 / 20px 20px',
                  willChange: 'clip-path',
                  transform: 'translateZ(0)'
                }}>
                <img
                  draggable={false}
                  src={project.original_image_url}
                  alt="Original"
                  style={{
                    width: '100%', height: '100%',
                    objectFit: 'contain',
                    pointerEvents: 'none'
                  }}
                />
              </div>

              {/* Slider Line */}
              <div 
                id="compare-slider-line"
                style={{
                  position: 'absolute', top: 0, bottom: 0,
                  left: `50%`,
                  width: '3px',
                  background: '#FFD700',
                  transform: 'translateX(-50%) translateZ(0)',
                  pointerEvents: 'none',
                  willChange: 'left'
                }}>
                {/* Handle */}
                <div style={{
                  position: 'absolute', top: '50%', left: '50%',
                  transform: 'translate(-50%, -50%)',
                  width: '36px', height: '36px',
                  background: '#FFD700', borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: '0 0 12px rgba(255,215,0,0.5)', gap: '1px'
                }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="3"><path d="M15 18l-6-6 6-6"/></svg>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="3"><path d="M9 18l6-6-6-6"/></svg>
                </div>
              </div>

              {/* Labels */}
              <div style={{ position: 'absolute', bottom: '14px', left: '14px', background: 'rgba(0,0,0,0.75)', padding: '4px 10px', borderRadius: '4px', color: '#fff', fontSize: '11px', pointerEvents: 'none', letterSpacing: '0.5px' }}>ORIGINAL (BEFORE)</div>
              <div style={{ position: 'absolute', bottom: '14px', right: '14px', background: 'rgba(0,0,0,0.75)', padding: '4px 10px', borderRadius: '4px', color: '#FFD700', fontSize: '11px', pointerEvents: 'none', letterSpacing: '0.5px' }}>VECTOR (AFTER)</div>
            </div>

            {/* Download actions */}
            <div style={{ padding: '14px 20px', borderTop: '1px solid #2a2a2a', display: 'flex', gap: '10px' }}>
              <button
                onClick={() => { handleDownloadAll(); setShowCompare(false); }}
                style={{ flex: 1, padding: '12px', background: '#FFD700', color: '#000', border: 'none', borderRadius: '6px', fontWeight: '800', fontSize: '13px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', transition: 'opacity 0.2s' }}
                onMouseOver={e => e.target.style.opacity = '0.9'}
                onMouseOut={e => e.target.style.opacity = '1'}
              >
                <FolderDown size={15} /> Download All (ZIP)
              </button>
              <button
                onClick={() => { handleDownload(); }}
                style={{ flex: 1, padding: '12px', background: '#111', color: '#FFD700', border: '1px solid #FFD700', borderRadius: '6px', fontWeight: '800', fontSize: '13px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', transition: 'background 0.2s' }}
                onMouseOver={e => e.target.style.background = '#1a1a1a'}
                onMouseOut={e => e.target.style.background = '#111'}
              >
                <Download size={15} /> SVG Only
              </button>
              <button
                onClick={() => setShowCompare(false)}
                style={{ padding: '11px 16px', background: 'transparent', color: '#666', border: '1px solid #333', borderRadius: '8px', cursor: 'pointer', fontSize: '13px' }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* No Credits Modal */}
      {showNoCreditsModal && (
        <div className="modal-overlay" onClick={() => setShowNoCreditsModal(false)}>
          <div className="modal-content" style={{ maxWidth: '400px', textAlign: 'center', padding: '30px' }} onClick={e => e.stopPropagation()}>
            <div style={{ marginBottom: '16px', display: 'flex', justifyContent: 'center' }}>
              <CreditCard size={48} color="#FFD700" strokeWidth={1.5} />
            </div>
            <h3 style={{ margin: '0 0 10px', color: '#fff', fontWeight: '700', fontSize: '20px' }}>0 Traces Remaining</h3>
            <p style={{ color: '#aaa', fontSize: '14px', marginBottom: '24px', lineHeight: 1.5 }}>
              You don't have enough credits to run this generation. Please top up your account to continue.
            </p>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button 
                onClick={() => setShowNoCreditsModal(false)}
                style={{ flex: 1, padding: '12px', background: 'transparent', color: '#888', border: '1px solid #333', borderRadius: '8px', cursor: 'pointer', fontWeight: '600' }}
              >
                Close
              </button>
              <button 
                onClick={() => { setShowNoCreditsModal(false); setShowTopUpModal(true); }}
                style={{ flex: 1, padding: '12px', background: '#FFD700', color: '#000', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '800', fontSize: '13px', transition: 'opacity 0.2s' }}
                onMouseOver={e => e.target.style.opacity = '0.9'}
                onMouseOut={e => e.target.style.opacity = '1'}
              >
                Top Up Now
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== TOP UP MODAL (Same as Homepage) ===== */}
      {showTopUpModal && (
        <div className="modal-overlay" onClick={() => { setShowTopUpModal(false); setTopUpStep(1); setTopUpSubmitted(false); }}>
          <div className="modal-content" style={{ maxWidth: '800px', width: '100%', padding: '0', overflow: 'hidden' }} onClick={(e) => e.stopPropagation()}>
            {/* Modal Header */}
            <div style={{ background: 'linear-gradient(135deg, #111, #1a1a1a)', borderBottom: '1px solid #2a2a2a', padding: '20px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Shirt size={18} color="#FFD700" />
                <span style={{ fontWeight: '700', fontSize: '15px', color: '#fff' }}>Get More Traces</span>
              </div>
              {!topUpSubmitted && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {[1, 2].map(s => (
                    <div key={s} style={{ width: '24px', height: '24px', borderRadius: '50%', background: topUpStep >= s ? '#FFD700' : '#333', border: topUpStep >= s ? 'none' : '1px solid #555', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: '700', color: topUpStep >= s ? '#000' : '#666', transition: 'all 0.2s' }}>{s}</div>
                  ))}
                </div>
              )}
              <button onClick={() => { setShowTopUpModal(false); setTopUpStep(1); setTopUpSubmitted(false); }} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', padding: '4px' }}><X size={16} /></button>
            </div>
            <div style={{ padding: '24px' }}>
              {/* SUBMITTED */}
              {topUpSubmitted ? (
                <div style={{ textAlign: 'center', padding: '20px 0' }}>
                  <div style={{ marginBottom: '12px', display: 'flex', justifyContent: 'center' }}>
                    <CheckCircle size={48} color="#4ade80" strokeWidth={1.5} />
                  </div>
                  <h3 style={{ margin: '0 0 8px', color: '#4ade80', fontWeight: '700' }}>Request Submitted!</h3>
                  <p style={{ color: '#888', fontSize: '13px', margin: '0 0 8px' }}>Natanggap namin ang iyong payment request.</p>
                  <div style={{ background: '#111', border: '1px solid #2a2a2a', borderRadius: '8px', padding: '14px', margin: '16px 0', textAlign: 'left' }}>
                    <p style={{ margin: '0 0 8px', color: '#aaa', fontSize: '12px', display: 'flex', alignItems: 'center' }}><Package size={14} style={{ marginRight: '6px', color: '#888' }} /> Package: <strong style={{ color: '#FFD700', marginLeft: '6px' }}>{topUpForm.plan === 'starter' ? '10 Credits — ₱350' : topUpForm.plan === 'pro' ? '30 Credits — ₱900' : '100 Credits — ₱2,800'}</strong></p>
                    <p style={{ margin: '0 0 8px', color: '#aaa', fontSize: '12px', display: 'flex', alignItems: 'center' }}><Tag size={14} style={{ marginRight: '6px', color: '#888' }} /> Ref No: <strong style={{ color: '#fff', marginLeft: '6px' }}>{topUpForm.txnRef || '—'}</strong></p>
                    <p style={{ margin: 0, color: '#aaa', fontSize: '12px', display: 'flex', alignItems: 'center' }}><Mail size={14} style={{ marginRight: '6px', color: '#888' }} /> Account: <strong style={{ color: '#fff', marginLeft: '6px' }}>{user?.email}</strong></p>
                  </div>
                  <p style={{ color: '#666', fontSize: '12px', margin: '0 0 20px' }}>Credits will be added within <strong style={{ color: '#4ade80' }}>10–30 minutes</strong>. Salamat! 🙏</p>
                  <button onClick={() => { setShowTopUpModal(false); setTopUpStep(1); setTopUpSubmitted(false); }} style={{ width: '100%', padding: '12px', background: '#222', color: '#fff', border: '1px solid #444', borderRadius: '8px', cursor: 'pointer', fontWeight: '600', fontSize: '13px' }}>Close</button>
                </div>
              ) : topUpStep === 1 ? (
                /* STEP 1 */
                <>
                  <p style={{ margin: '0 0 16px', color: '#888', fontSize: '12px' }}>Piliin ang package na gusto mo:</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '20px' }}>
                    {[
                      { key: 'starter', label: 'Starter', traces: 10, price: '₱350', desc: 'Para sa paminsan-minsang paggamit' },
                      { key: 'pro',     label: 'Pro',     traces: 30, price: '₱900', desc: 'Best value · Pinaka-popular', best: true },
                      { key: 'studio',  label: 'Studio',  traces: 100, price: '₱2,800', desc: 'Para sa madalas na gumagamit' },
                    ].map(p => (
                      <div 
                        key={p.key} 
                        onClick={() => setTopUpForm(f => ({ ...f, plan: p.key }))} 
                        style={{ 
                          background: topUpForm.plan === p.key ? '#1a1a1a' : '#0a0a0a', 
                          border: `1px solid ${topUpForm.plan === p.key ? '#FFD700' : '#222'}`, 
                          borderRadius: '12px', padding: '18px 20px', cursor: 'pointer', 
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between', 
                          transition: 'all 0.2s ease', position: 'relative',
                          boxShadow: topUpForm.plan === p.key ? '0 0 20px rgba(255,215,0,0.08)' : 'none'
                        }}
                      >
                        {p.best && <div style={{ position: 'absolute', top: '-10px', right: '20px', background: '#FFD700', color: '#000', fontSize: '10px', fontWeight: '800', padding: '4px 10px', borderRadius: '12px', letterSpacing: '0.5px' }}>POPULAR</div>}
                        
                        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                          <div style={{ width: '18px', height: '18px', borderRadius: '50%', border: `2px solid ${topUpForm.plan === p.key ? '#FFD700' : '#444'}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            {topUpForm.plan === p.key && <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#FFD700' }} />}
                          </div>
                          <div>
                            <div style={{ fontWeight: '800', fontSize: '18px', color: '#fff', display: 'flex', alignItems: 'center', gap: '6px' }}>
                              {p.traces} <span style={{ color: topUpForm.plan === p.key ? '#FFD700' : '#888', fontWeight: '600', fontSize: '15px' }}>Credits</span>
                            </div>
                            <div style={{ color: '#666', fontSize: '12px', marginTop: '2px' }}>{p.label} Plan</div>
                          </div>
                        </div>

                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: '20px', fontWeight: '800', color: topUpForm.plan === p.key ? '#FFD700' : '#fff' }}>{p.price}</div>
                          <div style={{ display: 'inline-block', background: '#222', color: '#aaa', fontSize: '10px', padding: '3px 8px', borderRadius: '6px', marginTop: '4px', fontWeight: '600' }}>
                            ₱{(parseInt(p.price.replace(/[^0-9]/g,'')) / p.traces).toFixed(0)} / credit
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <button onClick={() => setTopUpStep(2)} style={{ width: '100%', padding: '14px', background: '#FFD700', color: '#000', border: 'none', borderRadius: '6px', fontWeight: '800', fontSize: '14px', cursor: 'pointer', transition: 'opacity 0.2s' }} onMouseOver={e => e.target.style.opacity = '0.9'} onMouseOut={e => e.target.style.opacity = '1'}>Continue to Payment →</button>
                </>
              ) : (
                /* STEP 2 */
                <>
                  <div style={{ background: '#111', border: '1px solid #2a2a2a', borderRadius: '8px', padding: '10px 14px', marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: '#aaa', fontSize: '12px' }}>Selected: <strong style={{ color: '#fff' }}>{topUpForm.plan === 'starter' ? 'Starter — 10 Credits' : topUpForm.plan === 'pro' ? 'Pro — 30 Credits' : 'Studio — 100 Credits'}</strong></span>
                    <span style={{ color: '#FFD700', fontWeight: '800', fontSize: '16px' }}>{topUpForm.plan === 'starter' ? '₱350' : topUpForm.plan === 'pro' ? '₱900' : '₱2,800'}</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '30px', marginBottom: '24px', alignItems: 'start' }}>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ background: '#fff', borderRadius: '16px', padding: '16px', display: 'inline-block', marginBottom: '12px', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
                        <img src="/gcash_qr.png" alt="GCash QR" style={{ width: '100%', maxWidth: '280px', height: 'auto', objectFit: 'contain', display: 'block' }} />
                      </div>
                      <p style={{ color: '#60a5fa', fontSize: '14px', margin: '0 0 6px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Smartphone size={18} style={{ marginRight: '6px' }} /> Scan with GCash</p>
                      <p style={{ color: '#aaa', fontSize: '13px', margin: 0 }}>LL**D D. · +63 948 562 ••••</p>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', paddingTop: '12px' }}>
                      <div>
                        <label style={{ display: 'block', color: '#aaa', fontSize: '13px', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>GCash Ref. Number *</label>
                        <input type="text" placeholder="e.g. 1234567890" value={topUpForm.txnRef} onChange={e => setTopUpForm(f => ({ ...f, txnRef: e.target.value }))} style={{ width: '100%', background: '#111', border: '1px solid #333', borderRadius: '8px', padding: '16px', color: '#fff', fontSize: '16px', outline: 'none', boxSizing: 'border-box' }} onFocus={e => e.target.style.borderColor = '#FFD700'} onBlur={e => e.target.style.borderColor = '#333'} />
                      </div>
                      <div>
                        <label style={{ display: 'block', color: '#aaa', fontSize: '13px', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Upload Proof of Payment *</label>
                        <input type="file" accept="image/*" onChange={e => { if (e.target.files[0]) setTopUpForm(f => ({ ...f, screenshotName: e.target.files[0].name, screenshotFile: e.target.files[0] })) }} style={{ display: 'none' }} id="proof-upload" />
                        <label htmlFor="proof-upload" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', background: '#111', border: '1px dashed #444', borderRadius: '8px', padding: '14px 16px', color: topUpForm.screenshotName ? '#4ade80' : '#888', fontSize: '15px', cursor: 'pointer', boxSizing: 'border-box', transition: 'all 0.2s' }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><ImageIcon size={18} /> {topUpForm.screenshotName || 'Select screenshot...'}</span>
                          <span style={{ fontSize: '12px', background: '#333', color: '#fff', padding: '6px 10px', borderRadius: '4px' }}>Browse</span>
                        </label>
                      </div>
                      <div>
                        <label style={{ display: 'block', color: '#888', fontSize: '13px', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Your Email (auto-filled)</label>
                        <input type="text" value={user?.email || ''} readOnly style={{ width: '100%', background: '#0a0a0a', border: '1px solid #222', borderRadius: '8px', padding: '16px', color: '#666', fontSize: '16px', outline: 'none', boxSizing: 'border-box', cursor: 'not-allowed' }} />
                      </div>
                      <p style={{ margin: '12px 0 0', color: '#aaa', fontSize: '13px', lineHeight: 1.6 }}>After paying, fill in the reference number, attach your screenshot above and submit. Credits arrive within <strong style={{ color: '#4ade80' }}>10–30 minutes</strong>.</p>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '16px' }}>
                    <button onClick={() => setTopUpStep(1)} disabled={isSubmittingTopUp} style={{ padding: '16px 24px', background: 'transparent', color: '#888', border: '1px solid #333', borderRadius: '8px', cursor: isSubmittingTopUp ? 'not-allowed' : 'pointer', fontSize: '16px', fontWeight: '600' }}>← Back</button>
                    <button 
                      onClick={async () => { 
                        if (!topUpForm.txnRef.trim() || !topUpForm.screenshotFile) { alert('Please enter your GCash reference number and upload proof of payment.'); return; } 
                        if (!user) { alert('You must be logged in.'); return; }
                        
                        setIsSubmittingTopUp(true);
                        try {
                          // 1. Upload to Supabase Storage
                          const fileExt = topUpForm.screenshotFile.name.split('.').pop();
                          const fileName = `proof_${user.id}_${Date.now()}.${fileExt}`;
                          
                          const { error: uploadError } = await supabase.storage
                            .from('payment_proofs')
                            .upload(fileName, topUpForm.screenshotFile);
                            
                          if (uploadError) throw uploadError;
                          
                          const proofUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/payment_proofs/${fileName}`;
                          
                          // 2. Insert into payment_requests table
                          const { error: dbError } = await supabase
                            .from('payment_requests')
                            .insert({
                              user_id: user.id,
                              email: user.email,
                              plan: topUpForm.plan,
                              reference_number: topUpForm.txnRef,
                              proof_url: proofUrl
                            });
                            
                          if (dbError) throw dbError;
                          
                          setTopUpSubmitted(true);
                        } catch (error) {
                          console.error("Payment Submission Error:", error);
                          alert("Failed to submit payment request: " + error.message);
                        } finally {
                          setIsSubmittingTopUp(false);
                        }
                      }} 
                      disabled={isSubmittingTopUp}
                      style={{ flex: 1, padding: '16px', background: (topUpForm.txnRef.trim() && topUpForm.screenshotFile) ? 'linear-gradient(90deg, #4ade80, #22d3ee)' : '#222', color: (topUpForm.txnRef.trim() && topUpForm.screenshotFile) ? '#000' : '#555', border: 'none', borderRadius: '8px', fontWeight: '800', fontSize: '16px', cursor: (topUpForm.txnRef.trim() && topUpForm.screenshotFile && !isSubmittingTopUp) ? 'pointer' : 'not-allowed', transition: 'all 0.2s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                        {isSubmittingTopUp ? 'Uploading...' : <><Check size={20} /> Submit Payment Request</>}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
