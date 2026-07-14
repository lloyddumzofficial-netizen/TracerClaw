"use client";

import { memo, useMemo, useState, useEffect } from "react";
import { ImageIcon, Brain, Scan, PenTool, Scissors } from "lucide-react";
import NodeCard from "./NodeCard";

/** Fetches SVG text and injects inline for reliable cross-browser SVG rendering */
function InlineSVG({ url, style }) {
  const [svgHtml, setSvgHtml] = useState(null);
  useEffect(() => {
    if (!url) { setSvgHtml(null); return; }
    setSvgHtml(null);
    fetch(url)
      .then(r => r.text())
      .then(text => {
        const safe = text
          .replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/\son\w+="[^"]*"/gi, '')
          .replace(/\son\w+='[^']*'/gi, '');
        if (safe.includes('<svg')) {
          const scaled = safe.replace(/<svg([^>]*?)>/i, (_, attrs) => {
            let clean = attrs;
            const wMatch = attrs.match(/\swidth=["']([^"']+)["']/i);
            const hMatch = attrs.match(/\sheight=["']([^"']+)["']/i);
            const vMatch = attrs.match(/\sviewBox=["']([^"']+)["']/i);

            clean = clean.replace(/\s+width=["'][^"']*["']/gi, '')
                         .replace(/\s+height=["'][^"']*["']/gi, '');

            if (!vMatch && wMatch && hMatch) {
              const w = parseFloat(wMatch[1].replace(/px/i, ''));
              const h = parseFloat(hMatch[1].replace(/px/i, ''));
              if (!isNaN(w) && !isNaN(h)) {
                clean += ` viewBox="0 0 ${w} ${h}"`;
              }
            }
            return `<svg${clean} style="width:100%;height:100%;display:block;" preserveAspectRatio="xMidYMid meet">`;
          });
          setSvgHtml(scaled);
        }
      })
      .catch(err => console.error('[InlineSVG] fetch failed:', err));
  }, [url]);
  if (!svgHtml) return null;
  return <div style={{ ...style, overflow: 'hidden' }} dangerouslySetInnerHTML={{ __html: svgHtml }} />;
}

/**
 * PipelineCanvas — The scrollable/pannable canvas that renders all 4 pipeline nodes.
 * memo'd so it only re-renders when project data or traceState changes.
 */
