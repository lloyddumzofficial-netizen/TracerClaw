"use client";

import { useState, useRef } from "react";
import { 
  MousePointer2, Hand, ZoomIn, Crop, Shirt, Scan, 
  Settings2, ChevronDown, ChevronUp, Download, Play
} from "lucide-react";
import "./globals.css";

export default function Home() {
  const [activeMode, setActiveMode] = useState("pattern");
  const [activeTool, setActiveTool] = useState("pointer");
  
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [isTracing, setIsTracing] = useState(false);
  const [svgResult, setSvgResult] = useState(null);
  const [consoleLogs, setConsoleLogs] = useState(["[System] TRACECRAFT V1.0 Initialized.", "[System] Ready."]);
  
  const fileInputRef = useRef(null);

  const logMsg = (msg, type = "normal") => {
    setConsoleLogs(prev => [...prev, { text: msg, type }]);
  };

  const handleFileChange = (e) => {
    const selected = e.target.files[0];
    if (selected && selected.type.startsWith("image/")) {
      setFile(selected);
      setPreviewUrl(URL.createObjectURL(selected));
      setSvgResult(null);
      logMsg(`[File] Loaded ${selected.name}`);
    }
  };

  const handleDragOver = (e) => e.preventDefault();
  const handleDrop = (e) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const dropped = e.dataTransfer.files[0];
      if (dropped.type.startsWith("image/")) {
        setFile(dropped);
        setPreviewUrl(URL.createObjectURL(dropped));
        setSvgResult(null);
        logMsg(`[File] Loaded ${dropped.name}`);
      }
    }
  };

  const handleTrace = async () => {
    if (!file) return;
    setIsTracing(true);
    logMsg(`[Process] Sending to Gemini 3.1 Pro...`);
    setSvgResult(null); // Clear previous result
    
    try {
      const formData = new FormData();
      formData.append("image", file);
      
      const response = await fetch("/api/trace", {
        method: "POST",
        body: formData,
      });
      
      const contentType = response.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.details || data.error || "Failed to trace image");
        }
        
        logMsg(`[Gemini] Generated Prompt: ${data.prompt.substring(0, 50)}...`, "normal");
        logMsg(`[Recraft] Vector generation complete.`, "success");
        
        setSvgResult({
          prompt: data.prompt,
          url: data.imageUrl
        });
      } else {
        const textError = await response.text();
        throw new Error(`Server returned non-JSON error (Status ${response.status}). The image might be too large or there's a server crash.`);
      }
    } catch (err) {
      logMsg(`[Error] ${err.message}`, "error");
    } finally {
      setIsTracing(false);
    }
  };

  const handleDownload = async () => {
    if (!svgResult || !svgResult.url) return;
    logMsg(`[Export] Fetching image...`);
    try {
      const res = await fetch(svgResult.url);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = activeMode === "pattern" ? "extracted_pattern.png" : "traced_logo.png";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      logMsg(`[Export] Saved ${a.download}`);
    } catch (err) {
      logMsg(`[Error] Failed to download: ${err.message}`, "error");
    }
  };

  return (
    <div className="app-container">
      {/* Top Menu Bar */}
      <div className="menu-bar">
        <div className="menu-item">File</div>
        <div className="menu-item">Edit</div>
        <div className="menu-item">View</div>
        <div className="menu-item">Trace</div>
        <div className="menu-item">Help</div>
        <div className="brand-title">
          <img src="/logo_full.png" alt="DESAYNBRO" style={{height: 12}} />
          TRACECRAFT WORKSPACE
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
          <div 
            className={`mode-tab ${activeMode === "logo" ? "active" : ""}`}
            onClick={() => setActiveMode("logo")}
          >
            <Scan size={14} /> Logo Vectorizer
          </div>
        </div>
      </div>

      <main className="main-workspace">
        
        {/* Vertical Toolbar */}
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
          <div className={`tool-icon ${activeTool === "crop" ? "active" : ""}`} onClick={() => setActiveTool("crop")}>
            <Crop size={16} />
          </div>
        </div>

        {/* Canvas Area */}
        <div className="canvas-area">
          <div className="document-tab">
            {file ? file.name : "Untitled-1"} {svgResult ? "(Vector)" : "(Raster)"}
          </div>

          <div 
            className={`artboard ${previewUrl ? "checkerboard" : ""}`}
            style={{ width: previewUrl ? 'auto' : '100%', height: previewUrl ? 'auto' : '100%', position: 'relative' }}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
          >
            {!previewUrl ? (
              <div className="empty-state">
                <h3>No Document Open</h3>
                <button className="btn-browse" onClick={() => fileInputRef.current.click()}>
                  Browse File...
                </button>
              </div>
            ) : (
              <>
                {svgResult && svgResult.url ? (
                  <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <img src={svgResult.url} alt="Vectorized Result" style={{ maxHeight: '80%', maxWidth: '100%', objectFit: 'contain' }} />
                    <div style={{ padding: '10px', background: 'rgba(0,0,0,0.8)', color: '#00ffcc', fontSize: '11px', marginTop: '10px', borderRadius: '4px', maxWidth: '400px', wordWrap: 'break-word', textAlign: 'center' }}>
                      <strong>Gemini 3.1 Pro Vision Output:</strong><br/>
                      {svgResult.prompt}
                    </div>
                  </div>
                ) : (
                  <img src={previewUrl} alt="Upload" />
                )}
              </>
            )}
          </div>
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileChange} 
            accept="image/*" 
            style={{ display: "none" }} 
          />
        </div>

        {/* Right Properties Panel */}
        <aside className="properties-panel">
          
          <div className="panel-section">
            <div className="section-header">
              <span>PROPERTIES</span>
              <Settings2 size={12} />
            </div>
            <div className="section-content">
              {activeMode === "pattern" ? (
                <>
                  <div className="form-group">
                    <label className="form-label">Algorithm</label>
                    <select className="custom-select" defaultValue="seamless">
                      <option value="seamless">Surface Projection (Seamless)</option>
                      <option value="full">Planar Mapping (Full Layout)</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Mesh Distortion</label>
                    <select className="custom-select" defaultValue="standard">
                      <option value="standard">None</option>
                      <option value="aggressive">Aggressive Fold Correction</option>
                    </select>
                  </div>
                </>
              ) : (
                <>
                  <div className="form-group">
                    <label className="form-label">Path Fidelity</label>
                    <select className="custom-select" defaultValue="high">
                      <option value="high">High (Retain Geometry)</option>
                      <option value="medium">Medium (Smooth Curves)</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Color Quantization</label>
                    <select className="custom-select" defaultValue="full">
                      <option value="full">Full Color Gamut</option>
                      <option value="bw">Monochrome</option>
                    </select>
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="panel-section">
            <div className="section-header">
              <span>ACTIONS</span>
              <ChevronDown size={12} />
            </div>
            <div className="section-content">
              <button 
                className={`btn-primary ${!svgResult ? "highlight" : ""}`} 
                onClick={handleTrace}
                disabled={!file || isTracing}
              >
                {isTracing ? "Processing Vector..." : (
                  <><Play size={14} fill="currentColor" /> {activeMode === "pattern" ? "EXTRACT PATTERN" : "EXECUTE TRACE"}</>
                )}
              </button>

              <button 
                className="btn-primary" 
                onClick={handleDownload}
                disabled={!svgResult}
              >
                <Download size={14} /> EXPORT AS SVG
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
    </div>
  );
}
