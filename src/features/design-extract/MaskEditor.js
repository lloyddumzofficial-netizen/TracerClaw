"use client";
import { useEffect, useRef, useState } from "react";
import { maskAsset } from "@/lib/designExtractVariants";
import { edgeCleanupSettings } from "@/lib/designEdgeCleanup";
import { packMaskCoverage, unpackMaskCoverage, maskHistoryLimit } from './maskHistory';
import { CircleNotchIcon as Loader2 } from "@phosphor-icons/react/ssr";
import styles from "./designExtract.module.css";

export default function MaskEditor({ layer, view, camera, fetchAsset, onApply, onDiscard, busy }) {
  const preview = useRef(null), coverage = useRef(null), source = useRef(null), stroke = useRef(null);
  const history = useRef({ past: [], future: [] });
  const cleanupWorker = useRef(null), requestId = useRef(0);
  const workerBusy = useRef(false), pendingPreview = useRef(null);
  const [ready, setReady] = useState(false), [error, setError] = useState(""), [tool, setTool] = useState("erase");
  const [size, setSize] = useState(40), [softness, setSoftness] = useState(layer.edgeCleanup ? layer.edgeSoftness || 0 : 0), [version, setVersion] = useState(0);
  const [cleanup, setCleanup] = useState(() => edgeCleanupSettings(layer.edgeCleanup));
  const [before, setBefore] = useState(false), [previewBusy, setPreviewBusy] = useState(false), [previewFailed, setPreviewFailed] = useState(false);
  const cleanupEnabled = Boolean(cleanup.defringe || cleanup.specks);
  const asset = maskAsset(layer), frame = asset.frame, scale = layer[view].scale * layer.width / asset.width;
  const paintPreview = (bounds = { x: 0, y: 0, width: frame.width, height: frame.height }) => {
    const id = ++requestId.current;
    if (cleanupEnabled && !stroke.current) bounds = { x: 0, y: 0, width: frame.width, height: frame.height };
    const canvas = preview.current;
    if (!canvas || !source.current || !coverage.current) return;
    const context = canvas.getContext("2d"), pixels = new ImageData(bounds.width, bounds.height);
    for (let y = 0; y < bounds.height; y++) {
      const offset = ((bounds.y + y) * frame.width + bounds.x) * 4;
      pixels.data.set(source.current.data.subarray(offset, offset + bounds.width * 4), y * bounds.width * 4);
    }
    let maskCanvas = coverage.current;
    if (softness) {
      maskCanvas = document.createElement("canvas"); maskCanvas.width = bounds.width; maskCanvas.height = bounds.height;
      const filtered = maskCanvas.getContext("2d");
      filtered.fillStyle = "black"; filtered.fillRect(0, 0, bounds.width, bounds.height);
      filtered.filter = `blur(${softness}px)`; filtered.drawImage(coverage.current, -bounds.x, -bounds.y);
    }
    const mask = maskCanvas.getContext("2d").getImageData(softness ? 0 : bounds.x, softness ? 0 : bounds.y, bounds.width, bounds.height).data;
    for (let i = 0; i < mask.length; i += 4) pixels.data[i + 3] = Math.round(pixels.data[i + 3] * mask[i] / 255);
    if (cleanupEnabled && !before && !stroke.current) {
      if (!cleanupWorker.current) {
        cleanupWorker.current = new Worker(new URL("./edgeCleanup.worker.js", import.meta.url));
        cleanupWorker.current.onmessage = ({ data }) => {
          workerBusy.current = false;
          if (pendingPreview.current) {
            const pending = pendingPreview.current; pendingPreview.current = null;
            workerBusy.current = true;
            cleanupWorker.current.postMessage(pending, [pending.pixels]);
          }
          if (data.id !== requestId.current || !preview.current) return;
          setPreviewBusy(false);
          if (data.error) { setPreviewFailed(true); setError(data.error); return; }
          setPreviewFailed(false);
          preview.current.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(data.pixels), frame.width, frame.height), 0, 0);
        };
        cleanupWorker.current.onerror = () => { workerBusy.current = false; pendingPreview.current = null; setPreviewBusy(false); setPreviewFailed(true); setError("Edge preview unavailable. Reopen Refine mask to retry."); };
      }
      setPreviewBusy(true);
      const message = { id, pixels: pixels.data.buffer, width: frame.width, height: frame.height, settings: cleanup };
      if (workerBusy.current) pendingPreview.current = message;
      else { workerBusy.current = true; cleanupWorker.current.postMessage(message, [message.pixels]); }
    } else { pendingPreview.current = null; setPreviewBusy(false); context.putImageData(pixels, bounds.x, bounds.y); }
  };
  useEffect(() => { if (ready) paintPreview(); }, [softness, ready, cleanup, before]);
  useEffect(() => {
    let live = true;
    const bitmaps = [];
    (async () => {
      try {
        const blobs = await Promise.all([fetchAsset(layer.id, "mask-source"), fetchAsset(layer.id, "mask-base")]);
        const images = await Promise.all(blobs.map(blob => createImageBitmap(blob))); bitmaps.push(...images);
        if (!live) return;
        if (images.some(image => image.width !== frame.width || image.height !== frame.height)) throw new Error("Native artwork dimensions do not match this mask.");
        const scratch = document.createElement("canvas"); scratch.width = frame.width; scratch.height = frame.height;
        const context = scratch.getContext("2d", { willReadFrequently: true });
        context.drawImage(images[0], 0, 0); source.current = context.getImageData(0, 0, frame.width, frame.height);
        context.clearRect(0, 0, frame.width, frame.height); context.drawImage(images[1], 0, 0);
        const initial = context.getImageData(0, 0, frame.width, frame.height);
        for (let i = 0; i < initial.data.length; i += 4) {
          const alpha = source.current.data[i + 3];
          const value = alpha ? Math.min(255, Math.round(initial.data[i + 3] / alpha * 255)) : 0;
          initial.data[i] = initial.data[i + 1] = initial.data[i + 2] = value; initial.data[i + 3] = 255;
        }
        context.putImageData(initial, 0, 0); coverage.current = scratch;
        paintPreview(); setReady(true);
      } catch (err) { if (live) setError(err.message); }
      finally { bitmaps.forEach(image => image.close()); }
    })();
    return () => { live = false; requestId.current++; cleanupWorker.current?.terminate(); cleanupWorker.current = null; workerBusy.current = false; pendingPreview.current = null; source.current = null; coverage.current = null; };
    // The immutable editing frame is fixed for this component's lifetime.
  }, []);
  const snapshot = () => packMaskCoverage(coverage.current.getContext("2d").getImageData(0, 0, frame.width, frame.height).data);
  const travel = direction => {
    if (!ready || busy) return;
    const from = history.current[direction === "undo" ? "past" : "future"], to = history.current[direction === "undo" ? "future" : "past"];
    if (!from.length) return;
    const previous = from.pop();
    to.push(snapshot()); coverage.current.getContext("2d").putImageData(new ImageData(unpackMaskCoverage(previous), frame.width, frame.height), 0, 0); paintPreview(); setVersion(value => value + 1);
  };
  const draw = event => {
    if (!stroke.current) return;
    const rect = preview.current.getBoundingClientRect();
    const point = { x: (event.clientX - rect.left) / rect.width * frame.width, y: (event.clientY - rect.top) / rect.height * frame.height };
    const context = coverage.current.getContext("2d"), previous = stroke.current.point || point;
    context.lineWidth = size; context.lineCap = "round"; context.strokeStyle = tool === "restore" ? "white" : "black";
    context.beginPath(); context.moveTo(previous.x, previous.y); context.lineTo(point.x + .001, point.y); context.stroke();
    const radius = size / 2 + softness * 3 + 2;
    const left = Math.max(0, Math.floor(Math.min(previous.x, point.x) - radius)), top = Math.max(0, Math.floor(Math.min(previous.y, point.y) - radius));
    const right = Math.min(frame.width, Math.ceil(Math.max(previous.x, point.x) + radius)), bottom = Math.min(frame.height, Math.ceil(Math.max(previous.y, point.y) + radius));
    stroke.current.point = point;
    if (right > left && bottom > top) paintPreview({ x: left, y: top, width: right - left, height: bottom - top });
  };
  return <div data-design-mask-tool onKeyDown={event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); event.stopPropagation(); travel(event.shiftKey ? "redo" : "undo"); }
    if (event.key === "Escape") { event.stopPropagation(); onDiscard(); }
  }}>
    <div className={styles.maskControls} data-design-inspector aria-label="Mask editing tools" data-version={version}>
      <strong>Refine mask</strong><small>{frame.width} × {frame.height} px · Native artwork</small>
      {error && <p role="alert">{error}</p>}
      {!ready && !error && <p role="status"><Loader2 size={14} className={styles.spinner} /> Loading native artwork…</p>}
      <div><button aria-pressed={tool === "restore"} onClick={() => setTool("restore")}>Restore</button><button aria-pressed={tool === "erase"} onClick={() => setTool("erase")}>Erase</button></div>
      <label>Brush size · {size} px<input aria-label="Brush size" type="range" min="1" max="500" value={size} onChange={event => setSize(Number(event.target.value))} /></label>
      <label>Edge softness · {softness} px<input aria-label="Edge softness" type="range" min="0" max="20" step=".5" value={softness} onChange={event => setSoftness(Number(event.target.value))} /></label>
      <details className={styles.edgeCleanup} open={cleanupEnabled || undefined}>
        <summary>Clean edges</summary>
        <small>Reduce edge halos and isolated pixels. Preview before applying.</small>
        <label>Defringe · {cleanup.defringe} px<input aria-label="Defringe" type="range" min="0" max="3" step="1" value={cleanup.defringe} disabled={busy} onChange={event => { setBefore(false); setCleanup(value => ({ ...value, defringe: Number(event.target.value) })); }} /></label>
        <label>Remove specks<select aria-label="Remove specks" value={cleanup.specks} disabled={busy} onChange={event => { setBefore(false); setCleanup(value => ({ ...value, specks: Number(event.target.value) })); }}><option value="0">Off</option><option value="4">Up to 4 pixels</option><option value="16">Up to 16 pixels</option></select></label>
        <div><button aria-pressed={before} disabled={!cleanupEnabled || busy} onClick={() => setBefore(true)}>Before</button><button aria-pressed={!before} disabled={!cleanupEnabled || busy} onClick={() => setBefore(false)}>After</button></div>
        {previewBusy && <small role="status"><Loader2 size={12} className={styles.spinner} /> Updating preview…</small>}
      </details>
      <div><button disabled={busy || !history.current.past.length} onClick={() => travel("undo")}>Undo mask</button><button disabled={busy || !history.current.future.length} onClick={() => travel("redo")}>Redo mask</button></div>
      <div><button className={styles.applyMaskAction} disabled={!ready || busy || previewBusy || previewFailed || Boolean(stroke.current)} onClick={async () => {
        try {
          setError("");
          const blob = await new Promise(resolve => coverage.current.toBlob(resolve, "image/png"));
          if (!blob) throw new Error("Could not encode the mask");
          await onApply(blob, softness, cleanup);
        } catch (err) { setError(err.message); }
      }}>{busy && <Loader2 size={14} className={styles.spinner} />}{busy ? "Applying mask…" : "Apply mask"}</button><button disabled={busy} onClick={onDiscard}>Discard changes</button></div>
    </div>
    <canvas ref={preview} data-design-element="mask" tabIndex={0} aria-label="Mask brush canvas" width={frame.width} height={frame.height} className={styles.maskCanvas}
      style={{ left: camera.x + (layer[view].x - frame.left * scale) * camera.zoom, top: camera.y + (layer[view].y - frame.top * scale) * camera.zoom, width: frame.width * scale * camera.zoom, height: frame.height * scale * camera.zoom }}
      onPointerDown={event => {
        if (!ready || busy || event.button !== 0) return;
        event.preventDefault(); event.stopPropagation(); event.currentTarget.focus({ preventScroll: true }); event.currentTarget.setPointerCapture(event.pointerId);
        history.current.past.push(snapshot());
        const limit = maskHistoryLimit(frame.width, frame.height);
        while (history.current.past.length > limit) history.current.past.shift();
        history.current.future = []; stroke.current = {}; draw(event);
      }} onPointerMove={draw} onPointerUp={() => { stroke.current = null; paintPreview(); setVersion(value => value + 1); }} onPointerCancel={() => { stroke.current = null; paintPreview(); setVersion(value => value + 1); }} />
  </div>;
}
