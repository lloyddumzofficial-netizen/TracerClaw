"use client";

import { memo, useState, useRef, useCallback, useEffect } from "react";
import { ArrowRight, CheckCircle2, Crosshair, Info, Loader2, Maximize, Minus, Plus, RotateCcw, ScanLine, X, XCircle } from "lucide-react";
import ReactCrop, { convertToPixelCrop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import { formatUploadLimit, resolveImageUploadLimit } from "@/lib/uploadLimits";
import { safeJson } from "@/lib/safeJson";

const DEFAULT_CROP_ZOOM = 0.5;
const MIN_CROP_ZOOM = 0.35;
const MAX_CROP_ZOOM = 4;
const CROP_ZOOM_STEP = 0.25;
const WHEEL_ZOOM_STEP = 0.1;
const CROP_STAGE_PADDING = 18;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function CropGuidePhoto({ title, body, tone, imageSrc, imageAlt, boxClassName }) {
  const Icon = tone === "good" ? CheckCircle2 : XCircle;

  return (
    <div className={`crop-guide-card ${tone === "good" ? "is-good" : "is-bad"}`}>
      <div className="crop-guide-label">
        <Icon size={14} />
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
  const [imageSize, setImageSize] = useState(null);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const imgRef = useRef(null);
  const stageRef = useRef(null);

  useEffect(() => {
    if (show) {
      setCropZoom(DEFAULT_CROP_ZOOM);
      setCrop(undefined);
      setCompletedCrop(null);
      setCropError("");
      setImageSize(null);
    }
  }, [show]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !show) return;

    const updateStageSize = () => {
      setStageSize({
        width: stage.clientWidth,
        height: stage.clientHeight,
      });
    };

    updateStageSize();
    const observer = new ResizeObserver(updateStageSize);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [show]);

  const fitScale = imageSize && stageSize.width && stageSize.height
    ? Math.min(
        1,
        Math.max(0.05, (stageSize.width - CROP_STAGE_PADDING * 2) / imageSize.width),
        Math.max(0.05, (stageSize.height - CROP_STAGE_PADDING * 2) / imageSize.height)
      )
    : 1;

  const displayWidth = imageSize ? Math.max(1, Math.round(imageSize.width * fitScale * cropZoom)) : undefined;
  const displayHeight = imageSize ? Math.max(1, Math.round(imageSize.height * fitScale * cropZoom)) : undefined;
  const surfaceOffsetX = displayWidth && stageSize.width ? Math.max(0, Math.round((stageSize.width - displayWidth - CROP_STAGE_PADDING * 2) / 2)) : 0;
  const surfaceOffsetY = displayHeight && stageSize.height ? Math.max(0, Math.round((stageSize.height - displayHeight - CROP_STAGE_PADDING * 2) / 2)) : 0;

  const setZoomKeepingPoint = useCallback((nextZoom, anchorPoint) => {
    const stage = stageRef.current;
    const previousZoom = cropZoom;
    const zoomValue = clamp(
      typeof nextZoom === "function" ? nextZoom(previousZoom) : nextZoom,
      MIN_CROP_ZOOM,
      MAX_CROP_ZOOM
    );

    if (!stage || Math.abs(zoomValue - previousZoom) < 0.001) {
      setCropZoom(zoomValue);
      return;
    }

    const stageRect = stage.getBoundingClientRect();
    const anchorX = anchorPoint ? anchorPoint.clientX - stageRect.left : stage.clientWidth / 2;
    const anchorY = anchorPoint ? anchorPoint.clientY - stageRect.top : stage.clientHeight / 2;
    const contentX = stage.scrollLeft + anchorX;
    const contentY = stage.scrollTop + anchorY;
    const relativeX = stage.scrollWidth > 0 ? contentX / stage.scrollWidth : 0.5;
    const relativeY = stage.scrollHeight > 0 ? contentY / stage.scrollHeight : 0.5;

    setCropZoom(zoomValue);
    requestAnimationFrame(() => {
      stage.scrollLeft = relativeX * stage.scrollWidth - anchorX;
      stage.scrollTop = relativeY * stage.scrollHeight - anchorY;
    });
  }, [cropZoom]);

  const setZoomKeepingCenter = useCallback((nextZoom) => {
    setZoomKeepingPoint(nextZoom);
  }, [setZoomKeepingPoint]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !show) return;

    const handleWheel = (e) => {
      e.preventDefault();
      e.stopPropagation();
      setZoomKeepingPoint(
        z => z + (e.deltaY > 0 ? -WHEEL_ZOOM_STEP : WHEEL_ZOOM_STEP),
        { clientX: e.clientX, clientY: e.clientY }
      );
    };

    stage.addEventListener("wheel", handleWheel, { passive: false, capture: true });
    return () => stage.removeEventListener("wheel", handleWheel, true);
  }, [setZoomKeepingPoint, show]);

  const handleApply = useCallback(async () => {
    if (isSaving) return;

    if (!completedCrop || !imgRef.current || !completedCrop.width || !completedCrop.height) {
      if (!project?.generated_image_url) {
        setCropError("Please draw a crop area first! You must choose either the front or the back.");
        return;
      }
      onClose();
      return;
    }

    setIsSaving(true);
    setCropError("");

    const canvas = document.createElement("canvas");
    const image = imgRef.current;
    const imageRect = image.getBoundingClientRect();
    const pixelCrop = completedCrop.unit === "%"
      ? convertToPixelCrop(completedCrop, imageRect.width, imageRect.height)
      : completedCrop;
    const scaleX = image.naturalWidth / imageRect.width;
    const scaleY = image.naturalHeight / imageRect.height;

    const MAX_SIZE = 1536;
    let targetWidth = pixelCrop.width * scaleX;
    let targetHeight = pixelCrop.height * scaleY;

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
      pixelCrop.x * scaleX,
      pixelCrop.y * scaleY,
      pixelCrop.width * scaleX,
      pixelCrop.height * scaleY,
      0, 0, targetWidth, targetHeight
    );

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
      onClose();
    } catch (err) {
      const message = err.message || "Failed to apply crop.";
      setCropError(message);
      onCropApplied?.(null, message);
    } finally {
      setIsSaving(false);
    }
  }, [completedCrop, isSaving, project, supabase, onClose, onCropApplied, onLoginRequired]);

  if (!show || !project) return null;

  const cropSizeLabel = completedCrop?.width && completedCrop?.height && imageSize
    ? `${Math.round((completedCrop.width / 100) * imageSize.width)} x ${Math.round((completedCrop.height / 100) * imageSize.height)} px`
    : "No selection";
  const sourceMetaLabel = imageSize ? `JPG · ${imageSize.width} x ${imageSize.height}px` : "Loading image";
  const isLogoMode = project?.trace_type === 'logo';

  return (
    <div className="modal-overlay crop-workspace-overlay">
      <div className="crop-workspace-modal">
        <div className="crop-workspace-header">
          <div className="crop-workspace-title">
            <div className="crop-tool-mark">
              <Crosshair size={17} />
            </div>
            <div>
              <div className="crop-title-line">
                <h3>Crop Pattern Region</h3>
              </div>
              <p>Frame the artwork area for cleaner and more accurate extraction.</p>
            </div>
          </div>
          <button className="crop-close-btn" onClick={onClose} aria-label="Close crop modal" disabled={isSaving}>
            <X size={16} />
          </button>
        </div>

        <div className="crop-workspace-body">
          <div className="crop-canvas-panel">
            <div className="crop-canvas-toolbar">
              <div className="crop-source-meta">
                <ScanLine size={14} />
                <div>
                  <strong>Source Image</strong>
                  <span>{sourceMetaLabel}</span>
                </div>
              </div>
              <div className="crop-toolbar-right">
                <span>{cropSizeLabel}</span>
                <div className="crop-zoom-controls" aria-label="Crop zoom controls">
                  <button type="button" onClick={() => { setCrop(undefined); setCompletedCrop(null); setCropError(""); }} aria-label="Reset selection">
                    <RotateCcw size={12} />
                  </button>
                  <button type="button" onClick={() => setZoomKeepingCenter(z => z - CROP_ZOOM_STEP)} aria-label="Zoom out" disabled={cropZoom <= MIN_CROP_ZOOM}>
                    <Minus size={12} />
                  </button>
                  <strong>{Math.round(cropZoom * 100)}%</strong>
                  <button type="button" onClick={() => setZoomKeepingCenter(z => z + CROP_ZOOM_STEP)} aria-label="Zoom in" disabled={cropZoom >= MAX_CROP_ZOOM}>
                    <Plus size={12} />
                  </button>
                  <button type="button" onClick={() => setZoomKeepingCenter(DEFAULT_CROP_ZOOM)} aria-label="Fit image">
                    <Maximize size={12} />
                  </button>
                </div>
              </div>
            </div>
            <div className={`crop-canvas-stage ${isSaving ? "is-saving" : ""}`} ref={stageRef}>
              <div
                className="crop-zoom-surface"
                style={{
                  width: displayWidth ? `${displayWidth}px` : "1px",
                  height: displayHeight ? `${displayHeight}px` : "1px",
                  marginLeft: `${surfaceOffsetX}px`,
                  marginTop: `${surfaceOffsetY}px`,
                }}
              >
                <ReactCrop
                  crop={crop}
                  onChange={(pixelCrop, percentCrop) => {
                    setCrop(percentCrop);
                    setCompletedCrop(null);
                    setCropError("");
                  }}
                  onComplete={(pixelCrop, percentCrop) => setCompletedCrop(percentCrop)}
                  onDragStart={() => setCompletedCrop(null)}
                  ruleOfThirds
                  className="designer-crop"
                  style={{ width: displayWidth ? `${displayWidth}px` : "auto" }}
                >
                  <img
                    ref={imgRef}
                    src={`/api/proxy?url=${encodeURIComponent(project.original_image_url)}`}
                    alt="Crop source"
                    className="crop-source-image"
                    width={displayWidth || 1}
                    height={displayHeight || 1}
                    style={{
                      width: displayWidth ? `${displayWidth}px` : "1px",
                      height: displayHeight ? `${displayHeight}px` : "1px",
                      opacity: imageSize ? 1 : 0,
                    }}
                    crossOrigin="anonymous"
                    onLoad={e => {
                      imgRef.current = e.currentTarget;
                      setImageSize({
                        width: e.currentTarget.naturalWidth,
                        height: e.currentTarget.naturalHeight,
                      });
                    }}
                  />
                </ReactCrop>
              </div>
            </div>
          </div>

          <aside className="crop-guide-panel">
            <div className="crop-guide-header">
              <span>Guide</span>
              <strong>{isLogoMode ? "Logo Mode" : "Pattern Mode"}</strong>
            </div>
            {isLogoMode ? (
              <>
                <div className="crop-guide-card is-good">
                  <div className="crop-guide-label">
                    <CheckCircle2 size={14} />
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
                    <XCircle size={14} />
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
          </aside>
        </div>

        {cropError && (
          <div className="crop-error-message">
            {cropError}
          </div>
        )}
        <div className="crop-workspace-actions">
          <div className="crop-tip-block">
            <Info size={17} />
            <div>
              <strong>Tip</strong>
              <span>Use the handles to tightly frame only the target artwork. Scroll on the canvas to zoom.</span>
            </div>
          </div>
          {project?.generated_image_url && (
            <button className="btn-secondary crop-secondary-action" onClick={onClose} disabled={isSaving}>Cancel</button>
          )}
          <button
            type="button"
            className="crop-secondary-action crop-reset-action"
            disabled={isSaving}
            onClick={() => { setCrop(undefined); setCompletedCrop(null); setCropError(""); setZoomKeepingCenter(DEFAULT_CROP_ZOOM); }}
          >
            <RotateCcw size={13} />
            Reset
          </button>
          <button className="btn-primary crop-primary-action" onClick={handleApply} disabled={isSaving}>
            {isSaving ? (
              <>
                <Loader2 size={14} className="crop-saving-spinner" />
                Cropping...
              </>
            ) : (
              <>
                <ArrowRight size={14} />
                Apply Crop & Extract
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
});

export default CropModal;
