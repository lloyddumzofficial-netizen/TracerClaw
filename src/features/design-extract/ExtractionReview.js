"use client";
import { CheckCircle2, Layers3 } from "lucide-react";
import useLayerPagination from "./useLayerPagination";
import LayerPagination from "./LayerPagination";
import styles from "./designExtract.module.css";

export default function ExtractionReview({ job, selectedId, busy, versions = {}, onVersion, onPreview, onAccept, onDiscard }) {
  const layers = job.result?.layers || [];
  const pagination = useLayerPagination(layers);
  const warnings = job.result?.warnings || [];
  const keptOriginal = warnings.filter(warning => warning.includes("original extracted layer was kept")).length;
  const alignmentChanged = warnings.some(warning => warning.includes("aspect ratio"));
  const warningSummary = warnings.length === 1 ? warnings[0] : [
    keptOriginal ? `${keptOriginal} layers kept at original extraction quality.` : "",
    alignmentChanged ? "Check layer alignment before accepting." : "",
  ].filter(Boolean).join(" ") || "Review the generated layers carefully before accepting.";
  return <section className={styles.review} aria-label="Extraction review">
    <div className={styles.reviewHeading}><span className={styles.reviewIcon}><Layers3 size={18} /></span><div><h3>Review extracted layers</h3><p>{layers.length} {layers.length === 1 ? "layer" : "layers"} ready to inspect</p></div></div>
    <p className={styles.reviewDescription}>Your original stays unchanged until you accept.</p>
    {warnings.length > 0 && <p className={styles.reviewWarning} title={warnings.join("\n")} aria-label={warnings.join(" ")} tabIndex={0}><span className={styles.noticeFull}>{warningSummary}</span><span className={styles.noticeShort}>{keptOriginal ? `${keptOriginal} layers kept at original quality.${alignmentChanged ? " Check alignment." : ""}` : "Review alignment: output aspect ratio changed."}</span></p>}
    <div className={`${styles.layerListViewport} ${styles.reviewViewport}`} ref={pagination.viewport}><div className={styles.reviewList}>
      {pagination.items.map(layer => <button key={layer.id} type="button" aria-label={`Preview ${layer.name}`} aria-pressed={selectedId === layer.id} disabled={busy} onClick={() => onPreview(layer)}>
        <span className={styles.reviewThumbnail}><img src={layer.url} alt="" /></span>
        <span className={styles.reviewLayerCopy}><strong>{layer.name}</strong><small>{layer.width} × {layer.height} px</small></span>
        {selectedId === layer.id && <CheckCircle2 size={15} aria-hidden="true" />}
      </button>)}
    </div></div>
    <LayerPagination pagination={pagination} review />
    {layers.filter(layer => layer.baseVariant && layer.id === selectedId).map(layer => <label key={layer.id} className={styles.versionChoice}>{layer.name}<select aria-label={`Version for ${layer.name}`} disabled={busy} value={versions[layer.id] || "enhanced"} onChange={event => onVersion(layer.id, event.target.value)}><option value="base">Base · {layer.baseVariant.width} × {layer.baseVariant.height} px</option><option value="enhanced">Enhanced · enlarged</option></select></label>)}
    <div className={styles.reviewActions}><button disabled={busy || !layers.length} onClick={onAccept}><CheckCircle2 size={14} />Accept layers</button><button disabled={busy} onClick={onDiscard}>Discard result</button></div>
    {layers.some(layer => layer.enhancedVariant) && <small className={styles.reviewFootnote}>Enhanced versions are enlarged; they do not recover original detail. Accepting keeps the selected versions.</small>}
  </section>;
}
