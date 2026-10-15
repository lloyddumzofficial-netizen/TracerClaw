function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Resolve one drag gesture into matching scroll positions for two canvases.
 * The source pane follows the pointer in pixels; the linked pane follows the
 * same normalized artwork position even when its scrollable size differs.
 */
export function calculateSynchronizedPan({
  sourceStartLeft,
  sourceStartTop,
  deltaX,
  deltaY,
  sourceMaxLeft,
  sourceMaxTop,
  linkedMaxLeft,
  linkedMaxTop,
}) {
  const sourceLeft = clamp(sourceStartLeft - deltaX, 0, Math.max(0, sourceMaxLeft));
  const sourceTop = clamp(sourceStartTop - deltaY, 0, Math.max(0, sourceMaxTop));
  const progressX = sourceMaxLeft > 0 ? sourceLeft / sourceMaxLeft : 0;
  const progressY = sourceMaxTop > 0 ? sourceTop / sourceMaxTop : 0;

  return {
    source: { left: sourceLeft, top: sourceTop },
    linked: {
      left: progressX * Math.max(0, linkedMaxLeft),
      top: progressY * Math.max(0, linkedMaxTop),
    },
  };
}

/**
 * Keep zoom represented exactly once. Above 100%, the scroll surface grows and
 * the artwork fills it. Below 100%, the surface stays stable while the artwork
 * shrinks in its center. This avoids multiplying two independent zoom layers.
 */
export function calculateZoomLayerSize(zoom) {
  const safeZoom = Math.max(0, zoom);
  return {
    scrollPercent: Math.max(100, safeZoom * 100),
    artworkPercent: Math.min(100, safeZoom * 100),
  };
}

/**
 * Fit artwork inside the viewport at 100%, then scale those fitted dimensions.
 * Empty letterbox space is never multiplied, so panning cannot expose a giant
 * artificial gutter around portrait or landscape artwork.
 */
export function calculateFittedArtworkLayout({
  viewportWidth,
  viewportHeight,
  aspectRatio,
  zoom,
  padding = 24,
}) {
  const safeWidth = Math.max(0, viewportWidth);
  const safeHeight = Math.max(0, viewportHeight);
  const safeRatio = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1;
  const safeZoom = Math.max(0, zoom);
  const availableWidth = Math.max(0, safeWidth - padding * 2);
  const availableHeight = Math.max(0, safeHeight - padding * 2);

  let fittedWidth = availableWidth;
  let fittedHeight = fittedWidth / safeRatio;
  if (fittedHeight > availableHeight) {
    fittedHeight = availableHeight;
    fittedWidth = fittedHeight * safeRatio;
  }

  const artworkWidth = fittedWidth * safeZoom;
  const artworkHeight = fittedHeight * safeZoom;
  return {
    surfaceWidth: Math.max(safeWidth, artworkWidth + padding * 2),
    surfaceHeight: Math.max(safeHeight, artworkHeight + padding * 2),
    artworkWidth,
    artworkHeight,
  };
}
