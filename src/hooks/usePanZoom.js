"use client";

import { useRef, useCallback, useEffect } from "react";

/**
 * usePanZoom — All pan/zoom canvas logic extracted into a focused hook.
 * Zero React state — all transforms go directly to DOM via refs.
 */
export function usePanZoom({ showCropModal }) {
  const canvasAreaRef = useRef(null);
  const panRef = useRef(null);
  const pipelineRef = useRef(null);
  const transformRef = useRef({ x: 0, y: 0, scale: 1 });
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const rafPending = useRef(false);
  const activeToolRef = useRef("pointer");

  // Helper: apply transform to DOM without React re-render.
  // Pan uses CSS transform (translate only) on an outer wrapper.
  // Zoom uses CSS `zoom` on the inner pipeline — this forces the
  // browser to re-render at the new scale so images stay crisp
  // instead of being blurry GPU-texture upscales.
  const applyTransform = useCallback((t, animated = false) => {
    const pan = panRef.current;
    const pipeline = pipelineRef.current;
    if (!pan || !pipeline) return;

    if (animated) {
      pan.style.transition = 'transform 0.35s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
      pipeline.style.transition = 'zoom 0.35s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
      setTimeout(() => {
        if (panRef.current) panRef.current.style.transition = '';
        if (pipelineRef.current) pipelineRef.current.style.transition = '';
      }, 380);
    } else {
      pan.style.transition = '';
      pipeline.style.transition = '';
    }

    pan.style.transform = `translate(${t.x}px, ${t.y}px)`;
    pipeline.style.zoom = t.scale;
    transformRef.current = t;
  }, []);

  // Fit pipeline to canvas on load / reset.
  // NOTE: CSS zoom affects scrollWidth/scrollHeight, so we reset zoom to 1
  //       before measuring the pipeline's natural size.
  const fitToScreen = useCallback((animated = true) => {
    const canvas = canvasAreaRef.current;
    const pipeline = pipelineRef.current;
    const pan = panRef.current;
    if (!canvas || !pipeline || !pan) return;

    // Reset zoom & transition temporarily so we can measure natural size
    pipeline.style.transition = '';
    pipeline.style.zoom = 1;
    pan.style.transition = '';
    pan.style.transform = 'translate(0px, 0px)';

    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    const pw = pipeline.scrollWidth;
    const ph = pipeline.scrollHeight;

    const scaleX = (cw - 80) / pw;
    const scaleY = (ch - 80) / ph;
    const scale = Math.min(Math.max(0.2, Math.min(scaleX, scaleY)), 1);
    const x = (cw - pw * scale) / 2;
    const y = (ch - ph * scale) / 2;
    applyTransform({ x, y, scale }, animated);
  }, [applyTransform]);

  const handleWheel = useCallback((e) => {
    if (showCropModal) return;
    e.preventDefault();

    if (rafPending.current) return;
    rafPending.current = true;

    requestAnimationFrame(() => {
      rafPending.current = false;
      const canvas = canvasAreaRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const prev = transformRef.current;
      const rawDelta = e.deltaMode === 1 ? e.deltaY * 20 : e.deltaY;
      const factor = rawDelta > 0 ? 0.92 : 1.0 / 0.92;
      const newScale = Math.min(Math.max(0.1, prev.scale * factor), 5);

      const unscaledX = (mouseX - prev.x) / prev.scale;
      const unscaledY = (mouseY - prev.y) / prev.scale;
      const newX = mouseX - unscaledX * newScale;
      const newY = mouseY - unscaledY * newScale;

      applyTransform({ x: newX, y: newY, scale: newScale });
    });
  }, [showCropModal, applyTransform]);

  // Pan with middle mouse OR left mouse when Hand tool active
  const handlePointerDown = useCallback((e) => {
    const tool = activeToolRef.current;
    if (e.button === 1 || (e.button === 0 && tool === 'hand')) {
      e.preventDefault();
      isDragging.current = true;
      const t = transformRef.current;
      dragStart.current = { x: e.clientX - t.x, y: e.clientY - t.y };
    }
    if (e.button === 0 && tool === 'zoom') {
      e.preventDefault();
      const canvas = canvasAreaRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const prev = transformRef.current;
      const newScale = Math.min(prev.scale * 1.35, 5);
      const unscaledX = (mouseX - prev.x) / prev.scale;
      const unscaledY = (mouseY - prev.y) / prev.scale;
      applyTransform({ x: mouseX - unscaledX * newScale, y: mouseY - unscaledY * newScale, scale: newScale }, true);
    }
  }, [applyTransform]);

  const handlePointerMove = useCallback((e) => {
    if (!isDragging.current) return;
    applyTransform({
      x: e.clientX - dragStart.current.x,
      y: e.clientY - dragStart.current.y,
      scale: transformRef.current.scale,
    });
  }, [applyTransform]);

  const handlePointerUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  // Keyboard shortcuts: F / Space = fit, Escape = 1:1 center
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'f' || e.key === 'F' || e.key === ' ') {
        e.preventDefault();
        fitToScreen(true);
      }
      if (e.key === 'Escape') {
        const canvas = canvasAreaRef.current;
        const pipeline = pipelineRef.current;
        if (!canvas || !pipeline) return;
        const savedZoom = pipeline.style.zoom;
        pipeline.style.zoom = 1;
        const pw = pipeline.scrollWidth;
        const ph = pipeline.scrollHeight;
        pipeline.style.zoom = savedZoom;
        const x = (canvas.clientWidth - pw) / 2;
        const y = (canvas.clientHeight - ph) / 2;
        applyTransform({ x, y, scale: 1 }, true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fitToScreen, applyTransform]);

  // Attach wheel as non-passive via ref to allow preventDefault
  useEffect(() => {
    const el = canvasAreaRef.current;
    if (!el) return;
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  return {
    canvasAreaRef,
    panRef,
    pipelineRef,
    activeToolRef,
    isDragging,
    fitToScreen,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
  };
}
