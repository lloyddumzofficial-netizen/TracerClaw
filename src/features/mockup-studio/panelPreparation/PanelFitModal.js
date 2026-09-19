"use client";

import { useEffect, useRef, useState } from "react";
import { getPanelPreparationSpec } from "./panelSpecs";
import styles from "./panelFitModal.module.css";

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export default function PanelFitModal({ file, role, garmentType, onCancel, onApply }) {
  const spec = getPanelPreparationSpec(garmentType, role);
  const frameRef = useRef(null);
  const imageRef = useRef(null);
  const dragRef = useRef(null);
  const [sourceUrl, setSourceUrl] = useState(null);
  const [imageSize, setImageSize] = useState(null);
  const [frameSize, setFrameSize] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [preparing, setPreparing] = useState(false);
  const [preparationError, setPreparationError] = useState(null);

  useEffect(() => {
    if (!file) return undefined;
    const url = URL.createObjectURL(file);
    setSourceUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    const onKeyDown = event => { if (event.key === "Escape" && !preparing) onCancel(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel, preparing]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return undefined;
    const update = () => setFrameSize({ width: frame.clientWidth, height: frame.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [sourceUrl, spec]);

  if (!file || !spec) return null;

  const baseDisplayScale = imageSize && frameSize ? Math.max(frameSize.width / imageSize.width, frameSize.height / imageSize.height) : 1;
  const imageStyle = imageSize && frameSize ? {
    width: `${imageSize.width * baseDisplayScale}px`,
    height: `${imageSize.height * baseDisplayScale}px`,
    transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px)) scale(${zoom})`,
  } : undefined;

  const constrainOffset = (nextOffset, nextZoom = zoom) => {
    const frame = frameRef.current?.getBoundingClientRect();
    if (!frame || !imageSize) return nextOffset;
    const baseScale = Math.max(frame.width / imageSize.width, frame.height / imageSize.height);
    const displayWidth = imageSize.width * baseScale * nextZoom;
    const displayHeight = imageSize.height * baseScale * nextZoom;
    const maxX = Math.max(0, (displayWidth - frame.width) / 2);
    const maxY = Math.max(0, (displayHeight - frame.height) / 2);
    return { x: clamp(nextOffset.x, -maxX, maxX), y: clamp(nextOffset.y, -maxY, maxY) };
  };

  const updateZoom = value => {
    const nextZoom = Number(value);
    setZoom(nextZoom);
    setOffset(current => constrainOffset(current, nextZoom));
  };

  const onPointerDown = event => {
    if (!imageSize) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { x: event.clientX, y: event.clientY, originX: offset.x, originY: offset.y };
  };

  const onPointerMove = event => {
    if (!dragRef.current) return;
    setOffset(constrainOffset({
      x: dragRef.current.originX + event.clientX - dragRef.current.x,
      y: dragRef.current.originY + event.clientY - dragRef.current.y,
    }));
  };

  const stopDragging = () => { dragRef.current = null; };

  const preparePanel = async () => {
    const frame = frameRef.current?.getBoundingClientRect();
    const image = imageRef.current;
    if (!frame || !image || !imageSize) return;
    setPreparing(true);
    setPreparationError(null);
    try {
      const baseScale = Math.max(frame.width / imageSize.width, frame.height / imageSize.height);
      const scale = baseScale * zoom;
      const displayWidth = imageSize.width * scale;
      const displayHeight = imageSize.height * scale;
      const sourceX = clamp(((displayWidth - frame.width) / 2 - offset.x) / scale, 0, imageSize.width);
      const sourceY = clamp(((displayHeight - frame.height) / 2 - offset.y) / scale, 0, imageSize.height);
      const sourceWidth = Math.min(frame.width / scale, imageSize.width - sourceX);
      const sourceHeight = Math.min(frame.height / scale, imageSize.height - sourceY);
      const canvas = document.createElement("canvas");
      canvas.width = spec.width;
      canvas.height = spec.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Panel preparation is unavailable in this browser.");
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, spec.width, spec.height);
      const outputType = file.type === "image/png" ? "image/png" : "image/webp";
      const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("Could not prepare this panel.")), outputType, .95));
      const extension = outputType === "image/png" ? "png" : "webp";
      await onApply(new File([blob], `${role}-${spec.width}x${spec.height}.${extension}`, { type: outputType, lastModified: Date.now() }));
    } catch (error) {
      setPreparationError(error?.message || "Could not prepare this panel. Please try another image.");
    } finally {
      setPreparing(false);
    }
  };

  return (
    <div className={styles.backdrop} role="presentation">
      <section className={styles.dialog} role="dialog" aria-modal="true" aria-label={`Fit ${spec.label} artwork`}>
        <header><div><span>PANEL PREPARATION</span><h2>Fit {spec.label}</h2></div><button type="button" onClick={onCancel} disabled={preparing}>Close</button></header>
        <div className={styles.body}>
          <div className={styles.workspace}>
            <div className={styles.toolbar}><div><strong>Production frame</strong><span>{spec.width} × {spec.height}px · locked ratio</span></div><label>Zoom<input type="range" min="1" max="3" step="0.01" value={zoom} onChange={event => updateZoom(event.target.value)} /></label><button type="button" onClick={() => { setZoom(1); setOffset({ x: 0, y: 0 }); }}>Reset</button></div>
            <div className={styles.stage}>
              <div ref={frameRef} className={styles.frame} data-orientation={spec.orientation} style={{ aspectRatio: `${spec.width} / ${spec.height}` }} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={stopDragging} onPointerCancel={stopDragging}>
                {sourceUrl ? <img ref={imageRef} src={sourceUrl} alt="Artwork being fitted" draggable="false" onLoad={event => setImageSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} style={imageStyle} /> : null}
                <div className={styles.safeArea} style={{ inset: `${spec.safeInset}%` }}><span>SAFE AREA</span></div>
                <i className={styles.centerLine} />
                <span className={styles.topGuide}>{spec.topGuide}</span><span className={styles.bottomGuide}>{spec.bottomGuide}</span>
                {spec.centerExclusion ? <span className={styles.centerExclusion}>{spec.centerExclusion}</span> : null}
              </div>
            </div>
          </div>
          <aside className={styles.guide}>
            <span>OUTPUT CONTRACT</span><h3>{spec.label}</h3><p>{spec.guidance}</p>
            <dl><div><dt>Exact export</dt><dd>{spec.width} × {spec.height}px</dd></div><div><dt>Safe margin</dt><dd>{spec.safeInset}%</dd></div><div><dt>Format</dt><dd>{file.type === "image/png" ? "PNG" : "WebP"}</dd></div><div><dt>Processing</dt><dd>In your browser</dd></div></dl>
            <div className={styles.rules}><strong>Before applying</strong><p>Move and zoom the artwork until all critical details sit inside the safe area. The outer region may be consumed by seams, cuffs, collar construction, folds, or camera perspective.</p></div>
          </aside>
        </div>
        <footer><p className={preparationError ? styles.error : ""}>{preparationError || "The normalized panel—not the oversized original—is uploaded. This keeps every preview and generated angle on the same geometry."}</p><div><button type="button" onClick={onCancel} disabled={preparing}>Cancel</button><button type="button" className={styles.applyButton} onClick={preparePanel} disabled={!imageSize || preparing}>{preparing ? "Preparing panel…" : "Apply panel"}</button></div></footer>
      </section>
    </div>
  );
}
