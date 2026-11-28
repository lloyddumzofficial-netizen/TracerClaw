"use client";
import { useState } from "react";
import { CheckCircleIcon as CheckCircle2, StackIcon as Layers3 } from "@phosphor-icons/react/ssr";
import useLayerPagination from "./useLayerPagination";
import LayerPagination from "./LayerPagination";
import styles from "./designExtract.module.css";

export default function ExtractionReview({ job, selectedId, busy, versions = {}, onVersion, onPreview, onAccept, onDiscard, background, onBackground, onRefine, onReset, onGroup, onWand, onRegroup, onRestoreSuggestions, replaceSavedLayers }) {
  const layers = job.result?.layers || [];
  const [grouping, setGrouping] = useState(false);
  const [checked, setChecked] = useState([]);
  const selected = layers.find(layer => layer.id === selectedId && !layer.remainder);
  const hasCorrections = job.qualityReview;
  const missing = job.result?.missing || [];
  const pagination = useLayerPagination(layers);
  const warnings = job.result?.warnings || [];
  const keptOriginal = warnings.filter(warning => warning.includes("original extracted layer was kept")).length;
  const alignmentChanged = warnings.some(warning => warning.includes("aspect ratio"));
  const warningSummary = warnings.length === 1 ? warnings[0] : [
    keptOriginal ? `${keptOriginal} layers kept at original extraction quality.` : "",
    alignmentChanged ? "Check layer alignment before accepting." : "",
  ].filter(Boolean).join(" ") || "Review the generated layers carefully before accepting.";
  const shortWarning = [
    keptOriginal ? `${keptOriginal} layers kept at original quality.` : "",
    alignmentChanged ? "Check alignment." : "",
  ].filter(Boolean).join(" ") || "Review extraction notes.";
  return <section className={styles.review} aria-label="Extraction review">
    <div className={styles.reviewHeading}><span className={styles.reviewIcon}><Layers3 size={18} /></span><div><h3>Review extracted layers</h3><p>{layers.length} {layers.length === 1 ? "layer" : "layers"} ready to inspect</p></div></div>
    <p className={styles.reviewDescription}>{job.whiteElements ? "Check spelling, shapes, and edges against your original." : job.automaticSeparation ? "Review your extracted artwork." : job.guided ? "Review the transparent cutout and the filled background." : job.result?.groupedByColor ? "Matching ink colors are grouped together." : "Your original stays unchanged until you accept."}</p>
    {warnings.length > 0 && <p className={styles.reviewWarning} title={warnings.join("\n")} aria-label={warnings.join(" ")} tabIndex={0}><span className={styles.noticeFull}>{warningSummary}</span><span className={styles.noticeShort}>{shortWarning}</span></p>}
    {missing.length > 0 && <p className={styles.reviewWarning}>Needs review · {missing.join(", ")} {job.automaticSeparation ? "could not be separated." : "stayed in Remaining artwork."}</p>}
    {layers.some(layer => layer.guidedBackground && layer.needsReview) && <p className={styles.reviewWarning}>The filled background may still contain graphics that could not be separated.</p>}
    {hasCorrections && <div className={styles.reviewTools}>
      <div role="group" aria-label="Edge preview background">
        <button type="button" disabled={busy} aria-pressed={background === "dark"} onClick={() => onBackground("dark")}>Dark</button>
        <button type="button" disabled={busy} aria-pressed={background === "light"} onClick={() => onBackground("light")}>Light</button>
      </div>
      {grouping ? <div>
        <button type="button" disabled={busy || checked.length < 2} onClick={async () => { if (await onGroup(checked)) { setChecked([]); setGrouping(false); } }}>Group selected</button>
        <button type="button" disabled={busy} onClick={() => { setChecked([]); setGrouping(false); }}>Cancel</button>
      </div> : <div>
        <button type="button" disabled={busy || !selected} onClick={() => onRefine(selected)}>Refine mask</button>
        <button type="button" disabled={busy} onClick={onWand}>Color Wand</button>
        <button type="button" disabled={busy || layers.filter(layer => !layer.remainder).length < 2} onClick={() => setGrouping(true)}>Group fragments</button>
        {onRegroup && <button type="button" disabled={busy} onClick={onRegroup}>Group by color</button>}
        {onRestoreSuggestions && <button type="button" disabled={busy} onClick={onRestoreSuggestions}>Restore original cutouts</button>}
        {selected?.reviewBase && <button type="button" disabled={busy} onClick={() => onReset(selected.id)}>Reset mask</button>}
      </div>}
    </div>}
    <div className={`${styles.layerListViewport} ${styles.reviewViewport}`} ref={pagination.viewport}><div className={styles.reviewList}>
      {pagination.items.map(layer => <button key={layer.id} type="button" aria-label={`${grouping ? "Group" : "Preview"} ${layer.name}`} aria-pressed={grouping ? checked.includes(layer.id) : selectedId === layer.id} disabled={busy || (grouping && layer.remainder)} onClick={() => grouping ? setChecked(current => current.includes(layer.id) ? current.filter(id => id !== layer.id) : [...current, layer.id]) : onPreview(layer)}>
        <span className={styles.reviewThumbnail}><img src={layer.url} alt="" /></span>
        <span className={styles.reviewLayerCopy}><strong>{layer.name}</strong><small>{layer.width} × {layer.height} px</small>{layer.needsReview && <small className={styles.reviewAttention}>Needs review</small>}</span>
        {(grouping ? checked.includes(layer.id) : selectedId === layer.id) && <CheckCircle2 size={15} aria-hidden="true" />}
      </button>)}
    </div></div>
    <LayerPagination pagination={pagination} review />
    {layers.filter(layer => layer.baseVariant && layer.id === selectedId).map(layer => <label key={layer.id} className={styles.versionChoice}>{layer.name}<select aria-label={`Version for ${layer.name}`} disabled={busy} value={versions[layer.id] || "enhanced"} onChange={event => onVersion(layer.id, event.target.value)}><option value="base">Base · {layer.baseVariant.width} × {layer.baseVariant.height} px</option><option value="enhanced">Enhanced · enlarged</option></select></label>)}
    <div className={styles.reviewActions}>
      <button disabled={busy || grouping || !layers.length} onClick={onAccept}><CheckCircle2 size={14} />{replaceSavedLayers ? "Replace saved layers" : "Accept layers"}</button>
      <button disabled={busy} onClick={onDiscard}>Discard result</button>
    </div>
    {layers.some(layer => layer.enhancedVariant) && <small className={styles.reviewFootnote}>Enhanced versions are enlarged; they do not recover original detail. Accepting keeps the selected versions.</small>}
  </section>;
}
