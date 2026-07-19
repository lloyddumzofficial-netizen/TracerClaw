"use client";

import { memo, useState, useRef, useCallback, useEffect } from "react";
import { Eraser, X, Save } from "lucide-react";
import { formatUploadLimit, resolveImageUploadLimit } from "@/lib/uploadLimits";

/**
 * EraseModal — Isolated canvas drawing modal.
 * Only mounted when `show` is true.
 */
const EraseModal = memo(function EraseModal({
  show,
  project,
  supabase,
  onClose,
  onEraseApplied,
  onLoginRequired,
}) {
  const [brushSize, setBrushSize] = useState(20);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const isDrawing = useRef(false);
  const ctxRef = useRef(null);

  // Initialize canvas with image
  useEffect(() => {
    if (!show || !project?.original_image_url || !canvasRef.current || !containerRef.current) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const img = new Image();
    
    img.crossOrigin = "anonymous";
    img.src = `/api/proxy?url=${encodeURIComponent(project.original_image_url)}`;
    
    img.onload = () => {
      // Set internal canvas resolution to image resolution for perfect quality
      canvas.width = img.width;
      canvas.height = img.height;
      
      // Draw original image
      ctx.drawImage(img, 0, 0);
      
      // Setup drawing context
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#FFFFFF"; // Erase to pure white
      ctxRef.current = ctx;
    };
    
    img.onerror = () => {
      setErrorMsg("Failed to load image for erasing.");
    };
  }, [show, project?.original_image_url]);

  // Drawing event handlers
  const getCoordinates = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    let clientX, clientY;
    
    if (e.touches && e.touches.length > 0) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }
    
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY
    };
  };

  const startDrawing = (e) => {
    isDrawing.current = true;
    const { x, y } = getCoordinates(e);
    if (ctxRef.current) {
      ctxRef.current.beginPath();
      ctxRef.current.moveTo(x, y);
      ctxRef.current.lineWidth = brushSize * (canvasRef.current.width / canvasRef.current.getBoundingClientRect().width);
    }
  };

  const draw = (e) => {
    if (!isDrawing.current || !ctxRef.current) return;
    e.preventDefault(); // Prevent scrolling on touch
    
    const { x, y } = getCoordinates(e);
    ctxRef.current.lineTo(x, y);
    ctxRef.current.stroke();
  };

  const stopDrawing = () => {
    if (isDrawing.current && ctxRef.current) {
      ctxRef.current.closePath();
      isDrawing.current = false;
    }
  };

  const handleApply = useCallback(async () => {
    if (!canvasRef.current) return;

    setIsSaving(true);
    setErrorMsg("");

    try {
      const blob = await new Promise(resolve => canvasRef.current.toBlob(resolve, "image/jpeg", 0.95));
      const maxUploadBytes = resolveImageUploadLimit();
      if (!blob || blob.size > maxUploadBytes) {
        throw new Error(`Edited image is too large. Maximum allowed size is ${formatUploadLimit(maxUploadBytes)}.`);
      }

      const sessionRes = await supabase.auth.getSession();
      const token = sessionRes.data.session?.access_token;
      if (!token) {
        setIsSaving(false);
        onLoginRequired?.();
        return;
      }

      // 1. Get pre-signed upload URL
      const urlRes = await fetch("/api/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ fileName: `erased_${Date.now()}.jpg`, contentType: "image/jpeg", fileSize: blob.size }),
      });
      const urlData = await urlRes.json();
      if (!urlRes.ok || !urlData.uploadUrl) throw new Error(urlData.error || "Failed to get upload URL");

      // 2. Upload to R2 directly from client
      const putRes = await fetch(urlData.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": "image/jpeg" },
        body: blob,
      });
      if (!putRes.ok) throw new Error("Failed to upload erased image to storage");

      // 3. Update original_image_url
      const res = await fetch("/api/crop", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}` // Required: route now verifies auth
        },
        body: JSON.stringify({ projectId: project.id, croppedImageUrl: urlData.publicUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      onEraseApplied?.(urlData.publicUrl);
      onClose();
    } catch (err) {
      setErrorMsg(err.message);
      onEraseApplied?.(null, err.message);
    } finally {
      setIsSaving(false);
    }
  }, [project, supabase, onClose, onEraseApplied, onLoginRequired]);

  if (!show || !project) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: "1000px", width: "95%", maxHeight: "90vh", display: "flex", flexDirection: "column" }}>
        
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "15px" }}>
          <h3 style={{ margin: 0, display: "flex", alignItems: "center", gap: "8px" }}>
            <Eraser size={18} />
            Manual Eraser Tool
          </h3>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: "#888", cursor: "pointer", padding: "4px" }}>
            <X size={20} />
          </button>
        </div>

        <div style={{ display: "flex", gap: "20px", flex: 1, minHeight: 0, flexDirection: "row" }}>
          
          {/* Left Column: Canvas Area */}
          <div 
            ref={containerRef}
            style={{ 
              flex: "1 1 70%", 
              overflow: "auto", 
              backgroundColor: "#0f0f0f", 
              border: "1px solid #2a2a2a", 
              borderRadius: "8px", 
              display: "flex", 
              justifyContent: "center", 
              alignItems: "center",
              padding: "20px", 
              minHeight: "500px",
              cursor: `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="${brushSize}" height="${brushSize}" viewBox="0 0 ${brushSize} ${brushSize}"><circle cx="${brushSize/2}" cy="${brushSize/2}" r="${brushSize/2-1}" fill="rgba(255,255,255,0.5)" stroke="black" stroke-width="1"/></svg>') ${brushSize/2} ${brushSize/2}, crosshair`
            }}
          >
            <canvas
              ref={canvasRef}
              onMouseDown={startDrawing}
              onMouseMove={draw}
              onMouseUp={stopDrawing}
              onMouseOut={stopDrawing}
              onTouchStart={startDrawing}
              onTouchMove={draw}
              onTouchEnd={stopDrawing}
              style={{
                maxWidth: "100%",
                maxHeight: "70vh",
                objectFit: "contain",
                touchAction: "none" // Prevent touch scrolling while drawing
              }}
            />
          </div>

          {/* Right Column: Controls */}
          <div style={{ flex: "0 0 280px", backgroundColor: "#0a0a0a", border: "1px solid #1f1f1f", borderRadius: "8px", padding: "24px 20px", display: "flex", flexDirection: "column", gap: "24px" }}>
            
            <div>
              <h4 style={{ margin: "0 0 6px", color: "#fff", fontSize: "14px", fontWeight: "600" }}>Eraser Options</h4>
              <p style={{ fontSize: "12px", color: "#666", margin: 0, lineHeight: 1.5 }}>
                Paint over texts, noise, or unwanted parts. They will turn white and be ignored by the AI.
              </p>
            </div>

            <div className="form-group">
              <label style={{ fontSize: "12px", color: "#ccc", display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
                <span>Brush Size</span>
                <span style={{ color: "#FFD700" }}>{brushSize}px</span>
              </label>
              <input 
                type="range" 
                min="5" 
                max="100" 
                value={brushSize} 
                onChange={(e) => setBrushSize(parseInt(e.target.value))}
                style={{ width: "100%", cursor: "pointer", accentColor: "#FFD700" }}
              />
            </div>

            {errorMsg && (
              <div style={{ background: "rgba(255, 68, 68, 0.1)", border: "1px solid rgba(255, 68, 68, 0.3)", color: "#ff8888", padding: "10px", borderRadius: "6px", fontSize: "12px" }}>
                {errorMsg}
              </div>
            )}

            <div style={{ marginTop: "auto", display: "flex", gap: "12px", flexDirection: "column" }}>
              <button 
                className="btn-primary" 
                onClick={handleApply} 
                disabled={isSaving}
                style={{ background: "#FFD700", color: "#000", fontWeight: "bold", padding: "12px", borderRadius: "8px", display: "flex", justifyContent: "center", alignItems: "center", gap: "8px" }}
              >
                {isSaving ? "Saving..." : <><Save size={16} /> Apply & Save</>}
              </button>
              <button 
                className="btn-primary" 
                onClick={onClose} 
                disabled={isSaving}
                style={{ background: "#222", color: "#ccc", padding: "12px", borderRadius: "8px" }}
              >
                Cancel
              </button>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
});

export default EraseModal;
