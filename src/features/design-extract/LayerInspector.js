"use client";
import { useState } from "react";
import { SlidersHorizontal, X, LockKeyhole, ArrowUp, ArrowDown, Trash2, Sparkles, Layers3, MousePointer2, Download } from "lucide-react";
import styles from "./designExtract.module.css";
export default function LayerInspector({ layer, view, disabled, segmentMode, onUpdate, onForward, onBackward, onDelete, onSplit, onSegment, onDownload, onClose }) {
  const [tab, setTab] = useState("properties");
  const quality = `Native layer: ${layer.width} × ${layer.height} px. Enlarged to ${Math.round(layer.composition.scale * 100)}% in the composition; enlargement cannot recover lost detail.`;
  return <aside className={styles.inspectorDock} data-design-inspector aria-label="Layer properties" onPointerDown={event => event.stopPropagation()}>
    <header className={styles.inspectorHeading}><h3><SlidersHorizontal size={14} />Layer properties</h3><button type="button" aria-label="Close layer properties" onClick={onClose}><X size={14} /></button></header>
    <div className={styles.inspectorTabs} role="group" aria-label="Inspector tools"><button type="button" aria-pressed={tab === "properties"} onClick={() => setTab("properties")}>Properties</button><button type="button" aria-label="Refine layer" aria-pressed={tab === "refine"} onClick={() => setTab("refine")}>Refine</button><span>{view === "layout" ? "Overview" : "Composition"}</span></div>
    {tab === "properties" ? <div className={styles.properties}>
      <label>Layer name<input value={layer.name} disabled={disabled} onChange={event => onUpdate({ name: event.target.value })} /></label>
      <label className={styles.lockControl}><span><LockKeyhole size={13} />Lock layer</span><input type="checkbox" checked={layer.locked} disabled={disabled} onChange={event => onUpdate({ locked: event.target.checked })} /></label>
      <div className={styles.transformFields}>{["x", "y", "scale"].map(key => <label key={key}><span>{key === "scale" ? "Scale (×)" : `${key.toUpperCase()} position`}</span><input aria-label={`${view === "layout" ? "Overview" : "Composition"} ${key}`} type="number" step={key === "scale" ? .05 : 1} min={key === "scale" ? .01 : -32768} max={key === "scale" ? 20 : 32768} value={Math.round(layer[view][key] * 100) / 100} disabled={disabled || layer.locked} onChange={event => { const value = Number(event.target.value); if (Number.isFinite(value) && (key !== "scale" || value >= .01 && value <= 20)) onUpdate({ [view]: { ...layer[view], [key]: value } }); }} /></label>)}</div>
      <div className={styles.buttons}><button title="Bring forward" disabled={disabled || layer.locked} onClick={onForward}><ArrowUp size={14} />Forward</button><button title="Send backward" disabled={disabled || layer.locked} onClick={onBackward}><ArrowDown size={14} />Backward</button><button aria-label="Delete layer" title="Delete layer" disabled={disabled || layer.locked} onClick={onDelete}><Trash2 size={14} /></button></div>
      {layer.composition.scale > 1.05 && <p className={styles.inspectorQuality} title={quality} aria-label={quality}>{layer.width} × {layer.height} px · {Math.round(layer.composition.scale * 100)}% in composition</p>}
    </div> : <div className={styles.inspectorRefine}><p>Refine <strong>{layer.name}</strong> or cut an element from its original pixels.</p><button disabled={disabled} onClick={onSplit}><Layers3 size={14} />Split further · AI</button><button disabled={disabled} aria-pressed={segmentMode === "layer"} onClick={onSegment}><MousePointer2 size={14} />Extract selected element</button>{segmentMode === "layer" && <p className={styles.inspectorPrompt}><Sparkles size={13} />Click the element inside the selected layer.</p>}</div>}
    <footer><button disabled={disabled} onClick={onDownload}><Download size={14} />Download PNG</button></footer>
  </aside>;
}
