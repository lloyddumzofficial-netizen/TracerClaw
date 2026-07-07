"use client";

import { memo, useState, useRef, useCallback } from "react";
import { Scissors, X } from "lucide-react";
import ReactCrop from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";

/**
 * CropModal — Isolated crop modal with its own state.
 * Only mounted when `show` is true — no cost when hidden.
 */
const CropModal = memo(function CropModal({
  show,
  project,
  supabase,
  onClose,
  onCropApplied,
  onLoginRequired,
}) {
  const [crop, setCrop] = useState();
  const [completedCrop, setCompletedCrop] = useState(null);
  const [cropError, setCropError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const imgRef = useRef(null);

  const handleApply = useCallback(async () => {
    if (!completedCrop || !imgRef.current || !completedCrop.width || !completedCrop.height) {
      if (!project?.generated_image_url) {
        setCropError("Please draw a crop area first! You must choose either the front or the back.");
        return;
      }
      onClose();
      return;
    }

    const canvas = document.createElement("canvas");
    const image = imgRef.current;
    const scaleX = image.naturalWidth / image.width;
    const scaleY = image.naturalHeight / image.height;

    const MAX_SIZE = 1536;
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
      0, 0, targetWidth, targetHeight
    );

    onClose();
    setIsSaving(true);

    try {
      const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.90));

      const sessionRes = await supabase.auth.getSession();
      const token = sessionRes.data.session?.access_token;
      if (!token) {
        setIsSaving(false);
        onLoginRequired?.();
        return;
      }

      const urlRes = await fetch("/api/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ fileName: `crop_${Date.now()}.jpg`, contentType: "image/jpeg" }),
      });
      const urlData = await urlRes.json();
      if (!urlRes.ok || !urlData.uploadUrl) throw new Error(urlData.error || "Failed to get upload URL");

      const putRes = await fetch(urlData.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": "image/jpeg" },
        body: blob,
      });
      if (!putRes.ok) throw new Error("Failed to upload crop to storage");

      const res = await fetch("/api/crop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id, croppedImageUrl: urlData.publicUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      onCropApplied?.(urlData.publicUrl);
    } catch (err) {
      onCropApplied?.(null, err.message);
    } finally {
      setIsSaving(false);
    }
  }, [completedCrop, project, supabase, onClose, onCropApplied, onLoginRequired]);

  if (!show || !project) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: "1000px", width: "95%", maxHeight: "90vh", display: "flex", flexDirection: "column" }}>
        <h3 style={{ marginBottom: "15px" }}>
          <Scissors size={18} style={{ verticalAlign: "text-bottom", marginRight: "8px" }} />
          Crop Pattern Region
        </h3>

        <div style={{ display: "flex", gap: "20px", flex: 1, minHeight: 0, flexDirection: "row" }}>
          {/* Left Column: The Cropper */}
          <div style={{ flex: "1 1 65%", backgroundColor: "#0f0f0f", border: "1px solid #2a2a2a", borderRadius: "8px", display: "flex", justifyContent: "center", alignItems: "center", padding: "16px", minHeight: "400px", overflow: "hidden" }}>
            <ReactCrop
              crop={crop}
              onChange={c => { setCrop(c); setCropError(""); }}
              onComplete={c => setCompletedCrop(c)}
              style={{ display: "flex", justifyContent: "center", alignItems: "center", maxWidth: "100%", maxHeight: "100%" }}
            >
              <img
                ref={imgRef}
                src={`/api/proxy-image?url=${encodeURIComponent(project.original_image_url)}`}
                alt="Crop source"
                style={{ maxHeight: "65vh", maxWidth: "100%", objectFit: "contain", display: "block", margin: "0 auto" }}
                crossOrigin="anonymous"
                onLoad={e => { imgRef.current = e.currentTarget; }}
              />
            </ReactCrop>
          </div>

          {/* Right Column: The Guide */}
          <div style={{ flex: "0 0 320px", backgroundColor: "#0a0a0a", border: "1px solid #1f1f1f", borderRadius: "8px", padding: "24px 20px", display: "flex", flexDirection: "column", gap: "24px", overflowY: "auto" }}>
            <div>
              <h4 style={{ margin: "0 0 6px", color: "#fff", fontSize: "14px", fontWeight: "600", letterSpacing: "0.3px" }}>Crop Guide</h4>
              <p style={{ fontSize: "12px", color: "#666", margin: 0, lineHeight: 1.5 }}>Help the AI focus by isolating the pattern correctly.</p>
            </div>
            {project?.trace_type === 'logo' ? (
              <>
                <div>
                  <div style={{ color: "#ececec", fontWeight: "500", fontSize: "13px", marginBottom: "8px", display: "flex", alignItems: "center", gap: "8px" }}>
                    <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#4ade80" }} />
                    DO: Crop Tightly Around Logo
                  </div>
                  <p style={{ fontSize: "12px", color: "#666", margin: "0 0 12px", lineHeight: 1.5 }}>Remove as much empty background as possible. Keep the box snug to the logo edges.</p>
                  <svg viewBox="5 5 90 90" width="100%" height="140" style={{ display: "block", backgroundColor: "#111", borderRadius: "6px", padding: "10px", boxSizing: "border-box" }}>
                    <circle cx="50" cy="50" r="20" fill="#FFD700" />
                    <path d="M 40 50 L 60 50 M 50 40 L 50 60" stroke="#000" strokeWidth="4" />
                    <rect x="28" y="28" width="44" height="44" fill="transparent" stroke="#4ade80" strokeWidth="1.5" strokeDasharray="3 3" />
                    <rect x="26" y="26" width="4" height="4" fill="#4ade80" />
                    <rect x="70" y="26" width="4" height="4" fill="#4ade80" />
                    <rect x="26" y="70" width="4" height="4" fill="#4ade80" />
                    <rect x="70" y="70" width="4" height="4" fill="#4ade80" />
                  </svg>
                </div>
                <div>
                  <div style={{ color: "#ececec", fontWeight: "500", fontSize: "13px", marginBottom: "8px", display: "flex", alignItems: "center", gap: "8px" }}>
                    <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#ff4444" }} />
                    DON'T: Include Extra Space
                  </div>
                  <p style={{ fontSize: "12px", color: "#666", margin: "0 0 12px", lineHeight: 1.5 }}>Do not leave huge margins around the logo. This reduces the AI resolution.</p>
                  <svg viewBox="5 5 90 90" width="100%" height="140" style={{ display: "block", backgroundColor: "#111", borderRadius: "6px", padding: "10px", boxSizing: "border-box" }}>
                    <circle cx="50" cy="50" r="20" fill="#FFD700" />
                    <path d="M 40 50 L 60 50 M 50 40 L 50 60" stroke="#000" strokeWidth="4" />
                    <rect x="5" y="5" width="90" height="90" fill="rgba(255, 68, 68, 0.05)" stroke="#ff4444" strokeWidth="1.5" strokeDasharray="3 3" />
                    <rect x="3" y="3" width="4" height="4" fill="#ff4444" />
                    <rect x="93" y="3" width="4" height="4" fill="#ff4444" />
                    <rect x="3" y="93" width="4" height="4" fill="#ff4444" />
                    <rect x="93" y="93" width="4" height="4" fill="#ff4444" />
                  </svg>
                </div>
              </>
            ) : (
              <>
                <div>
                  <div style={{ color: "#ececec", fontWeight: "500", fontSize: "13px", marginBottom: "8px", display: "flex", alignItems: "center", gap: "8px" }}>
                    <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#4ade80" }} />
                    DO: Crop Torso Only
                  </div>
                  <p style={{ fontSize: "12px", color: "#666", margin: "0 0 12px", lineHeight: 1.5 }}>Exclude sleeves. Keep the box tight to the main body.</p>
                  <svg viewBox="5 5 90 90" width="100%" height="140" style={{ display: "block", backgroundColor: "#111", borderRadius: "6px", padding: "10px", boxSizing: "border-box" }}>
                    <path d="M 20 20 L 40 10 L 60 10 L 80 20 L 90 40 L 75 45 L 70 90 L 30 90 L 25 45 L 10 40 Z" fill="#1a1a1a" stroke="#333" strokeWidth="1" />
                    <path d="M 35 30 L 65 50 M 35 50 L 65 70 M 35 70 L 65 90" stroke="#222" strokeWidth="1.5" />
                    <rect x="25" y="10" width="50" height="80" fill="rgba(74, 222, 128, 0.05)" stroke="#4ade80" strokeWidth="1.5" strokeDasharray="3 3" />
                    <rect x="23" y="8" width="4" height="4" fill="#4ade80" />
                    <rect x="73" y="8" width="4" height="4" fill="#4ade80" />
                    <rect x="23" y="88" width="4" height="4" fill="#4ade80" />
                    <rect x="73" y="88" width="4" height="4" fill="#4ade80" />
                  </svg>
                </div>
                <div>
                  <div style={{ color: "#ececec", fontWeight: "500", fontSize: "13px", marginBottom: "8px", display: "flex", alignItems: "center", gap: "8px" }}>
                    <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#ff4444" }} />
                    DON'T: Include Sleeves
                  </div>
                  <p style={{ fontSize: "12px", color: "#666", margin: "0 0 12px", lineHeight: 1.5 }}>If you include sleeves, the AI will draw a shirt.</p>
                  <svg viewBox="5 5 90 90" width="100%" height="140" style={{ display: "block", backgroundColor: "#111", borderRadius: "6px", padding: "10px", boxSizing: "border-box" }}>
                    <path d="M 20 20 L 40 10 L 60 10 L 80 20 L 90 40 L 75 45 L 70 90 L 30 90 L 25 45 L 10 40 Z" fill="#1a1a1a" stroke="#333" strokeWidth="1" />
                    <rect x="5" y="5" width="90" height="90" fill="rgba(255, 68, 68, 0.05)" stroke="#ff4444" strokeWidth="1.5" strokeDasharray="3 3" />
                    <rect x="3" y="3" width="4" height="4" fill="#ff4444" />
                    <rect x="93" y="3" width="4" height="4" fill="#ff4444" />
                    <rect x="3" y="93" width="4" height="4" fill="#ff4444" />
                    <rect x="93" y="93" width="4" height="4" fill="#ff4444" />
                  </svg>
                </div>
              </>
            )}
          </div>
        </div>

        {cropError && (
          <div style={{ color: "#ff4444", fontSize: "13px", marginTop: "12px", textAlign: "center", fontWeight: "bold" }}>
            {cropError}
          </div>
        )}
        <div className="modal-actions" style={{ marginTop: "20px" }}>
          {project?.generated_image_url && (
            <button className="btn-secondary" onClick={onClose}>Cancel</button>
          )}
          <button className="btn-primary" onClick={handleApply} disabled={isSaving}>
            {isSaving ? "Saving..." : "Apply Crop & Extract"}
          </button>
        </div>
      </div>
    </div>
  );
});

export default CropModal;
