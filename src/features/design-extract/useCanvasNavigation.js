"use client";
import { useCallback, useEffect, useRef, useState } from "react";

const clampZoom = value => Math.max(.05, Math.min(4, value));
const isTyping = target => target instanceof Element && Boolean(target.closest("input, textarea, select, button, summary, [contenteditable='true']"));

export default function useCanvasNavigation(viewport, enabled, layerDrag, reducedMotion = false) {
  const [camera, setCameraState] = useState({ x: 36, y: 54, zoom: .7 });
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [panning, setPanning] = useState(false);
  const current = useRef(camera), goal = useRef(camera), frame = useRef(0), pan = useRef(null), space = useRef(false);
  const zoomAnchor = useRef(null);
  const setCamera = useCallback((next, smooth = true, anchor = null) => {
    zoomAnchor.current = anchor;
    goal.current = { ...next, zoom: clampZoom(next.zoom) };
    if (!smooth || reducedMotion) {
      cancelAnimationFrame(frame.current); frame.current = 0;
      current.current = goal.current; setCameraState(goal.current); return;
    }
    if (frame.current) return;
    let last = performance.now();
    const tick = now => {
      const ease = 1 - Math.exp(-Math.min(now - last, 64) / 55); last = now;
      const from = current.current, to = goal.current;
      const done = Math.abs(to.zoom - from.zoom) < .0001 && Math.abs(to.x - from.x) + Math.abs(to.y - from.y) < .05;
      const zoom = done ? to.zoom : from.zoom + (to.zoom - from.zoom) * ease;
      const pinned = zoomAnchor.current;
      const value = pinned ? { zoom, x: pinned.x - pinned.worldX * zoom, y: pinned.y - pinned.worldY * zoom } : done ? to : { x: from.x + (to.x - from.x) * ease, y: from.y + (to.y - from.y) * ease, zoom };
      current.current = value; setCameraState(value);
      frame.current = done ? 0 : requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }, [reducedMotion]);
  const zoomAt = useCallback((value, point) => {
    const el = viewport.current;
    if (!el) return;
    // Rebase on the visible camera, not a previous animation's destination.
    // This keeps a newly positioned cursor pinned during rapid wheel input.
    const from = current.current, next = clampZoom(typeof value === "function" ? value(goal.current.zoom) : value);
    const anchor = point || { x: el.clientWidth / 2, y: el.clientHeight / 2 };
    const pinned = { ...anchor, worldX: (anchor.x - from.x) / from.zoom, worldY: (anchor.y - from.y) / from.zoom };
    setCamera({ zoom: next, x: pinned.x - pinned.worldX * next, y: pinned.y - pinned.worldY * next }, true, pinned);
  }, [setCamera, viewport]);
  useEffect(() => {
    const el = viewport.current;
    if (!el || !enabled) return;
    const wheel = event => {
      if (event.target instanceof Element && event.target.closest("[data-design-inspector]")) return;
      event.preventDefault(); event.stopPropagation();
      if (pan.current || layerDrag.current) return;
      const rect = el.getBoundingClientRect();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? el.clientHeight : 1);
      zoomAt(value => value * Math.exp(-Math.max(-500, Math.min(500, delta)) * .0015), { x: event.clientX - rect.left, y: event.clientY - rect.top });
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [viewport, enabled, layerDrag, zoomAt]);
  useEffect(() => {
    if (!enabled) return;
    const keydown = event => { if (event.code === "Space" && !isTyping(event.target)) { event.preventDefault(); space.current = true; setSpaceHeld(true); } };
    const keyup = event => { if (event.code === "Space") { space.current = false; setSpaceHeld(false); } };
    const reset = () => { space.current = false; pan.current = null; setSpaceHeld(false); setPanning(false); };
    window.addEventListener("keydown", keydown); window.addEventListener("keyup", keyup); window.addEventListener("blur", reset);
    return () => { window.removeEventListener("keydown", keydown); window.removeEventListener("keyup", keyup); window.removeEventListener("blur", reset); reset(); };
  }, [enabled]);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  const onPointerDownCapture = event => {
    if (!enabled || isTyping(event.target) || event.target.closest("[data-design-inspector]")) return;
    const element = event.target.closest("[data-design-element]");
    if (event.button !== 1 && !(event.button === 0 && (space.current || !element))) {
      if (event.button === 0 && element) setCamera(current.current, false);
      return;
    }
    event.preventDefault(); event.stopPropagation();
    viewport.current.focus({ preventScroll: true });
    setCamera(current.current, false);
    pan.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, camera: current.current };
    viewport.current.setPointerCapture(event.pointerId); setPanning(true);
  };
  const onPointerMoveCapture = event => {
    const start = pan.current;
    if (!start || start.pointerId !== event.pointerId) return;
    event.preventDefault(); event.stopPropagation();
    setCamera({ ...start.camera, x: start.camera.x + event.clientX - start.x, y: start.camera.y + event.clientY - start.y }, false);
  };
  const endPan = event => {
    if (pan.current?.pointerId !== event.pointerId) return;
    event.stopPropagation(); pan.current = null; setPanning(false);
    if (viewport.current.hasPointerCapture(event.pointerId)) viewport.current.releasePointerCapture(event.pointerId);
  };
  return { camera, setCamera, setZoom: zoomAt, spaceHeld, panning, handlers: { onPointerDownCapture, onPointerMoveCapture, onPointerUpCapture: endPan, onPointerCancelCapture: endPan, onLostPointerCapture: endPan } };
}
