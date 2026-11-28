"use client";

import { memo, useState, useRef, useCallback, useEffect, useLayoutEffect } from "react";
import { ArrowRightIcon as ArrowRight, CheckCircleIcon as CheckCircle2, CrosshairIcon as Crosshair, HandIcon as Hand, InfoIcon as Info, CircleNotchIcon as Loader2, CornersOutIcon as Maximize, MinusIcon as Minus, PlusIcon as Plus, ArrowCounterClockwiseIcon as RotateCcw, ScanIcon as ScanLine, XIcon as X, XCircleIcon as XCircle } from "@phosphor-icons/react/ssr";
import { convertToPixelCrop } from "react-image-crop";
import CropSelectionCanvas from "./CropSelectionCanvas";
import LogoCropGuide from "./LogoCropGuide";
import CropGuideIntro from "./CropGuideIntro";
import logoGuideStyles from "./LogoCropGuide.module.css";
import viewportStyles from "./CropViewport.module.css";
import "react-image-crop/dist/ReactCrop.css";
import { formatUploadLimit, resolveImageUploadLimit } from "@/lib/uploadLimits";
import { safeJson } from "@/lib/safeJson";

// Opens at 90%, not 50%. The crop modal opens automatically right after upload,
// and at 50% the artwork was small enough that users had to zoom in before they
// could frame anything — an extra step on every single project.
const DEFAULT_CROP_ZOOM = 0.9;
const MIN_CROP_ZOOM = 0.35;
const MAX_CROP_ZOOM = 4;
const CROP_ZOOM_FACTOR = 1.25;
const CROP_STAGE_PADDING = 24;


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
  const [cropResetVersion, setCropResetVersion] = useState(0);
  const [completedCrop, setCompletedCrop] = useState(null);
  const [cropError, setCropError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [cropZoom, setCropZoom] = useState(DEFAULT_CROP_ZOOM);
  const [imageSize, setImageSize] = useState(null);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [showCropGuideIntro, setShowCropGuideIntro] = useState(true);
  const [cropTool, setCropTool] = useState("crop");
  const [spaceHeld, setSpaceHeld] = useState(false);
  const imgRef = useRef(null);
  const stageRef = useRef(null);
  const zoomRef = useRef(DEFAULT_CROP_ZOOM);
  const pendingAnchor = useRef(null);
  const panGesture = useRef(null);
  const wheelFrame = useRef(null);
  const wheelDelta = useRef(0);
  const wheelPoint = useRef(null);

  useLayoutEffect(() => {
    if (show) {
      setCropZoom(DEFAULT_CROP_ZOOM);
      zoomRef.current = DEFAULT_CROP_ZOOM;
      pendingAnchor.current = null;
      panGesture.current = null;
      setCropTool("crop");
      setSpaceHeld(false);
      setCropResetVersion(version => version + 1);
      setCompletedCrop(null);
      setCropError("");
      setImageSize(null);
      setShowCropGuideIntro(true);
    }
  }, [show]);

  const handleResetSelection = useCallback(() => {
    setCropResetVersion(version => version + 1);
    setCompletedCrop(null);
    setCropError("");
  }, []);

  const handleCropStart = useCallback(() => {
    setCompletedCrop(null);
    setCropError("");
  }, []);

  const handleCropComplete = useCallback((pixelCrop, percentCrop) => {
    setCompletedCrop(percentCrop);
    setCropError("");
  }, []);

  const handleImageLoad = useCallback(event => {
    const image = event.currentTarget;
    setImageSize(previous => previous?.width === image.naturalWidth && previous?.height === image.naturalHeight
      ? previous
      : { width: image.naturalWidth, height: image.naturalHeight });
  }, []);


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
  const maxZoom = Math.max(MAX_CROP_ZOOM, 4 / fitScale);
  const isPanTool = cropTool === "hand" || spaceHeld;

  const setZoomKeepingPoint = useCallback((nextZoom, anchorPoint) => {
    const stage = stageRef.current;
    const previousZoom = zoomRef.current;
    const zoomValue = clamp(
      typeof nextZoom === "function" ? nextZoom(previousZoom) : nextZoom,
      MIN_CROP_ZOOM,
      maxZoom
    );

    if (!stage || Math.abs(zoomValue - previousZoom) < 0.001) {
      setCropZoom(zoomValue);
      return;
    }

    const stageRect = stage.getBoundingClientRect();
    const imageRect = imgRef.current?.getBoundingClientRect();
    const clientX = anchorPoint?.clientX ?? stageRect.left + stage.clientWidth / 2;
    const clientY = anchorPoint?.clientY ?? stageRect.top + stage.clientHeight / 2;
    if (imageRect?.width && imageRect?.height) {
      pendingAnchor.current = {
        x: clamp((clientX - imageRect.left) / imageRect.width, 0, 1),
        y: clamp((clientY - imageRect.top) / imageRect.height, 0, 1), clientX, clientY,
      };
    }
    zoomRef.current = zoomValue;
    setCropZoom(zoomValue);
  }, [maxZoom]);

  // Apply scroll correction after React lays out the resized image, before
  // paint. Anchor to image coordinates, never to changing scrollbar extents.
  useLayoutEffect(() => {
    const anchor = pendingAnchor.current;
    const stage = stageRef.current;
    const image = imgRef.current;
    if (!anchor || !stage || !image) return;
    const rect = image.getBoundingClientRect();
    stage.scrollLeft += rect.left + rect.width * anchor.x - anchor.clientX;
    stage.scrollTop += rect.top + rect.height * anchor.y - anchor.clientY;
    pendingAnchor.current = null;
  }, [displayWidth, displayHeight]);

  const setZoomKeepingCenter = useCallback((nextZoom) => {
    setZoomKeepingPoint(nextZoom);
  }, [setZoomKeepingPoint]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !show) return;

    const handleWheel = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (isSaving || !e.deltaY) return;
      // Accumulate trackpad events instead of dropping them or treating each
      // tiny delta as a full mouse-wheel notch. One layout update per frame.
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? stage.clientHeight : 1;
      wheelDelta.current += e.deltaY * unit;
      wheelPoint.current = { clientX: e.clientX, clientY: e.clientY };
      if (wheelFrame.current !== null) return;
      wheelFrame.current = requestAnimationFrame(() => {
        wheelFrame.current = null;
        const delta = clamp(wheelDelta.current, -400, 400);
        wheelDelta.current = 0;
        setZoomKeepingPoint(z => z * Math.exp(-delta * 0.002), wheelPoint.current);
      });
    };

    stage.addEventListener("wheel", handleWheel, { passive: false, capture: true });
    return () => {
      stage.removeEventListener("wheel", handleWheel, true);
      if (wheelFrame.current !== null) cancelAnimationFrame(wheelFrame.current);
      wheelFrame.current = null;
      wheelDelta.current = 0;
    };
  }, [setZoomKeepingPoint, show, isSaving]);

  useEffect(() => {
    if (!show) return;
    const onKeyDown = event => {
      if (event.target.closest?.('input, textarea, select, button, [contenteditable="true"]') || event.ctrlKey || event.metaKey || event.altKey || showCropGuideIntro || isSaving) return;
      if (event.code === "Space") { event.preventDefault(); setSpaceHeld(true); }
      if (event.key.toLowerCase() === "h") setCropTool("hand");
      if (event.key.toLowerCase() === "c") setCropTool("crop");
      if (event.key === "+" || event.key === "=") { event.preventDefault(); setZoomKeepingCenter(z => z * CROP_ZOOM_FACTOR); }
      if (event.key === "-") { event.preventDefault(); setZoomKeepingCenter(z => z / CROP_ZOOM_FACTOR); }
      if (event.key === "0") { event.preventDefault(); setZoomKeepingCenter(1); }
      if (event.key === "1") { event.preventDefault(); setZoomKeepingCenter(1 / fitScale); }
    };
    const release = () => { setSpaceHeld(false); panGesture.current = null; stageRef.current?.removeAttribute("data-panning"); };
    const onKeyUp = event => { if (event.code === "Space") release(); };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", release);
    return () => { window.removeEventListener("keydown", onKeyDown); window.removeEventListener("keyup", onKeyUp); window.removeEventListener("blur", release); };
  }, [show, showCropGuideIntro, isSaving, fitScale, setZoomKeepingCenter]);

  const handlePanStart = event => {
    if (isSaving || !(event.button === 1 || (event.button === 0 && isPanTool))) return;
    event.preventDefault();
    event.stopPropagation();
    const stage = stageRef.current;
    stage.setPointerCapture(event.pointerId);
    stage.dataset.panning = "true";
    panGesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, left: stage.scrollLeft, top: stage.scrollTop };
  };
  const handlePanMove = event => {
    const pan = panGesture.current;
    if (!pan || event.pointerId !== pan.id) return;
    event.preventDefault();
    event.stopPropagation();
    stageRef.current.scrollLeft = pan.left - (event.clientX - pan.x);
    stageRef.current.scrollTop = pan.top - (event.clientY - pan.y);
  };
  const handlePanEnd = event => {
    const stage = stageRef.current;
    if (panGesture.current?.id !== event.pointerId) return;
    panGesture.current = null;
    stage.removeAttribute("data-panning");
    if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
  };

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
  const isPatternMode = project?.trace_type === 'pattern';

  return (
    <div className="modal-overlay crop-workspace-overlay" translate="no">
      {showCropGuideIntro && <CropGuideIntro mode={isLogoMode ? "logo" : isPatternMode ? "pattern" : "garment"} onContinue={() => setShowCropGuideIntro(false)} />}
      <div inert={showCropGuideIntro} className={`crop-workspace-modal ${isPatternMode ? "is-pattern-workspace" : isLogoMode ? `is-logo-workspace ${logoGuideStyles.workspace}` : "is-garment-workspace"}`}>
        <div className="crop-workspace-header">
          <div className="crop-workspace-title">
            <div className="crop-tool-mark">
              <Crosshair size={17} />
            </div>
            <div>
              <div className="crop-title-line">
                <h3>Crop artwork</h3>
                <span>{isPatternMode ? "Prepare the exact retrace canvas" : isLogoMode ? "Isolate the complete mark" : "Isolate one printable garment panel"}</span>
              </div>
            </div>
          </div>
          <button className="crop-close-btn" onClick={onClose} aria-label="Close crop modal" disabled={isSaving}>
            <X size={16} />
          </button>
        </div>

        <div className="crop-workspace-body">
          <div className="crop-canvas-panel">
            <div className={`crop-canvas-toolbar ${viewportStyles.toolbar}`}>
              <div className="crop-source-meta">
                <ScanLine size={14} />
                <div>
                  <strong>Source Image</strong>
                  <span>{sourceMetaLabel}</span>
                </div>
              </div>
              <div className="crop-toolbar-right">
                <span>{cropSizeLabel}</span>
                <div className={viewportStyles.tools} role="group" aria-label="Crop canvas tools">
                  <button type="button" onClick={() => setCropTool("crop")} aria-label="Crop tool" aria-pressed={cropTool === "crop"} title="Crop (C)"><Crosshair size={15} /></button>
                  <button type="button" onClick={() => setCropTool("hand")} aria-label="Pan tool" aria-pressed={cropTool === "hand"} title="Hand (H) · Hold Space to pan"><Hand size={15} /></button>
                </div>
                <div className={`crop-zoom-controls ${viewportStyles.controls}`} role="group" aria-label="Crop zoom controls">
                  <button type="button" onClick={handleResetSelection} aria-label="Reset selection" title="Clear crop selection">
                    <RotateCcw size={12} />
                  </button>
                  <button type="button" onClick={() => setZoomKeepingCenter(z => z / CROP_ZOOM_FACTOR)} aria-label="Zoom out" title="Zoom out (−)" disabled={cropZoom <= MIN_CROP_ZOOM}>
                    <Minus size={12} />
                  </button>
                  <button type="button" className={viewportStyles.percentage} onClick={() => setZoomKeepingCenter(1 / fitScale)} aria-label="Actual size, 100 percent" title="Actual pixels (1)"><strong>{Math.round(fitScale * cropZoom * 100)}%</strong></button>
                  <button type="button" onClick={() => setZoomKeepingCenter(z => z * CROP_ZOOM_FACTOR)} aria-label="Zoom in" title="Zoom in (+)" disabled={cropZoom >= maxZoom}>
                    <Plus size={12} />
                  </button>
                  <button type="button" className={viewportStyles.fit} onClick={() => setZoomKeepingCenter(1)} aria-label="Fit image" title="Fit image (0)">
                    <Maximize size={12} />
                    <span>Fit</span>
                  </button>
                </div>
              </div>
            </div>
            <div className={`crop-canvas-stage ${viewportStyles.stage} ${isSaving ? "is-saving" : ""}`} ref={stageRef}
              tabIndex={0} aria-label="Crop canvas. Scroll to zoom. Hold Space and drag to pan."
              data-tool={isPanTool ? "hand" : "crop"}
              onPointerDownCapture={handlePanStart} onPointerMoveCapture={handlePanMove}
              onPointerUpCapture={handlePanEnd} onPointerCancel={handlePanEnd} onLostPointerCapture={handlePanEnd}
              onAuxClick={event => { if (event.button === 1) event.preventDefault(); }}>
              <div
                className="crop-zoom-surface"
                style={{
                  width: displayWidth ? `${displayWidth}px` : "1px",
                  height: displayHeight ? `${displayHeight}px` : "1px",
                  marginLeft: `${surfaceOffsetX}px`,
                  marginTop: `${surfaceOffsetY}px`,
                }}
              >
                <CropSelectionCanvas
                  imageRef={imgRef}
                  sourceUrl={`/api/proxy?url=${encodeURIComponent(project.original_image_url)}`}
                  displayWidth={displayWidth}
                  displayHeight={displayHeight}
                  imageReady={Boolean(imageSize)}
                  resetVersion={cropResetVersion}
                  onImageLoad={handleImageLoad}
                  onCropStart={handleCropStart}
                  onCropComplete={handleCropComplete}
                />
              </div>
            </div>
          </div>

          <aside className={`crop-guide-panel ${isLogoMode ? logoGuideStyles.panel : !isPatternMode ? "is-garment-guide" : ""}`}>
            <div className="crop-guide-header">
              <span>Guide</span>
              <strong>{isLogoMode ? "Logo Mode" : isPatternMode ? "Pattern Workspace" : "Garment Mode"}</strong>
            </div>
            {isPatternMode ? (
              <>
                <div className="crop-guide-card is-good">
                  <div className="crop-guide-label">
                    <CheckCircle2 size={14} />
                    Exact artwork boundary
                  </div>
                  <p>Include the complete flat pattern while keeping the crop close to its intended canvas edges.</p>
                  <div className="crop-pattern-guide-preview" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </div>
                </div>
                <div className="crop-guide-card is-bad">
                  <div className="crop-guide-label">
                    <XCircle size={14} />
                    Exclude surrounding space
                  </div>
                  <p>Do not include scanner margins, desk surfaces, shadows, or unrelated objects outside the artwork.</p>
                </div>
              </>
            ) : isLogoMode ? (
              <LogoCropGuide />
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
              <span>Scroll to zoom · Space + drag to pan · 0 to fit · 1 for actual size</span>
            </div>
          </div>
          {project?.generated_image_url && (
            <button className="btn-secondary crop-secondary-action" onClick={onClose} disabled={isSaving}>Cancel</button>
          )}
          <button
            type="button"
            className="crop-secondary-action crop-reset-action"
            disabled={isSaving}
            onClick={() => { handleResetSelection(); setZoomKeepingCenter(DEFAULT_CROP_ZOOM); }}
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
                {isPatternMode ? "Apply Crop & Retrace" : "Apply Crop & Extract"}
                <ArrowRight size={14} />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
});

export default CropModal;
