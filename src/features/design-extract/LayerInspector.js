"use client";
import { useState } from "react";
import { SlidersHorizontal, X, LockKeyhole, ArrowUp, ArrowDown, Trash2, Sparkles, Layers3, MousePointer2, Download, PenTool, Loader2, Scan, CheckCircle2 } from "lucide-react";
import styles from "./designExtract.module.css";
import FeatureBadges from "./FeatureBadges";
import { layerUpscaleAvailability } from "@/lib/designExtractUpscalePolicy";
export default function LayerInspector({ refinement = false, layer, view, disabled, pending = false, acceptPreview, downloadDisabled = disabled, segmentMode, splitPriceLabel = "", segmentPriceLabel = "", upscaling = false, onUpscale, convertingSvg = false, svgReady = false, onConvertSvg, onUpdate, onForward, onBackward, onDelete, onSplit, onSegment, onMask, onVersion, onDownload, onClose }) {
  const [tab, setTab] = useState("properties");
  const raster = layer.kind !== "svg";
  const upscale = layerUpscaleAvailability(layer);
  const quality = `Native layer: ${layer.width} × ${layer.height} px. Enlarged to ${Math.round(layer.composition.scale * 100)}% in the composition; enlargement cannot recover lost detail.`;
  const svgAction = <button disabled={disabled} onClick={onConvertSvg} aria-busy={convertingSvg} title={svgReady ? "Download saved SVG" : "Advanced feature · Included"}>
    <span className={styles.layerActionContent}>{convertingSvg ? <Loader2 size={14} className={styles.spinner} /> : svgReady ? <Download size={14} /> : <PenTool size={14} />}
    <span>{convertingSvg ? "Converting to SVG…" : svgReady ? "Download SVG" : "Convert to SVG"}</span></span>
    {!convertingSvg && !svgReady && <FeatureBadges />}
  </button>;
  const downloadButton = <button type="button" disabled={downloadDisabled} onClick={onDownload}><span className={styles.layerActionContent}><Download size={14} /><span>{raster ? "Download PNG" : "Download PNG preview"}</span></span></button>;
  return <aside className={styles.inspectorDock} data-design-inspector aria-label="Layer properties" onPointerDown={event => event.stopPropagation()}>
    <header className={styles.inspectorHeading}><h3><SlidersHorizontal size={14} />Layer properties{!raster && <span className={styles.svgBadge}>SVG</span>}</h3><button type="button" aria-label="Close layer properties" onClick={onClose}><X size={14} /></button></header>
    {pending ? <>
      <div className={styles.inspectorRefine}>
        <strong>{layer.name}</strong>
        <p>{layer.width} × {layer.height} px</p>
        <p>{acceptPreview ? "Accept the reviewed layers to edit, upscale, or convert this artwork." : "Editing tools become available after the layers are saved."}</p>
      </div>
      <footer className={styles.layerDownloads}>
        <section aria-label="Preview actions">
          {acceptPreview && <button type="button" onClick={acceptPreview.onClick} disabled={downloadDisabled}><CheckCircle2 size={14} />{acceptPreview.label}</button>}
          {downloadButton}
        </section>
      </footer>
    </> : <>
    <div className={styles.inspectorTabs} role="group" aria-label="Inspector tools"><button type="button" aria-pressed={tab === "properties"} onClick={() => setTab("properties")}>Properties</button>{!refinement && <button type="button" aria-label="Refine layer" aria-pressed={tab === "refine"} onClick={() => setTab("refine")} disabled={!raster}>Refine</button>}<span>{view === "layout" ? "Overview" : "Composition"}</span></div>
    {tab === "properties" || !raster ? <div className={styles.properties}>
      <label>Layer name<input value={layer.name} disabled={disabled} onChange={event => onUpdate({ name: event.target.value })} /></label>
      <label className={styles.lockControl}><span><LockKeyhole size={13} />Lock layer</span><input type="checkbox" checked={layer.locked} disabled={disabled} onChange={event => onUpdate({ locked: event.target.checked })} /></label>
      <div className={styles.transformFields}>{["x", "y", "scale"].map(key => <label key={key}><span>{key === "scale" ? "Scale (×)" : `${key.toUpperCase()} position`}</span><input aria-label={`${view === "layout" ? "Overview" : "Composition"} ${key}`} type="number" step={key === "scale" ? .05 : 1} min={key === "scale" ? .01 : -32768} max={key === "scale" ? 20 : 32768} value={Math.round(layer[view][key] * 100) / 100} disabled={disabled || layer.locked} onChange={event => { const value = Number(event.target.value); if (Number.isFinite(value) && (key !== "scale" || value >= .01 && value <= 20)) onUpdate({ [view]: { ...layer[view], [key]: value } }); }} /></label>)}</div>
      <div className={styles.buttons}><button title="Bring forward" disabled={disabled || layer.locked} onClick={onForward}><ArrowUp size={14} />Forward</button><button title="Send backward" disabled={disabled || layer.locked} onClick={onBackward}><ArrowDown size={14} />Backward</button><button aria-label="Delete layer" title="Delete layer" disabled={disabled || layer.locked} onClick={onDelete}><Trash2 size={14} /></button></div>
      {!raster && <p className={styles.inspectorQuality}>{layer.vector?.psdMode === "raster" ? "SVG · Exports to PSD as pixels" : "SVG · Scalable vector paths"}</p>}
      <p className={styles.inspectorQuality} title={raster && layer.composition.scale > 1.05 ? quality : undefined}>{layer.width} × {layer.height} px{raster && layer.composition.scale > 1.05 && ` · ${Math.round(layer.composition.scale * 100)}% in composition`}</p>
    </div> : <div className={styles.inspectorRefine}><p>Refine <strong>{layer.name}</strong> or cut an element from its original pixels.</p><button disabled={disabled} onClick={onSplit}><Layers3 size={14} />Split further · AI{splitPriceLabel}</button><button disabled={disabled} aria-pressed={segmentMode === "layer"} onClick={onSegment}><MousePointer2 size={14} />Extract selected element{segmentPriceLabel}</button>{segmentMode === "layer" && <p className={styles.inspectorPrompt}><Sparkles size={13} />Click the element inside the selected layer.</p>}</div>}
    {raster && <div className={styles.inspectorRefine}><button disabled={disabled || layer.locked} onClick={onMask}>Refine mask</button>{layer.baseVariant && <label>Artwork version<select aria-label="Artwork version" disabled={disabled || layer.locked} value={layer.acceptedVersion || "enhanced"} onChange={event => onVersion(event.target.value)}><option value="base">Base · native extraction</option>{layer.enhancedVariant && <option value="enhanced">Enhanced · enlarged</option>}{layer.maskedVariant && <option value="mask">Accepted mask edit</option>}</select></label>}</div>}
    <footer className={styles.layerDownloads}>
      {(raster || !svgReady) && <section aria-label="Layer actions"><h4>Actions</h4>
        {raster && <>
          <button disabled={disabled || layer.locked || !upscale.plan} aria-busy={upscaling} aria-describedby="layer-upscale-details" onClick={onUpscale} title={upscale.reason}><span className={styles.layerActionContent}>{upscaling ? <Loader2 size={14} className={styles.spinner} /> : <Scan size={14} />}<span>{upscaling ? "Upscaling image…" : upscale.label}</span></span>{!upscaling && upscale.plan && <FeatureBadges />}</button>
          <p id="layer-upscale-details" className={styles.upscaleDetails}>{upscale.reason}</p>
        </>}
        {!svgReady && svgAction}
      </section>}
      <section aria-label="Layer downloads"><h4>Download</h4>
        {svgReady && svgAction}
        {downloadButton}
      </section>
    </footer>
    </>}
  </aside>;
}
