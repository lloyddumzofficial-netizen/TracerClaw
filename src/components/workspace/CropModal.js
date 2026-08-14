"use client";

import { memo, useState, useRef, useCallback, useEffect } from "react";
import { ArrowRight, CheckCircle2, Crosshair, Info, Loader2, Maximize, Minus, Plus, RotateCcw, ScanLine, X, XCircle } from "lucide-react";
import ReactCrop, { convertToPixelCrop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import { formatUploadLimit, resolveImageUploadLimit } from "@/lib/uploadLimits";
import { safeJson } from "@/lib/safeJson";

// Opens at 90%, not 50%. The crop modal opens automatically right after upload,
// and at 50% the artwork was small enough that users had to zoom in before they
// could frame anything — an extra step on every single project.
const DEFAULT_CROP_ZOOM = 0.9;
const MIN_CROP_ZOOM = 0.35;
const MAX_CROP_ZOOM = 4;
const CROP_ZOOM_STEP = 0.25;
const WHEEL_ZOOM_STEP = 0.1;
const CROP_STAGE_PADDING = 18;
const CROP_GUIDE_STORAGE_KEY = "desaynclaw_crop_guide_dismissed";

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function CropGuidePhoto({ title, body, description, tips, tone, imageSrc, videoSrc, imageAlt, boxClassName }) {
  const Icon = tone === "good" ? CheckCircle2 : XCircle;

  return (
    <div className={`crop-guide-card ${tone === "good" ? "is-good" : "is-bad"}`}>
      <div className="crop-guide-label">
        <Icon size={14} />
        {title}
      </div>
      {body && <p>{body}</p>}
      <div className="crop-guide-photo-frame">
        {videoSrc ? (
          <video autoPlay loop muted playsInline preload="metadata" aria-label={imageAlt}>
            <source src={videoSrc} type="video/mp4" />
          </video>
        ) : (
          <img src={imageSrc} alt={imageAlt} loading="lazy" />
        )}
        {description && (
          <div className="crop-guide-description">{description}</div>
        )}
        {tips && (
          <div className="crop-guide-tips-overlay">
            <p className="crop-guide-tip-item">{tips}</p>
          </div>
        )}
        {boxClassName && (
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
        )}
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
  const [showCropGuideIntro, setShowCropGuideIntro] = useState(false);
  const [dontShowCropGuideAgain, setDontShowCropGuideAgain] = useState(false);
  const imgRef = useRef(null);
  const stageRef = useRef(null);

  useEffect(() => {
    if (show) {
      setCropZoom(DEFAULT_CROP_ZOOM);
      setCrop(undefined);
      setCompletedCrop(null);
      setCropError("");
      setImageSize(null);
      setDontShowCropGuideAgain(false);
      try {
        setShowCropGuideIntro(window.localStorage.getItem(CROP_GUIDE_STORAGE_KEY) !== "1");
      } catch {
        setShowCropGuideIntro(true);
      }
    }
  }, [show]);

  const dismissCropGuideIntro = useCallback(() => {
    if (dontShowCropGuideAgain) {
      try {
        window.localStorage.setItem(CROP_GUIDE_STORAGE_KEY, "1");
      } catch {
        // Non-critical: the guide can still be dismissed for this session.
      }
    }
    setShowCropGuideIntro(false);
  }, [dontShowCropGuideAgain]);

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
    <div className="modal-overlay crop-workspace-overlay" translate="no">
      <div className="crop-workspace-modal">
        {showCropGuideIntro && (
          <div className="crop-intro-layer" role="dialog" aria-modal="true" aria-labelledby="crop-intro-title">
            <div className="crop-intro-card">
              <button type="button" className="crop-intro-close" onClick={dismissCropGuideIntro} aria-label="Close crop reminder">
                <X size={16} />
              </button>
              <div className="crop-intro-heading">
                <div>
                  <span className="crop-intro-kicker">Crop source quality</span>
                  <h3 id="crop-intro-title">Keep only the printable area</h3>
                </div>
              </div>
              <p className="crop-intro-lead">
                The crop becomes the exact source for extraction. Keep it tight to the design/body panel so the output does not include unwanted side space.
              </p>
              <div className="crop-intro-rules">
                <div><span>01</span><p>Choose one side only: front or back.</p></div>
                <div><span>02</span><p>Do not include sleeves, collar, armholes, shadows, background, or white margins.</p></div>
                <div><span>03</span><p>Use the guide videos on the right side of the crop screen if you are unsure.</p></div>
              </div>
              <div className="crop-intro-warning">
                Wrong crop or extra mockup space is user error and is not refundable.
              </div>
              <div className="crop-intro-footer">
                <label className="crop-intro-check">
                  <input
                    type="checkbox"
                    checked={dontShowCropGuideAgain}
                    onChange={e => setDontShowCropGuideAgain(e.target.checked)}
                  />
                  Don't show again
                </label>
                <button type="button" className="btn-primary crop-intro-action" onClick={dismissCropGuideIntro}>
                  Start Crop
                </button>
              </div>
            </div>
          </div>
        )}
        <div className="crop-workspace-header">
          <div className="crop-workspace-title">
            <div className="crop-tool-mark">
              <Crosshair size={17} />
            </div>
            <div>
              <div className="crop-title-line">
                <h3>Crop</h3>
              </div>
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
                    Tight logo crop
                  </div>
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
                    Avoid extra space
                  </div>
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
                  title="Basketball front"
                  tone="good"
                  videoSrc="/crop-guide-jersey-front.mp4"
                  imageAlt="Basketball sando front crop sample video"
                  description="Printable area only. Crop tightly around the front body panel — exclude the armhole openings on both sides, the collar, and all background."
                  tips="Sando has no sleeves, but the armhole cutouts are not printable. Crop only the solid front panel between both armholes, from just below the collar down to the hem."
                />
                <CropGuidePhoto
                  title="T-shirt front"
                  tone="good"
                  videoSrc="/crop-guide-tshirt.mp4"
                  imageAlt="T-shirt front crop sample video"
                  description="Printable area only. Crop the front body panel — do not include the sleeves, collar, or any background."
                  tips="Stop your crop at the sleeve seams on both sides. The sleeves are not part of the printable area. Only the flat front panel between the seams should be selected."
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
              <span>Frame the printable area. Scroll to zoom.</span>
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
