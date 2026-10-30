"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ImageIcon, Sparkles } from "lucide-react";
import WorkspaceZoomControls from "@/components/workspace/WorkspaceZoomControls";
import WorkspaceProcessingLoader from "@/components/workspace/WorkspaceProcessingLoader";
import styles from "./image-tool.module.css";

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 5;

function CanvasArtwork({ src, alt, zoom, onLoad }) {
  const surfaceScale = Math.max(1, zoom);
  const artworkScale = Math.min(1, zoom);
  return (
    <div className={styles.canvasZoomSpace} style={{ width: `${surfaceScale * 100}%`, height: `${surfaceScale * 100}%` }}>
      <div className={styles.canvasArtwork} style={{ width: `${artworkScale * 100}%`, height: `${artworkScale * 100}%` }}>
        <img src={src} alt={alt} draggable={false} onLoad={onLoad} />
      </div>
    </div>
  );
}

export default function ImageToolSplitWorkspace({
  tool,
  previewSurface = "checker",
  sourceUrl,
  resultUrl,
  isProcessing,
  errorMessage,
  onRun,
  canRun,
  noCredits,
  processingStatus,
}) {
  const [zoom, setZoom] = useState(1);
  const [aspectRatio, setAspectRatio] = useState(null);
  const leftScrollRef = useRef(null);
  const rightScrollRef = useRef(null);
  const syncingRef = useRef(false);

  useEffect(() => {
    setZoom(1);
    leftScrollRef.current?.scrollTo({ left: 0, top: 0 });
    rightScrollRef.current?.scrollTo({ left: 0, top: 0 });
  }, [sourceUrl]);

  const clampZoom = useCallback((value) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value)), []);
  const updateZoom = useCallback((value) => setZoom((current) => clampZoom(typeof value === "function" ? value(current) : value)), [clampZoom]);

  const syncScroll = useCallback((source, target) => {
    if (syncingRef.current || !source || !target) return;
    syncingRef.current = true;
    const sourceMaxX = Math.max(1, source.scrollWidth - source.clientWidth);
    const sourceMaxY = Math.max(1, source.scrollHeight - source.clientHeight);
    const targetMaxX = Math.max(0, target.scrollWidth - target.clientWidth);
    const targetMaxY = Math.max(0, target.scrollHeight - target.clientHeight);
    target.scrollLeft = (source.scrollLeft / sourceMaxX) * targetMaxX;
    target.scrollTop = (source.scrollTop / sourceMaxY) * targetMaxY;
    requestAnimationFrame(() => { syncingRef.current = false; });
  }, []);

  const handleWheel = useCallback((event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    updateZoom((current) => current + (event.deltaY < 0 ? 0.25 : -0.25));
  }, [updateZoom]);

  const handleImageLoad = useCallback((event) => {
    const image = event.currentTarget;
    if (image.naturalWidth && image.naturalHeight) setAspectRatio(image.naturalWidth / image.naturalHeight);
  }, []);

  return (
    <section className={styles.splitWorkspace} aria-label={tool.workspaceLabel}>
      <div className={styles.stageToolbar}>
        <div className={styles.stageTools}>
          <span className={styles.sourceState}><i aria-hidden="true" /> {isProcessing ? processingStatus || "Processing" : resultUrl ? "Output ready" : "Source ready"}</span>
          <WorkspaceZoomControls
            zoom={zoom}
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            onZoomOut={() => updateZoom((value) => value - 0.25)}
            onZoomIn={() => updateZoom((value) => value + 0.25)}
            onFit={() => updateZoom(1)}
          />
        </div>
        <div className={styles.singleStage}>
          <span>1. {tool.stageName}</span>
          <i aria-hidden="true" />
        </div>
      </div>

      <div className={styles.canvasPair} style={aspectRatio ? { "--source-aspect": aspectRatio } : undefined} onWheel={handleWheel}>
        <div className={`${styles.canvasPane} ${styles.originalPane}`}>
          <div className={styles.canvasLabel}>Original</div>
          <div
            ref={leftScrollRef}
            className={styles.canvasSurface}
            onScroll={() => syncScroll(leftScrollRef.current, rightScrollRef.current)}
          >
            <CanvasArtwork src={sourceUrl} alt="Original uploaded artwork" zoom={zoom} onLoad={handleImageLoad} />
          </div>
        </div>

        <div className={styles.canvasPane}>
          <div className={`${styles.canvasLabel} ${resultUrl ? styles.readyLabel : ""} ${tool.transparent && resultUrl && previewSurface === "light" ? styles.lightLabel : ""}`}>{tool.canvasOutputLabel}</div>
          <div
            ref={rightScrollRef}
            className={`${styles.canvasSurface} ${tool.transparent && resultUrl ? styles[`surface_${previewSurface}`] : ""}`}
            onScroll={() => syncScroll(rightScrollRef.current, leftScrollRef.current)}
          >
            {resultUrl ? (
              <CanvasArtwork src={resultUrl} alt={tool.transparent ? "Artwork with transparent background" : "Upscaled artwork"} zoom={zoom} />
            ) : isProcessing ? (
              <WorkspaceProcessingLoader
                previewUrl={sourceUrl}
                label={tool.loadingTitle}
                detail={processingStatus || tool.loadingDetail}
                stageCount={1}
                stageLabels={[tool.modeName]}
                className={styles.outputLoader}
              />
            ) : (
              <div className={styles.outputPlaceholder}>
                <span className={`${styles.placeholderIcon} ${errorMessage ? styles.errorIcon : ""}`}><ImageIcon size={18} /></span>
                <strong>{errorMessage ? tool.interruptedLabel : tool.placeholderTitle}</strong>
                <p>{errorMessage || tool.placeholderDetail}</p>
                <button type="button" onClick={onRun} disabled={!canRun}>
                  <Sparkles size={13} /> {noCredits ? "Get more Claws" : errorMessage ? tool.retryLabel : tool.runLabel}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
