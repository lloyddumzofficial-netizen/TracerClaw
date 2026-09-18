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

async function uploadCropThroughServer({ token, blob, fileName }) {
  const formData = new FormData();
  formData.append("file", blob, fileName);
  formData.append("purpose", "standard");

  const response = await fetch("/api/upload-direct", {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}` },
    body: formData,
  });
  const data = await safeJson(response, "Fallback crop upload failed");

  if (!response.ok || !data.publicUrl) {
    throw new Error(data.error || "Fallback crop upload failed");
  }

  return data.publicUrl;
}

async function uploadCropToStorage({ token, blob }) {
  const fileName = `crop_${Date.now()}.jpg`;
  const urlRes = await fetch("/api/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
    body: JSON.stringify({
      fileName,
      contentType: "image/jpeg",
      fileSize: blob.size,
      purpose: "standard",
    }),
  });
  const urlData = await safeJson(urlRes, "Failed to get upload URL");
  if (!urlRes.ok || !urlData.uploadUrl) throw new Error(urlData.error || "Failed to get upload URL");

  try {
    const putRes = await fetch(urlData.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "image/jpeg" },
      body: blob,
    });
    if (!putRes.ok) throw new Error("Failed to upload crop to storage");
    return urlData.publicUrl;
  } catch (error) {
    console.warn("Direct crop upload failed, retrying through server:", error);
    return uploadCropThroughServer({ token, blob, fileName });
  }
}

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

      const croppedImageUrl = await uploadCropToStorage({ token, blob });

      const res = await fetch("/api/crop", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}` // Required: route now verifies auth
        },
        body: JSON.stringify({ projectId: project.id, croppedImageUrl }),
      });
      const data = await safeJson(res, "Failed to save crop");
      if (!res.ok) throw new Error(data.error);

      onCropApplied?.(croppedImageUrl);
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
                  <p>Keep the frame close to the outermost artwork.</p>
                  <svg className="crop-logo-guide-svg" viewBox="0 0 256 112" role="img" aria-label="Tight logo crop example">
                    <defs>
                      <pattern id="logoGuideGridGood" width="16" height="16" patternUnits="userSpaceOnUse">
                        <path d="M16 0H0V16" fill="none" stroke="rgba(255,255,255,.025)" />
                      </pattern>
                    </defs>
                    <rect width="256" height="112" fill="#0c0d0e" />
                    <rect width="256" height="112" fill="url(#logoGuideGridGood)" />
                    <text x="218" y="17" textAnchor="end" fill="rgba(74,222,128,.72)" fontSize="7" fontWeight="700" letterSpacing="1.2">CORRECT</text>
                    <rect x="31" y="25" width="194" height="57" fill="rgba(74,222,128,.025)" stroke="rgba(74,222,128,.82)" strokeWidth="1.25" strokeDasharray="4 4" />
                    <g className="crop-logo-guide-art">
                      <rect x="46" y="39" width="29" height="29" rx="6" fill="#ffd700" />
                      <path d="M56 62V46h8c6 0 10 3 10 8s-4 8-10 8h-8zm6-5h2c2 0 4-1 4-3s-2-3-4-3h-2v6z" fill="#080808" />
                      <text x="83" y="60" fill="#f5f5f5" fontSize="16" fontWeight="700" letterSpacing=".8">DESAYN</text>
                      <text x="151" y="60" fill="#ffd700" fontSize="17" fontWeight="600" fontStyle="italic">Claw</text>
                    </g>
                    <g fill="#4ade80">
                      <path d="M27 21h12v3h-9v9h-3zM229 21h-12v3h9v9h3zM27 86h12v-3h-9v-9h-3zM229 86h-12v-3h9v-9h3z" />
                    </g>
                    <text x="128" y="99" textAnchor="middle" fill="rgba(255,255,255,.42)" fontSize="8" fontWeight="600" letterSpacing="1.1">MINIMAL EDGE SPACE</text>
                  </svg>
                </div>
                <div className="crop-guide-card is-bad">
                  <div className="crop-guide-label">
                    <XCircle size={14} />
                    Avoid extra space
                  </div>
                  <p>Remove blank margins before generating the SVG.</p>
                  <svg className="crop-logo-guide-svg is-bad-sample" viewBox="0 0 256 112" role="img" aria-label="Logo crop with too much empty space example">
                    <defs>
                      <pattern id="logoGuideGridBad" width="16" height="16" patternUnits="userSpaceOnUse">
                        <path d="M16 0H0V16" fill="none" stroke="rgba(255,255,255,.025)" />
                      </pattern>
                    </defs>
                    <rect width="256" height="112" fill="#0c0d0e" />
                    <rect width="256" height="112" fill="url(#logoGuideGridBad)" />
                    <text x="218" y="17" textAnchor="end" fill="rgba(255,91,91,.7)" fontSize="7" fontWeight="700" letterSpacing="1.2">AVOID</text>
                    <g className="crop-logo-guide-art is-muted">
                      <rect x="91" y="43" width="22" height="22" rx="5" fill="#ffd700" />
                      <path d="M99 59V48h6c4 0 7 2 7 6s-3 6-7 6h-6zm5-4h1c2 0 3 0 3-2s-1-2-3-2h-1v4z" fill="#080808" />
                      <text x="120" y="58" fill="#f5f5f5" fontSize="12" fontWeight="700" letterSpacing=".7">DESAYN</text>
                    </g>
                    <rect x="24" y="23" width="208" height="61" fill="rgba(255,91,91,.018)" stroke="rgba(255,91,91,.75)" strokeWidth="1.25" strokeDasharray="4 4" />
                    <g stroke="rgba(255,91,91,.52)" strokeWidth="1">
                      <path d="M35 54h46M175 54h46" strokeDasharray="2 3" />
                    </g>
                    <g fill="#ff5b5b">
                      <path d="M20 19h12v3h-9v9h-3zM236 19h-12v3h9v9h3zM20 88h12v-3h-9v-9h-3zM236 88h-12v-3h9v-9h3z" />
                    </g>
                    <text x="128" y="99" textAnchor="middle" fill="rgba(255,255,255,.38)" fontSize="8" fontWeight="600" letterSpacing="1.1">EXCESS EMPTY SPACE</text>
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
