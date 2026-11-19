"use client";
import { useLayoutEffect, useRef } from "react";
import { artworkBounds, boardElementBounds, frameArtwork } from "./editorGeometry";

// Fit validated documents using the measured canvas, never a fixed zoom.
// Resize follows the automatic view only until the user changes the camera.
export default function useOpeningFrame({ enabled, frameKey, viewport, guide, layers, view, source, camera, setCamera }) {
  const latest = useRef(null);
  latest.current = { layers, source, camera };
  useLayoutEffect(() => {
    if (!enabled || !viewport.current) return;
    const element = viewport.current;
    let lastAutomatic = null, manual = false, pending = 0;
    const fit = () => {
      const current = latest.current;
      if (lastAutomatic && (Math.abs(current.camera.x - lastAutomatic.x) > .1 || Math.abs(current.camera.y - lastAutomatic.y) > .1 || Math.abs(current.camera.zoom - lastAutomatic.zoom) > .001)) manual = true;
      if (manual || element.clientWidth < 100 || element.clientHeight < 100) return;
      const guideBounds = view === "layout" ? boardElementBounds(guide?.current) : null;
      const bounds = artworkBounds(current.layers, view, current.source, [guideBounds]);
      const next = frameArtwork(bounds, { width: element.clientWidth, height: element.clientHeight - (guideBounds ? 96 : 0) }, view === "layout" ? 4 : 1);
      if (next) { lastAutomatic = next; setCamera(next, false); }
    };
    const schedule = () => { cancelAnimationFrame(pending); pending = requestAnimationFrame(fit); };
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    if (guide?.current) observer.observe(guide.current);
    fit();
    return () => { observer.disconnect(); cancelAnimationFrame(pending); };
  }, [enabled, frameKey, viewport, guide, view, setCamera]);
}