const PipelineCanvas = memo(function PipelineCanvas({
  project,
  traceState,
  nodeErrors,
  panRef,
  pipelineRef,
  onCropOpen,
}) {
  // Derive proxy URLs inside this component — keeps page.js clean
  const proxyOriginal = useMemo(() =>
    project?.original_image_url
      ? `/api/proxy?url=${encodeURIComponent(project.original_image_url)}`
      : null,
    [project?.original_image_url]
  );
  const proxyGenerated = useMemo(() =>
    project?.generated_image_url
      ? `/api/proxy?url=${encodeURIComponent(project.generated_image_url)}`
      : null,
    [project?.generated_image_url]
  );
  const proxyUpscaled = useMemo(() =>
    project?.upscaled_image_url
      ? `/api/proxy?url=${encodeURIComponent(project.upscaled_image_url)}`
      : null,
    [project?.upscaled_image_url]
  );
  const proxySvg = useMemo(() =>
    project?.svg_url
      ? `/api/proxy?url=${encodeURIComponent(project.svg_url)}`
      : null,
    [project?.svg_url]
  );

  const connectorClass = (activeStep, completedUrl) =>
    `elegant-connector ${traceState === activeStep ? "active" : completedUrl ? "completed" : ""}`;

  return (
    /* Pan wrapper: translate only — no scale here */
    <div
      ref={panRef}
      style={{ position: "absolute", top: 0, left: 0, transformOrigin: "0 0", willChange: "transform" }}
    >
      {/* Zoom wrapper: CSS zoom causes crisp browser re-render vs blurry GPU upscale */}
      <div
        ref={pipelineRef}
        className="pipeline-container"
        style={{ zoom: 1, willChange: "zoom", transformOrigin: "0 0" }}
      >

        {/* NODE 1: Reference */}
        <NodeCard
          title="Image Reference"
          icon={<ImageIcon size={12} />}
          footerLeft="Source Upload"
          showOutput
          statusLabel={project.original_image_url ? "● Ready" : "○ Empty"}
          statusColor={project.original_image_url ? "#4ade80" : "#555"}
          errorMessage={nodeErrors?.step1 && traceState === "idle" ? null : undefined}
          headerActions={
            traceState === "idle" ? (
              <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
                <button className="icon-btn-small" onClick={onCropOpen} title="Crop Region">
                  <Scissors size={12} />
                </button>
              </div>
            ) : null
          }
        >
          {project.original_image_url ? (
            <img
              src={proxyOriginal}
              alt="Reference"
              style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "4px" }}
              referrerPolicy="no-referrer"
              decoding="async"
            />
          ) : (
            <div className="placeholder-node">Image not found</div>
          )}
        </NodeCard>

        {/* CONNECTOR 1 */}
        <div className={connectorClass("step1", project.generated_image_url)}>
          <div className="elegant-arrow" />
        </div>

        {/* NODE 2: Gemini Neural Extractor */}
        <NodeCard
          title="DesaynVision™ Neural Extractor v3.0"
          icon={<Brain size={12} />}
          footerLeft="Gemini 3 Pro"
          showInput
          showOutput
          isDimmed={!project.generated_image_url && traceState === "idle"}
          isActiveStep={traceState === "step1"}
          loadingLabel="Generating Image..."
          errorMessage={nodeErrors?.step1 ?? null}
          statusLabel={traceState === "step1" ? "▶ Processing..." : project.generated_image_url ? "✓ Complete" : "○ Pending"}
          statusColor={traceState === "step1" ? "var(--accent)" : project.generated_image_url ? "#4ade80" : "#555"}
        >
          {project.generated_image_url ? (
            <img
              src={proxyGenerated}
              alt="Generated Raster"
              style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "4px" }}
              referrerPolicy="no-referrer"
              decoding="async"
            />
          ) : traceState === "step1" && proxyOriginal ? (
            <img
              src={proxyOriginal}
              alt="Preview"
              style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "4px", filter: "grayscale(100%)" }}
              referrerPolicy="no-referrer"
              decoding="async"
            />
          ) : (
            <div className="placeholder-node">Awaiting Execution</div>
          )}
        </NodeCard>

        {/* CONNECTOR 2 */}
        <div className={connectorClass("step2", project.upscaled_image_url)}>
          <div className="elegant-arrow" />
        </div>

        {/* NODE 3: Recraft Upscaler */}
        <NodeCard
          title="ClawScale™ Ultra-Res Matrix"
          icon={<Scan size={12} />}
          footerLeft="Recraft Upscale"
          showInput
          showOutput
          isDimmed={!project.upscaled_image_url && traceState !== "step2"}
          isActiveStep={traceState === "step2"}
          loadingLabel="Upscaling Image..."
          errorMessage={nodeErrors?.step2 ?? null}
          statusLabel={traceState === "step2" ? "▶ Processing..." : project.upscaled_image_url ? "✓ Complete" : "○ Pending"}
          statusColor={traceState === "step2" ? "var(--accent)" : project.upscaled_image_url ? "#4ade80" : "#555"}
        >
          {project.upscaled_image_url ? (
            <img
              src={proxyUpscaled}
              alt="Upscaled Raster"
              style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "4px" }}
              referrerPolicy="no-referrer"
              decoding="async"
            />
          ) : traceState === "step2" && proxyGenerated ? (
            <img
              src={proxyGenerated}
              alt="Preview"
              style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "4px", filter: "grayscale(100%)" }}
              referrerPolicy="no-referrer"
              decoding="async"
            />
          ) : (
            <div className="placeholder-node">Awaiting Execution</div>
          )}
        </NodeCard>

        {/* CONNECTOR 3 */}
        <div className={connectorClass("step3", project.svg_url)}>
          <div className="elegant-arrow" />
        </div>

        {/* NODE 4: Recraft Vectorizer */}
        <NodeCard
          title="TrueVector™ Auto-Bezier Core"
          icon={<PenTool size={12} />}
          footerLeft="Recraft Vectorizer"
          showInput
          isDimmed={!project.svg_url && traceState !== "step3"}
          isActiveStep={traceState === "step3"}
          loadingLabel="Converting to Vector..."
          errorMessage={nodeErrors?.step3 ?? null}
          statusLabel={traceState === "step3" ? "▶ Processing..." : project.svg_url ? "✓ Complete" : "○ Pending"}
          statusColor={traceState === "step3" ? "var(--accent)" : project.svg_url ? "#4ade80" : "#555"}
        >
          {project.svg_url ? (
            <InlineSVG
              url={proxySvg}
              style={{ width: "100%", height: "100%", borderRadius: "4px", display: "flex", alignItems: "center", justifyContent: "center" }}
            />
          ) : traceState === "step3" && proxyUpscaled ? (
            <img
              src={proxyUpscaled}
              alt="Preview"
              style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "4px", filter: "grayscale(100%)" }}
              referrerPolicy="no-referrer"
              decoding="async"
            />
          ) : (
            <div className="placeholder-node">Awaiting Execution</div>
          )}
        </NodeCard>

      </div>
    </div>
  );
});

export default PipelineCanvas;
