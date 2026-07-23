"use client";

import { memo, useState, useRef, useCallback, useEffect } from "react";
import { Maximize, Minus, Plus, RotateCcw, Scissors, X } from "lucide-react";
import ReactCrop from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import { formatUploadLimit, resolveImageUploadLimit } from "@/lib/uploadLimits";
import { safeJson } from "@/lib/safeJson";

const DEFAULT_CROP_ZOOM = 0.5;

function CropGuidePhoto({ title, body, tone, imageSrc, imageAlt, boxClassName }) {
  return (
    <div className={`crop-guide-card ${tone === "good" ? "is-good" : "is-bad"}`}>
      <div className="crop-guide-label">
        <span />
        {title}
      </div>
      <p>{body}</p>
      <div className="crop-guide-photo-frame">
        <img src={imageSrc} alt={imageAlt} loading="lazy" />
        <div className={`crop-guide-demo-box ${boxClassName}`}>
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
        </div>
      </div>
    </div>
  );
}

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
  const [cropZoom, setCropZoom] = useState(DEFAULT_CROP_ZOOM);
  const imgRef = useRef(null);
  const stageRef = useRef(null);

  useEffect(() => {
    if (show) {
      setCropZoom(DEFAULT_CROP_ZOOM);
      setCrop(undefined);
      setCompletedCrop(null);
      setCropError("");
    }
  }, [show]);

  // ── Scroll-wheel zoom on the canvas stage ──────────────────────────────────
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const handleWheel = (e) => {
      e.preventDefault();
      // deltaY > 0 → scroll down → zoom out; < 0 → scroll up → zoom in
      const delta = e.deltaY > 0 ? -0.08 : 0.08;
      setCropZoom(z => {
        const next = Math.round((z + delta) * 100) / 100;
        return Math.min(3, Math.max(0.25, next));
      });
    };

    stage.addEventListener("wheel", handleWheel, { passive: false });
    return () => stage.removeEventListener("wheel", handleWheel);
  }, [show]); // re-attach whenever modal opens

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
      const urlData = await safeJson(urlRes, "Failed to get upload URL");
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
      const data = await safeJson(res, "Failed to save crop");
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
              <div className="crop-toolbar-right">
                <span>{cropSizeLabel}</span>
                <div className="crop-zoom-controls" aria-label="Crop zoom controls">
                  <button type="button" onClick={() => { setCrop(undefined); setCompletedCrop(null); setCropError(""); }} aria-label="Reset selection">
                    <RotateCcw size={12} />
                  </button>
                  <button type="button" onClick={() => setCropZoom(z => Math.max(0.5, Number((z - 0.1).toFixed(2))))} aria-label="Zoom out">
                    <Minus size={12} />
                  </button>
                  <strong>{Math.round(cropZoom * 100)}%</strong>
                  <button type="button" onClick={() => setCropZoom(z => Math.min(3, Number((z + 0.1).toFixed(2))))} aria-label="Zoom in">
                    <Plus size={12} />
                  </button>
                  <button type="button" onClick={() => setCropZoom(DEFAULT_CROP_ZOOM)} aria-label="Fit image">
                    <Maximize size={12} />
                  </button>
                </div>
              </div>
            </div>
            <div className="crop-canvas-stage" ref={stageRef}>
              <div className="crop-zoom-surface" style={{ width: `${cropZoom * 100}%` }}>
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
                <CropGuidePhoto
                  title="DO: Crop Torso Only"
                  body="Exclude sleeves. Keep the selection tight to the main body."
                  tone="good"
                  imageSrc="/crop-guide-front.webp"
                  imageAlt="Correct crop selection around the main shirt body"
                  boxClassName="is-tight-body"
                />
                <CropGuidePhoto
                  title="DON'T: Include Sleeves"
                  body="If sleeves are included, the AI may extract the full shirt shape."
                  tone="bad"
                  imageSrc="/crop-guide-back.webp"
                  imageAlt="Incorrect crop selection including shirt sleeves"
                  boxClassName="is-full-shirt"
                />
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
