"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { MAX_SELECTION_POINTS, MAX_SELECTION_SHAPES, MAX_STROKE_POINTS, nextSelectionShapes, selectionPointCount, shapeSvg } from "@/lib/artworkEdits";
import { moveRectangle, resizeRectangle, selectionBounds } from "./selectionGeometry";
import styles from "./ArtworkEditor.module.css";
import { instructionStatus } from "./instructionState";
import ArtworkComparison from "./ArtworkComparison";

const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const cursors = { nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize", n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize" };

export default function ArtworkEditCanvas({ source, instructions, activeId, onCompose, onInteractionStart, onShapes, onLimit, tool, brushSize, zoom, disabled, compare, result, focusRequest, onImageSize, conflictingIds }) {
  const viewport = useRef(null);
  const image = useRef(null);
  const gesture = useRef(null);
  const frame = useRef(null);
  const rectanglePreview = useRef(null);
  const [size, setSize] = useState({ width: 1, height: 1 });
  const [available, setAvailable] = useState({ width: 800, height: 600 });
  const [draft, setDraft] = useState(null);
  useEffect(() => {
    const node = viewport.current;
    const observer = new ResizeObserver(() => setAvailable({ width: node.clientWidth, height: node.clientHeight }));
    observer.observe(node);
    return () => { observer.disconnect(); cancelAnimationFrame(frame.current); node.closest('[role="dialog"]')?.removeAttribute("data-artwork-drawing"); };
  }, []);
  const fit = Math.max(.001, Math.min((available.width - 80) / size.width, (available.height - 80) / size.height, 1));
  const width = Math.max(1, size.width * fit * zoom);
  const height = Math.max(1, size.height * fit * zoom);
  const ratio = size.height / size.width;
  const active = instructions.find(item => item.id === activeId);
  const point = event => {
    const rect = gesture.current?.imageBounds || image.current.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)), y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)) };
  };
  const capture = event => {
    event.preventDefault(); event.stopPropagation();
    viewport.current.setPointerCapture(event.pointerId);
    viewport.current.closest('[role="dialog"]')?.setAttribute("data-artwork-drawing", "true");
    onInteractionStart?.();
  };
  const start = event => {
    if (event.button !== 0 || disabled) return;
    if (event.target.closest("button,input")) return;
    if (tool === "pan") {
      capture(event);
      gesture.current = { pan: true, x: event.clientX, y: event.clientY, left: viewport.current.scrollLeft, top: viewport.current.scrollTop };
      return;
    }
    if (result || !active) return;
    if (tool !== "rectangle" && (active.shapes.length >= MAX_SELECTION_SHAPES || selectionPointCount(instructions) >= MAX_SELECTION_POINTS)) {
      onLimit?.("Selection limit reached. Undo or clear an area before adding more brush strokes."); return;
    }
    capture(event);
    const p = point(event);
    gesture.current = { start: p, imageBounds: image.current.getBoundingClientRect(), shapes: active.shapes, maxPoints: Math.min(MAX_STROKE_POINTS, MAX_SELECTION_POINTS - selectionPointCount(instructions)), shape: tool === "rectangle" ? { kind: "rect", x: p.x, y: p.y, width: 0, height: 0 } : { kind: "brush", radius: brushSize / 200, points: [p], erase: tool === "erase" } };
    setDraft(gesture.current.shape);
  };
  const transform = (event, rectangle, handle) => {
    if (event.button !== 0 || disabled || result || tool !== "rectangle") return;
    capture(event);
    gesture.current = { shapes: active.shapes, shape: { ...rectangle }, original: rectangle, handle, imageBounds: image.current.getBoundingClientRect(), start: point(event) };
    setDraft({ ...rectangle });
  };
  const shapesFor = (shapes, shape, transforming) => transforming ? shapes.map(item => item.kind === "rect" ? shape : item) : nextSelectionShapes(shapes, shape);
  const move = event => {
    const current = gesture.current; if (!current) return;
    if (current.pan) { viewport.current.scrollLeft = current.left - (event.clientX - current.x); viewport.current.scrollTop = current.top - (event.clientY - current.y); return; }
    const p = point(event);
    if (current.original) current.shape = current.handle === "move" ? moveRectangle(current.original, current.start, p) : resizeRectangle(current.original, current.handle, p);
    else if (current.shape.kind === "rect") current.shape = { kind: "rect", x: Math.min(p.x, current.start.x), y: Math.min(p.y, current.start.y), width: Math.abs(p.x - current.start.x), height: Math.abs(p.y - current.start.y) };
    else if (current.shape.points.length < current.maxPoints) {
      const last = current.shape.points.at(-1);
      if (Math.hypot(p.x - last.x, p.y - last.y) > .002) current.shape = { ...current.shape, points: [...current.shape.points, p] };
    } else current.limited = true;
    if (!frame.current) frame.current = requestAnimationFrame(() => {
      frame.current = null;
      if (current.shape.kind !== "rect") { setDraft({ ...current.shape }); return; }
      // Only the tiny transient layer changes during a rectangle gesture.
      // React, saved masks, and instruction data update on pointer-up.
      const preview = rectanglePreview.current;
      if (!preview) return;
      preview.style.display = "block";
      for (const rect of preview.children) {
        rect.setAttribute("x", current.shape.x * 1000);
        rect.setAttribute("y", current.shape.y * ratio * 1000);
        rect.setAttribute("width", current.shape.width * 1000);
        rect.setAttribute("height", current.shape.height * ratio * 1000);
      }
    });
  };
  const finish = (event, cancel = false) => {
    const current = gesture.current; gesture.current = null; cancelAnimationFrame(frame.current); frame.current = null; setDraft(null);
    if (rectanglePreview.current) rectanglePreview.current.style.display = "none";
    viewport.current.closest('[role="dialog"]')?.removeAttribute("data-artwork-drawing");
    if (viewport.current.hasPointerCapture(event.pointerId)) viewport.current.releasePointerCapture(event.pointerId);
    if (!current || current.pan || cancel) return;
    if (current.shape.kind === "rect" && (current.shape.width < .002 || current.shape.height < .002)) return;
    const changed = !current.original || ["x", "y", "width", "height"].some(key => current.original[key] !== current.shape[key]);
    if (changed) onShapes(activeId, shapesFor(current.shapes, current.shape, current.original));
    if (current.limited) onLimit?.("Brush limit reached. Use shorter strokes, or undo and simplify the selection.");
    onCompose?.(activeId);
  };
  const visibleShapes = item => item.id === activeId && draft ? shapesFor(item.shapes, draft, gesture.current?.original) : item.shapes;
  const activeBounds = active ? selectionBounds(visibleShapes(active), ratio) : null;
  const handleSize = 7 * 1000 / width;
  const handleTarget = 18 * 1000 / width;
  useLayoutEffect(() => {
    if (!focusRequest || !image.current) return;
    const stage = viewport.current, picture = image.current.getBoundingClientRect(), bounds = stage.getBoundingClientRect();
    stage.scrollTo({
      left: stage.scrollLeft + picture.left - bounds.left + (focusRequest.bounds.x + focusRequest.bounds.width / 2) * picture.width - stage.clientWidth / 2,
      top: stage.scrollTop + picture.top - bounds.top + (focusRequest.bounds.y + focusRequest.bounds.height / 2) * picture.height - stage.clientHeight / 2,
      behavior: "instant",
    });
  }, [focusRequest, width, height]);

  return <div className={styles.stage} ref={viewport} data-artwork-viewport onPointerMove={move} onPointerUp={finish} onPointerCancel={event => finish(event, true)} onPointerDown={tool === "pan" ? start : undefined} style={{ cursor: tool === "pan" ? "grab" : undefined }}>
    <div className={styles.surface}>
      <div className={styles.artboard} data-rectangle-drag={draft?.kind === "rect"} style={{ width, height }}>
        <img ref={image} src={`/api/proxy?url=${encodeURIComponent(source)}`} alt="Artwork to edit" draggable="false" onLoad={event => { const dimensions = { width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight }; setSize(dimensions); onImageSize?.(dimensions); }} />
        {result && <ArtworkComparison key={result} result={result} compare={compare} />}
        {!result && <svg className={styles.selectionLayer} data-interacting={Boolean(draft) || disabled} viewBox={`0 0 1000 ${ratio * 1000}`} aria-label="Draw editing areas" style={{ cursor: tool === "pan" ? "grab" : "crosshair" }} onPointerDown={start}>
          <defs>{instructions.map(item => <mask id={`edit-selection-${item.id}`} key={item.id} maskUnits="userSpaceOnUse" x="0" y="0" width="1000" height={ratio * 1000} style={{ maskType: "luminance" }}>
            <rect width="1000" height={ratio * 1000} fill="black" />
            <g dangerouslySetInnerHTML={{ __html: visibleShapes(item).map(shape => shapeSvg(shape, 1000, ratio * 1000)).join("") }} />
          </mask>)}</defs>
          {instructions.map(item => <rect key={item.id} data-live-selection={item.id === activeId} width="1000" height={ratio * 1000} mask={`url(#edit-selection-${item.id})`} fill={item.id === activeId ? "rgba(255,255,255,.055)" : "rgba(255,255,255,.02)"} pointerEvents="none" />)}
          {instructions.map(item => {
            const rectangle = visibleShapes(item).find(shape => shape.kind === "rect");
            if (!rectangle) return null;
            const isActive = item.id === activeId;
            const rect = { x: rectangle.x * 1000, y: rectangle.y * ratio * 1000, width: rectangle.width * 1000, height: rectangle.height * ratio * 1000 };
            return <g key={item.id} pointerEvents="none" data-live-selection={isActive} data-conflict={conflictingIds?.has(item.id)} data-selection-outline={item.id}>
              <rect {...rect} fill="none" stroke="#08090a" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
              <rect {...rect} className={styles.marchingOutline} fill="none" stroke="#ffffff" strokeWidth="1" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
              {isActive && !disabled && tool === "rectangle" && <rect {...rect} data-selection-move={item.id} fill="transparent" pointerEvents="all" style={{ cursor: "move" }} onPointerDown={event => transform(event, rectangle, "move")} />}
              {isActive && !disabled && tool === "rectangle" && HANDLES.map(handle => {
                const x = rect.x + (handle.includes("w") ? 0 : handle.includes("e") ? rect.width : rect.width / 2);
                const y = rect.y + (handle.includes("n") ? 0 : handle.includes("s") ? rect.height : rect.height / 2);
                return <g key={handle}>
                  <rect x={x - handleSize / 2} y={y - handleSize / 2} width={handleSize} height={handleSize} rx={handleSize / 4} fill="#f4f4f1" stroke="#08090a" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                  <rect data-selection-handle={handle} x={x - handleTarget / 2} y={y - handleTarget / 2} width={handleTarget} height={handleTarget} fill="transparent" pointerEvents="all" style={{ cursor: cursors[handle] }} onPointerDown={event => transform(event, rectangle, handle)} />
                </g>;
              })}
            </g>;
          })}
        </svg>}
        {!result && <svg ref={rectanglePreview} className={`${styles.selectionLayer} ${styles.rectanglePreview}`} data-rectangle-preview viewBox={`0 0 1000 ${ratio * 1000}`} aria-hidden="true" style={{ display: "none" }}>
          <rect fill="rgba(255,255,255,.055)" stroke="#08090a" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
          <rect fill="none" stroke="#ffffff" strokeWidth="1" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
        </svg>}
        {!result && instructions.map(item => {
          const bounds = selectionBounds(visibleShapes(item), ratio); if (!bounds) return null;
          return <button key={item.id} data-selection-pin={item.id} className={`${styles.pin} ${activeId === item.id ? styles.activePin : ""}`} style={{ left: `${Math.min(85, bounds.x * 100)}%`, top: `${Math.max(0, bounds.y * 100)}%` }} onClick={() => onCompose?.(item.id)} disabled={disabled} aria-label={`Edit instruction ${item.id}`}><span>{String(item.id).padStart(2, "0")}</span>· {activeId === item.id ? "Editing" : instructionStatus(item)}</button>;
        })}
        {!result && activeBounds && <span className={styles.selectionSize} style={{ left: `${Math.min(80, activeBounds.x * 100)}%`, top: `${Math.min(100, (activeBounds.y + activeBounds.height) * 100)}%` }}>{Math.round(activeBounds.width * size.width)} × {Math.round(activeBounds.height * size.height)} px</span>}
      </div>
    </div>
  </div>;
}
