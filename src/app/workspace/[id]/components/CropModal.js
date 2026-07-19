"use client";

import { memo, useState, useRef, useCallback } from "react";
import { Scissors, X } from "lucide-react";
import ReactCrop from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import { formatUploadLimit, resolveImageUploadLimit } from "@/lib/uploadLimits";

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
      const maxUploadBytes = resolveImageUploadLimit();
      if (!blob || blob.size > maxUploadBytes) {
        throw new Error(`Cropped image is too large. Maximum allowed size is ${formatUploadLimit(maxUploadBytes)}.`);
      }

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
        body: JSON.stringify({ fileName: `crop_${Date.now()}.jpg`, contentType: "image/jpeg", fileSize: blob.size }),
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
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}` // Required: route now verifies auth
        },
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

  const cropSizeLabel = completedCrop?.width && completedCrop?.height
    ? `${Math.round(completedCrop.width)} x ${Math.round(completedCrop.height)} px`
    : "No selection";

  return (
    <div className="modal-overlay crop-workspace-overlay">
      <div className="crop-workspace-modal">
        <div className="crop-workspace-header">
          <div className="crop-workspace-title">
            <span className="crop-tool-icon"><Scissors size={16} /></span>
            <div>
              <h3>Crop Pattern Region</h3>
              <p>Isolate the artwork area for cleaner extraction.</p>
            </div>
          </div>
          <button className="crop-close-btn" onClick={onClose} aria-label="Close crop modal">
            <X size={16} />
          </button>
        </div>

        <div className="crop-workspace-body">
          <div className="crop-canvas-panel">
            <div className="crop-canvas-toolbar">
              <span>Source Image</span>
              <span>{cropSizeLabel}</span>
            </div>
            <div className="crop-canvas-stage">
              <ReactCrop
                crop={crop}
                onChange={c => { setCrop(c); setCropError(""); }}
                onComplete={c => setCompletedCrop(c)}
                className="designer-crop"
              >
                <img
                  ref={imgRef}
                  src={`/api/proxy?url=${encodeURIComponent(project.original_image_url)}`}
                  alt="Crop source"
                  className="crop-source-image"
                  crossOrigin="anonymous"
                  onLoad={e => { imgRef.current = e.currentTarget; }}
                />
              </ReactCrop>
            </div>
          </div>

          <aside className="crop-guide-panel">
            <div className="crop-guide-header">
              <span>Guide</span>
              <strong>{project?.trace_type === 'logo' ? "Logo Mode" : "Pattern Mode"}</strong>
            </div>
            {project?.trace_type === 'logo' ? (
              <>
                <div className="crop-guide-card is-good">
                  <div className="crop-guide-label">
                    <span />
                    DO: Crop Tightly Around Logo
                  </div>
                  <p>Remove empty background. Keep the box snug to the logo edges.</p>
                  <svg viewBox="5 5 90 90" width="100%" height="126">
                    <circle cx="50" cy="50" r="20" fill="#FFD700" />
                    <path d="M 40 50 L 60 50 M 50 40 L 50 60" stroke="#000" strokeWidth="4" />
                    <rect x="28" y="28" width="44" height="44" fill="transparent" stroke="#4ade80" strokeWidth="1.5" strokeDasharray="3 3" />
                    <rect x="26" y="26" width="4" height="4" fill="#4ade80" />
                    <rect x="70" y="26" width="4" height="4" fill="#4ade80" />
                    <rect x="26" y="70" width="4" height="4" fill="#4ade80" />
                    <rect x="70" y="70" width="4" height="4" fill="#4ade80" />
                  </svg>
                </div>
                <div className="crop-guide-card is-bad">
                  <div className="crop-guide-label">
                    <span />
                    DON'T: Include Extra Space
                  </div>
                  <p>Huge margins reduce effective AI detail and weaken the result.</p>
                  <svg viewBox="5 5 90 90" width="100%" height="126">
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
                <div className="crop-guide-card is-good">
                  <div className="crop-guide-label">
                    <span />
                    DO: Crop Torso Only
                  </div>
                  <p>Exclude sleeves. Keep the selection tight to the main body.</p>
                  <svg viewBox="5 5 90 90" width="100%" height="126">
                    <path d="M 20 20 L 40 10 L 60 10 L 80 20 L 90 40 L 75 45 L 70 90 L 30 90 L 25 45 L 10 40 Z" fill="#1a1a1a" stroke="#333" strokeWidth="1" />
                    <path d="M 35 30 L 65 50 M 35 50 L 65 70 M 35 70 L 65 90" stroke="#222" strokeWidth="1.5" />
                    <rect x="25" y="10" width="50" height="80" fill="rgba(74, 222, 128, 0.05)" stroke="#4ade80" strokeWidth="1.5" strokeDasharray="3 3" />
                    <rect x="23" y="8" width="4" height="4" fill="#4ade80" />
                    <rect x="73" y="8" width="4" height="4" fill="#4ade80" />
                    <rect x="23" y="88" width="4" height="4" fill="#4ade80" />
                    <rect x="73" y="88" width="4" height="4" fill="#4ade80" />
                  </svg>
                </div>
                <div className="crop-guide-card is-bad">
                  <div className="crop-guide-label">
                    <span />
                    DON'T: Include Sleeves
                  </div>
                  <p>If sleeves are included, the AI may extract the full shirt shape.</p>
                  <svg viewBox="5 5 90 90" width="100%" height="126">
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
            <div className="crop-inspector-panel">
              <div className="crop-inspector-row">
                <span>Selection</span>
                <strong>{cropSizeLabel}</strong>
              </div>
              <div className="crop-inspector-row">
                <span>Output</span>
                <strong>JPG · max 1536px</strong>
              </div>
              <div className="crop-inspector-row">
                <span>Focus</span>
                <strong>{project?.trace_type === 'logo' ? "Logo artwork" : "Main body"}</strong>
              </div>
            </div>
          </aside>
        </div>

        {cropError && (
          <div className="crop-error-message">
            {cropError}
          </div>
        )}
        <div className="crop-workspace-actions">
          {project?.generated_image_url && (
            <button className="btn-secondary crop-secondary-action" onClick={onClose}>Cancel</button>
          )}
          <button className="btn-primary crop-primary-action" onClick={handleApply} disabled={isSaving}>
            {isSaving ? "Saving..." : "Apply Crop & Extract"}
          </button>
        </div>
      </div>
    </div>
  );
});

export default CropModal;
