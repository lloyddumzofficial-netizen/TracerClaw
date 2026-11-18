"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { createClient } from "@/utils/supabase/client";
import StudioShell from "@/components/shared/StudioShell";
import ExtractionProgress from "./ExtractionProgress";
import ExtractionReview from "./ExtractionReview";
import LayerInspector from "./LayerInspector";
import useEditorShortcuts from "./useEditorShortcuts";
import { artworkBounds, layerBounds, frameArtwork } from "./editorGeometry";
import useCanvasNavigation from "./useCanvasNavigation";
import { Loader2 } from "lucide-react";



import { Layers3, LayoutGrid, Combine, Undo2, Redo2, Save, Minus, Plus, Scan, RotateCcw, Sparkles, Download, Eye, EyeOff, MousePointer2, CheckCircle2, Search, Focus, Keyboard } from "lucide-react";
import styles from "./designExtract.module.css";

const activeStatuses = ["submitting", "queued", "processing", "saving", "ready"];
const operationLabels = { submitting: "Checking submission", queued: "Waiting in queue", processing: "Extracting layers", saving: "Saving generated layers", ready: "Ready to review" };
function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a"); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export default function DesignExtract({ projectId }) {
  const router = useRouter();
  const [access, setAccess] = useState("checking");
  const [project, setProject] = useState(null);

  const [layers, setLayers] = useState([]);
  const [job, setJob] = useState(null);
  const [selected, setSelected] = useState(null);
  const [reviewSelected, setReviewSelected] = useState(null);
  const [layerQuery, setLayerQuery] = useState("");
  const [layerFilter, setLayerFilter] = useState("all");
  const [view, setView] = useState("layout");
  const [busy, setBusy] = useState(false);
  const [startingExtraction, setStartingExtraction] = useState(false);
  const [extractionTarget, setExtractionTarget] = useState(null);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(null);
  const [error, setError] = useState("");
  const [dismissedFailure, setDismissedFailure] = useState(null);
  const [segmentMode, setSegmentMode] = useState(false);
  const [requestId, setRequestId] = useState("");
  const [historyVersion, setHistoryVersion] = useState(0);
  const history = useRef({ past: [], future: [] });
  const remote = useRef(null);
  const saved = useRef("");
  const drag = useRef(null);
  const worker = useRef(null);
  const stage = useRef(null);
  const framedReview = useRef(null);
  const shortcuts = useRef(null);
  const operationPending = Boolean(job && activeStatuses.includes(job.status));
  const disabled = busy || saving || operationPending;
  const reviewing = job?.status === "ready";
  const showingFailure = job?.status === "failed" && dismissedFailure !== job.id;
  const recoveryView = showingFailure || job?.status === "submitting";
  const canvasLayers = reviewing ? job.result?.layers || [] : layers;
  const selection = reviewing ? null : layers.find(layer => layer.id === selected);
  const focusedLayer = reviewing ? canvasLayers.find(layer => layer.id === reviewSelected) : selection;
  const filteredLayers = [...layers].reverse().filter(layer => layer.name.toLowerCase().includes(layerQuery.trim().toLowerCase()) && (layerFilter === "all" || (layerFilter === "visible" ? layer.visible !== false : layer.visible === false)));
  const layerListViewport = useRef(null);
  const processing = startingExtraction || Boolean(job && ["queued", "processing", "saving"].includes(job.status));
  const targetLayerId = startingExtraction ? extractionTarget : job?.layer_id || (job?.kind === "split" ? selected : null);
  const sourceProcessing = processing && !targetLayerId;
  const enhancementItems = job?.status === "saving" ? job.result?.enhancement?.items : null;
  const enhancing = Boolean(enhancementItems?.length);
  const enhancementFinished = enhancementItems?.filter(item => ["done", "failed", "uncertain", "skipped"].includes(item.status)).length || 0;
  const enhancementProgress = enhancing ? `${enhancementFinished} of ${enhancementItems.length} layers finished` : null;
  const progressStatus = startingExtraction ? "starting" : enhancing ? "enhancing" : job?.status;
  const progressPaused = Boolean(!startingExtraction && job?.pollingPaused);
  const navigation = useCanvasNavigation(stage, Boolean(project) && !processing, drag);
  const { camera, setCamera, setZoom } = navigation;
  const zoom = camera.zoom;
  const progressMessage = job?.status === "queued" ? "Your design is waiting in the AI queue. Processing will start when a worker is available." : job?.status === "processing" ? "AI is separating your design into layers. Keep this page open or return to this project later." : job?.status === "saving" ? "AI processing is complete. Saving the extracted layers for preview…" : job?.status === "submitting" ? "The request needs reconciliation. See the Layers panel for recovery options." : null;

  const api = useCallback(async (path = "", options = {}) => {
    const { data: { session } } = await createClient().auth.getSession();
    if (!session) throw new Error("Sign in with your admin account to use Design Extract.");
    const response = await fetch(`/api/design-extract${path}`, { ...options, headers: { Authorization: `Bearer ${session.access_token}`, ...(options.body && !(options.body instanceof FormData) ? { "Content-Type": "application/json" } : {}), ...options.headers } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Request failed");
    return data;
  }, []);
  const load = useCallback(data => {
    remote.current = data.project;
    saved.current = JSON.stringify(data.project.manifest.layers);
    setProject(data.project); setLayers(data.project.manifest.layers); setJob(data.job || null);
  }, []);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const data = await api(`/${projectId}`);
        if (!live) return;
        load(data); setAccess("allowed");

      } catch (err) { if (live) { setAccess("denied"); setError(err.message); } }
    })();
    return () => { live = false; worker.current?.terminate(); };
  }, [api, load, projectId]);
  useEffect(() => {
    if (!projectId || !job || !["queued", "processing", "saving"].includes(job.status)) return;
    let live = true;
    const timer = setTimeout(async () => {
      try { const data = await api(`/${projectId}`); if (live) { setJob(data.job); setError(""); } }
      catch (err) { if (live) { setError(`${err.message} Refresh to resume checking this operation.`); setJob(current => ({ ...current, pollingPaused: true })); } }
    }, 4000);
    if (job.pollingPaused) clearTimeout(timer);
    return () => { live = false; clearTimeout(timer); };
  }, [api, projectId, job]);

  const persist = useCallback(async next => {
    if (!remote.current || saved.current === JSON.stringify(next)) return;
    setSaving(true);
    try {
      const data = await api(`/${projectId}`, { method: "PATCH", body: JSON.stringify({ revision: remote.current.revision, layers: next }) });
      remote.current = data.project; saved.current = JSON.stringify(next); setProject(data.project);
    } finally { setSaving(false); }
  }, [api, projectId]);
  useEffect(() => {
    if (!project || disabled || error || drag.current || saved.current === JSON.stringify(layers)) return;
    const timer = setTimeout(() => persist(layers).catch(err => setError(err.message)), 1500);
    return () => clearTimeout(timer);
  }, [project, layers, disabled, persist, error, historyVersion]);
  useEffect(() => {
    const warn = event => { if (saved.current !== JSON.stringify(layers)) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [layers]);
  const change = next => {
    if (disabled) return;
    history.current.past.push(layers); if (history.current.past.length > 40) history.current.past.shift();
    history.current.future = []; setLayers(next); setHistoryVersion(value => value + 1);
  };
  const update = patch => change(layers.map(layer => layer.id === selected ? { ...layer, ...patch } : layer));
  const travel = direction => {
    const from = direction === "undo" ? history.current.past : history.current.future;
    const to = direction === "undo" ? history.current.future : history.current.past;
    if (disabled || !from.length) return;
    to.push(layers); setLayers(from.pop()); setHistoryVersion(value => value + 1);
  };
  const run = async callback => { setError(""); setBusy(true); try { await callback(); } catch (err) { setError(err.message); } finally { setBusy(false); } };
  const start = (kind, point, fromSource = false) => run(async () => {
    if (kind === "extract" || fromSource) setView("layout");
    setExtractionTarget(kind === "extract" || fromSource ? null : selected);
    setStartingExtraction(true);
    try {
    await persist(layers);
    const data = await api(`/${projectId}`, { method: "POST", body: JSON.stringify({ kind, layerId: kind === "extract" || fromSource ? null : selected, point, idempotencyKey: crypto.randomUUID() }) });
    setJob(data.job); setSegmentMode(false);
    } finally { setStartingExtraction(false); }
  });
  const review = accept => run(async () => {
    const data = await api(`/${projectId}`, { method: "POST", body: JSON.stringify({ action: accept ? "accept" : "reject", jobId: job.id, revision: remote.current.revision }) });
    load(data); history.current = { past: [], future: [] }; setSelected(null); setReviewSelected(null); setLayerQuery(""); setLayerFilter("all"); setHistoryVersion(value => value + 1);
  });
  const fetchAsset = async layer => {
    const { data: { session } } = await createClient().auth.getSession();
    const response = await fetch(`/api/design-extract/${projectId}/asset?layer=${encodeURIComponent(layer)}`, { headers: { Authorization: `Bearer ${session.access_token}` } });
    if (!response.ok) throw new Error("Could not download the layer. Try again.");
    return response.blob();
  };
  const exportFile = format => run(async () => {
    setExporting(format);
    try {
    await persist(layers);
    if (format === "png") { if (!selection) return; download(await fetchAsset(selected), `${selection.name.replace(/[^a-zA-Z0-9_-]/g, "_")}.png`); return; }
    const files = [];
    for (const layer of layers) files.push(await fetchAsset(layer.id));
    const source = format === "psd" ? await fetchAsset("source") : null;
    await new Promise((resolve, reject) => {
      const exporter = new Worker(new URL("./export.worker.js", import.meta.url)); worker.current = exporter;
      exporter.onmessage = ({ data }) => { exporter.terminate(); worker.current = null; if (data.error) reject(new Error(data.error)); else { download(data.blob, `design-extract.${format}`); resolve(); } };
      exporter.onerror = () => { exporter.terminate(); worker.current = null; reject(new Error("Export failed. Try PNG/ZIP for large projects.")); };
      exporter.postMessage({ format, manifest: { ...project.manifest, layers }, files, source });
    });
    } finally { setExporting(null); }
  });
  const frame = (bounds, maxZoom = 1) => {
    if (!stage.current || processing) return;
    const inspectorWidth = stage.current.querySelector("[data-design-inspector]")?.getBoundingClientRect().width || 0;
    const next = frameArtwork(bounds, { width: Math.max(160, stage.current.clientWidth - (inspectorWidth ? inspectorWidth + 32 : 0)), height: stage.current.clientHeight }, maxZoom);
    if (next) setCamera(next);
  };
  const fit = () => { if (project) frame(artworkBounds(canvasLayers, view, project.manifest)); };
  const focusLayer = layer => { if (layer && layer.visible !== false) frame(layerBounds(layer, view), 2); };
  const selectLayer = id => {
    setSelected(id);
    const viewport = layerListViewport.current;
    const row = viewport && [...viewport.querySelectorAll("[data-layer-row]")].find(element => element.dataset.layerRow === id);
    if (!row) return;
    const bounds = row.getBoundingClientRect(), frame = viewport.getBoundingClientRect();
    if (bounds.top < frame.top) viewport.scrollTop += bounds.top - frame.top;
    else if (bounds.bottom > frame.bottom) viewport.scrollTop += bounds.bottom - frame.bottom;
  };
  const deleteSelection = () => {
    if (!selection || selection.locked || disabled) return;
    change(layers.filter(layer => layer.id !== selected)); setSelected(null);
  };
  useEffect(() => {
    if (!reviewing || !project || framedReview.current === job.id) return;
    const nextJob = job.id;
    const handle = requestAnimationFrame(() => {
      if (!stage.current) return;
      const next = frameArtwork(artworkBounds(job.result?.layers || [], "layout", project.manifest), { width: stage.current.clientWidth, height: stage.current.clientHeight });
      setView("layout"); setReviewSelected(job.result?.layers?.[0]?.id || null);
      if (next) setCamera(next);
      framedReview.current = nextJob;
    });
    return () => cancelAnimationFrame(handle);
  }, [reviewing, job, project, setCamera]);
  useEffect(() => {
    const close = () => { if (shortcuts.current) shortcuts.current.open = false; };
    const outside = event => { if (shortcuts.current?.open && !shortcuts.current.contains(event.target)) close(); };
    window.addEventListener("resize", close); window.addEventListener("pointerdown", outside);
    return () => { window.removeEventListener("resize", close); window.removeEventListener("pointerdown", outside); };
  }, []);
  useEditorShortcuts({
    canEdit: !disabled, canDelete: Boolean(selection && !selection.locked), hasSelection: Boolean(focusedLayer),
    save: () => run(() => persist(layers)), travel, fit, focus: () => focusLayer(focusedLayer), remove: deleteSelection,
    escape: () => { setSegmentMode(false); setSelected(null); setReviewSelected(null); if (shortcuts.current) shortcuts.current.open = false; if (drag.current) { setLayers(drag.current.before); drag.current = null; } },
  });
  const moveOrder = delta => {
    const index = layers.findIndex(layer => layer.id === selected), target = index + delta;
    if (target < 0 || target >= layers.length) return;
    const next = [...layers]; [next[index], next[target]] = [next[target], next[index]]; change(next);
  };
  return <StudioShell className={"garment-workspace-ui " + styles.shell} title="Design Extract" onHome={() => router.push("/")} showCredits={false} commandBarPosition="bottom" statusLeft={<><span>{exporting ? `Exporting ${exporting.toUpperCase()}…` : saving ? "Saving…" : busy ? "Working…" : job && activeStatuses.includes(job.status) ? enhancing ? `Enhancing layers · ${enhancementFinished}/${enhancementItems.length}` : operationLabels[job.status] : (project ? (saved.current === JSON.stringify(layers) ? "All changes saved" : "Unsaved changes") : "Ready to upload")}</span>{project && <span className={styles.navigationHint}>Scroll to zoom · Space + drag to pan · F to focus · Shift+F to fit</span>}</>} statusRight={<span>AI reconstruction · Review details before production</span>} commandBar={project && <div className={styles.toolbar} role="toolbar" aria-label="Design editing tools">
    <div className={styles.actionGroup} role="group" aria-label="Extract artwork">
    <button className={styles.primaryAction} data-complete={layers.length > 0} title={reviewing ? "Review the generated layers before accepting them" : layers.length ? "Select a layer and use Split further to separate more elements." : "Separate your design into individual image layers"} disabled={disabled || layers.length > 0} onClick={() => start("extract")}>{processing ? <Loader2 size={14} className={styles.spinner} /> : reviewing || layers.length ? <CheckCircle2 size={14} /> : <Sparkles size={14} />}<span className={styles.extractLabel}>{processing ? enhancing ? "Enhancing layers…" : "Extracting layers…" : reviewing ? "Review layers" : layers.length ? "Layers extracted" : "Extract layers"}</span></button>
    <button className={styles.iconAction} aria-label="Extract original element" title="Extract original element · Keep source pixels" disabled={disabled} aria-pressed={segmentMode === "source"} onClick={() => { setSegmentMode(value => value === "source" ? false : "source"); setView("layout"); setCamera({ x: 36, y: 54, zoom: .7 }); }}><MousePointer2 size={17} /></button>
    </div>
    <div className={styles.viewSwitch} role="group" aria-label="Canvas view"><button title="Overview" aria-label="Overview" disabled={processing} aria-pressed={view === "layout"} onClick={() => setView("layout")}><LayoutGrid size={16} /></button><button title="Composition" aria-label="Composition" disabled={processing} aria-pressed={view === "composition"} onClick={() => setView("composition")}><Combine size={16} /></button></div>
    <div className={styles.controlGroup} role="group" aria-label="Edit history"><button title="Undo" aria-label="Undo" disabled={disabled || !history.current.past.length} onClick={() => travel("undo")}><Undo2 size={15} /></button><button title="Redo" aria-label="Redo" disabled={disabled || !history.current.future.length} onClick={() => travel("redo")}><Redo2 size={15} /></button></div>
    <button className={`${styles.saveAction} ${styles.iconAction}`} aria-label={saving ? "Saving…" : "Save changes"} title="Save changes · Ctrl / ⌘ S" disabled={disabled} aria-busy={saving} onClick={() => run(async () => { await persist(layers); })}>{saving ? <Loader2 size={14} className={styles.spinner} /> : <Save size={14} />}</button>
    <span className={styles.toolbarMeta}>{project.manifest.width} × {project.manifest.height} px · {canvasLayers.length} {reviewing ? "layers to review" : "layers"}</span>
    <button className={styles.quickExport} aria-label={exporting === "psd" ? "Exporting PSD…" : "Quick export PSD"} disabled={disabled || !layers.length} aria-busy={exporting === "psd"} title={layers.length ? "Download a layered Photoshop PSD with your artwork and original reference" : "Extract and accept layers before exporting a PSD"} onClick={() => exportFile("psd")}>
      {exporting === "psd" ? <Loader2 size={18} className={styles.spinner} /> : <Image src="/brand-logos/adobe-photoshop.svg" width={20} height={20} alt="" aria-hidden="true" />}
      <span>{exporting === "psd" ? "Exporting…" : "Export PSD"}</span><Download size={14} />
    </button>
    <div className={styles.zoomGroup} role="group" aria-label="Canvas zoom"><button aria-label="Zoom out" onClick={() => setZoom(value => Math.max(.05, value / 1.2))}><Minus size={14} /></button><span>{Math.round(zoom * 100)}%</span><button aria-label="Zoom in" onClick={() => setZoom(value => Math.min(4, value * 1.2))}><Plus size={14} /></button><button aria-label="Fit" disabled={processing} title="Fit all artwork (Shift+F)" onClick={fit}><Scan size={16} /></button><button aria-label="Focus layer" title="Focus selected layer (F)" disabled={processing || !focusedLayer || focusedLayer.visible === false} onClick={() => focusLayer(focusedLayer)}><Focus size={15} /></button></div>
    <button className={styles.iconAction} aria-label="Reset layout" title="Reset layout · Restore overview arrangement" disabled={disabled} onClick={() => change(layers.map((layer, i) => ({ ...layer, layout: { x: 300 + i % 4 * 260, y: Math.floor(i / 4) * 300, scale: Math.min(220 / layer.width, 250 / layer.height, 1) } })))}><RotateCcw size={16} /></button>
    <details className={styles.shortcutMenu} ref={shortcuts} onToggle={event => {
      if (!event.currentTarget.open) return;
      const bounds = event.currentTarget.querySelector("summary").getBoundingClientRect();
      const popover = event.currentTarget.querySelector("[data-shortcut-popover]");
      popover.style.left = Math.max(16, Math.min(window.innerWidth - 316, bounds.right - 300)) + "px";
      const height = popover.offsetHeight;
      const top = bounds.bottom + height + 10 > window.innerHeight - 16 ? bounds.top - height - 10 : bounds.bottom + 10;
      popover.style.top = Math.max(16, top) + "px";
    }}><summary aria-label="Keyboard shortcuts" title="Keyboard shortcuts"><Keyboard size={16} /></summary><div className={styles.shortcutPopover} data-shortcut-popover><h3>Keyboard shortcuts</h3><dl>{[["Save", "Ctrl / ⌘ S"], ["Undo", "Ctrl / ⌘ Z"], ["Redo", "Ctrl / ⌘ Shift Z"], ["Focus selected layer", "F"], ["Fit all artwork", "Shift F"], ["Delete unlocked layer", "Delete"], ["Clear selection / exit tool", "Esc"], ["Pan over an element", "Space + drag"]].map(([label, key]) => <div key={label}><dt>{label}</dt><dd><kbd>{key}</kbd></dd></div>)}</dl></div></details>
  </div>}>
    {error && <div className={styles.error} role="alert">{error} <button onClick={() => window.location.reload()}>Reload</button></div>}
    {access !== "allowed" ? <main className={styles.landing}><h2>{access === "checking" ? "Opening workspace…" : "Workspace unavailable"}</h2><p>Sign in with an authorized account to open Design Extract.</p></main> : !project ? <main className={styles.landing}><h2>Opening document…</h2></main> : <main className={styles.workspace} data-history-version={historyVersion}>
      <div className={styles.canvasShell}>
      <div className={styles.viewport} ref={stage} aria-busy={processing} role="region" aria-label="Design canvas" tabIndex={0} data-panning={navigation.panning} data-pan-ready={navigation.spaceHeld} {...navigation.handlers}>

        {selection && <LayerInspector key={selection.id} layer={selection} view={view} disabled={disabled} segmentMode={segmentMode} onUpdate={update} onForward={() => moveOrder(1)} onBackward={() => moveOrder(-1)} onDelete={deleteSelection} onSplit={() => start("split")} onSegment={() => setSegmentMode(value => value === "layer" ? false : "layer")} onDownload={() => exportFile("png")} onClose={() => { setSelected(null); setSegmentMode(false); }} />}
        {segmentMode === "source" && !processing && <p className={styles.sourcePrompt} role="status">Click an element in the source artwork. The cutout will retain original image pixels.</p>}
        {job?.status === "submitting" && !startingExtraction && <div className={styles.progress} role="status"><strong>Check submission</strong><p>{progressMessage}</p></div>}

        <div>
          <div data-design-board className={`${styles.board} ${view === "composition" ? styles.composition : ""}`} style={{ "--label-scale": 1 / zoom, width: view === "composition" ? project.manifest.width : 1600, height: view === "composition" ? project.manifest.height : Math.max(700, Math.ceil(layers.length / 4) * 300), transform: `translate(${camera.x}px, ${camera.y}px) scale(${zoom})` }}>
            {(view === "layout" || sourceProcessing) && <figure className={`${styles.reference} ${segmentMode === "source" ? styles.sourceSelection : ""}`}><figcaption><span>Source artwork</span><small>{segmentMode === "source" ? "Select an element" : sourceProcessing ? "Generating" : "Original"}</small></figcaption><div className={styles.artworkFrame} style={{ aspectRatio: `${project.manifest.width} / ${project.manifest.height}` }}><img src={project.source_url} alt="Original flat design" data-design-element={segmentMode === "source" ? "source" : undefined} onPointerDown={event => {
              if (segmentMode !== "source" || event.button !== 0 || disabled) return;
              event.preventDefault(); event.stopPropagation();
              const rect = event.currentTarget.getBoundingClientRect();
              start("segment", { x: (event.clientX - rect.left) / rect.width * project.manifest.width, y: (event.clientY - rect.top) / rect.height * project.manifest.height }, true);
            }} />{sourceProcessing && <ExtractionProgress status={progressStatus} detail={enhancementProgress} operationId={job?.id} paused={progressPaused} />}</div></figure>}
            {!layers.length && !operationPending && !segmentMode && <section className={styles.emptyBoard}>
              <span className={styles.emptyBoardIcon}><Layers3 size={22} /></span>
              <span className={styles.eyebrow}>Start with your artwork</span>
              <h2>{job?.status === "failed" ? <>Your original<br />is safe.</> : <>One design.<br />Individual elements.</>}</h2>
              <p>Extract editable image layers, review the result, then arrange or export the elements you need.</p>
              <span className={styles.startHint}>{job?.status === "failed" ? "Use Recover existing result in the Layers panel to check the completed output." : <>Choose <strong>Extract layers</strong> in the toolbar to begin.</>}</span>
              <small>Need an exact cutout? Use Extract original element to keep the source pixels.</small>
            </section>}
            {canvasLayers.map(layer => { const placement = layer[view]; return <div key={layer.id} className={`${styles.element} ${(reviewing ? reviewSelected : selected) === layer.id ? styles.selected : ""}`} style={{ left: placement.x, top: placement.y, width: layer.width * placement.scale, height: layer.height * placement.scale, display: layer.visible ? "block" : "none", zIndex: layers.indexOf(layer) + 1 }}
              data-design-element title={`${layer.name} · ${layer.width} × ${layer.height} px`} role="button" tabIndex={0} aria-label={`${reviewing ? "Inspect generated" : "Select"} ${layer.name}`} aria-pressed={(reviewing ? reviewSelected : selected) === layer.id}
              onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); if (reviewing) setReviewSelected(layer.id); else selectLayer(layer.id); } }}
              onPointerDown={event => {
                if (event.button !== 0) return;
                if (reviewing) { setReviewSelected(layer.id); return; }
                selectLayer(layer.id);
                if (segmentMode === "layer" && layer.id === selected) { const box = event.currentTarget.getBoundingClientRect(); start("segment", { x: (event.clientX - box.left) / box.width * layer.width, y: (event.clientY - box.top) / box.height * layer.height }); return; }
                if (disabled || layer.locked) return;
                event.currentTarget.setPointerCapture(event.pointerId);
                drag.current = { id: layer.id, x: event.clientX, y: event.clientY, placement, before: layers };
              }}
              onPointerMove={event => { const d = drag.current; if (!d || d.id !== layer.id) return; setLayers(d.before.map(item => item.id === d.id ? { ...item, [view]: { ...d.placement, x: d.placement.x + (event.clientX - d.x) / zoom, y: d.placement.y + (event.clientY - d.y) / zoom } } : item)); }}
              onPointerUp={() => { if (drag.current) { history.current.past.push(drag.current.before); history.current.future = []; drag.current = null; setHistoryVersion(value => value + 1); } }}
              onPointerCancel={() => { if (drag.current) setLayers(drag.current.before); drag.current = null; }}>
              {view === "layout" && <span className={styles.elementLabel}><span className={styles.elementName}><Layers3 size={12} aria-hidden="true" /><span>{layer.name}</span></span><small>{layer.width} × {layer.height} px</small></span>}<img src={layer.url} alt={layer.name} draggable={false} />{processing && !sourceProcessing && targetLayerId === layer.id && <ExtractionProgress status={progressStatus} detail={enhancementProgress} operationId={job?.id} paused={progressPaused} compact />}
            </div>; })}
          </div>
        </div>
      </div>
      </div>
      <aside className={styles.panel} data-recovery={recoveryView}>
        <header className={styles.panelHeading}><h2><Layers3 size={17} />Layers</h2><span>{reviewing ? canvasLayers.length : layers.length}<small>{reviewing ? " new" : " / 32"}</small></span></header>
        {!reviewing && <p className={styles.panelIntro}>{reviewing ? "Inspect the generated layers, then accept or discard this result." : processing ? "Your extraction is in progress. The original artwork stays unchanged." : layers.length ? "Select a layer to adjust its placement or refine its content." : "Extract your design, then review and keep the layers you need."}</p>}
        {!reviewing && <details className={styles.extractionNote}><summary>AI layers or original cutouts?</summary><p>AI layers reconstruct the design and may change details or resolution. <strong>Extract original element</strong> keeps pixels from your source image.</p></details>}
        {job?.status === "submitting" && <section className={styles.properties}><p role="status">Submission needs reconciliation. Find this operation in fal history by its source image and creation time. No automatic resubmission.</p><label>fal request ID<input value={requestId} onChange={event => setRequestId(event.target.value)} /></label><button disabled={busy || !requestId} onClick={() => run(async () => { const data = await api(`/${projectId}`, { method: "POST", body: JSON.stringify({ action: "reconcile", jobId: job.id, requestId }) }); setJob(data.job); })}>Reconnect existing request</button></section>}
        {showingFailure && <section className={styles.failedResult}>
          <h3>Extraction needs attention</h3><p role="alert">{job.error}</p>
          <p>Your original artwork is safe. Recover the existing result before starting another extraction.</p>
          {job.request_id && <button disabled={busy || saving} onClick={() => run(async () => { const data = await api(`/${projectId}`, { method: "POST", body: JSON.stringify({ action: "recover", jobId: job.id }) }); setJob(data.job); })}>{busy ? <Loader2 size={14} className={styles.spinner} /> : <RotateCcw size={14} />}{busy ? "Recovering result…" : "Recover existing result"}</button>}
          <small>Recovery does not start a new AI generation.</small>
          {layers.length > 0 && <button disabled={busy} onClick={() => setDismissedFailure(job.id)}>Show saved layers</button>}
        </section>}
        {job?.status === "failed" && !showingFailure && <button className={styles.issueToggle} onClick={() => setDismissedFailure(null)}>View extraction issue</button>}
        {job?.pollingPaused && <button onClick={() => setJob(current => ({ ...current, pollingPaused: false }))}>Resume checking</button>}
        {reviewing && <ExtractionReview job={job} selectedId={reviewSelected} busy={busy} onPreview={layer => { setReviewSelected(layer.id); focusLayer(layer); }} onAccept={() => review(true)} onDiscard={() => review(false)} />}
        {processing && <div className={styles.pendingLayers} role="status"><Loader2 size={16} className={progressPaused ? undefined : styles.spinner} /><div><strong>{progressPaused ? "Checking paused" : enhancing ? "Enhancing your layers" : job?.status === "saving" ? "Saving your layers" : "Extraction in progress"}</strong><p>{progressPaused ? "Resume checking below to reconnect." : enhancing ? `${enhancementProgress}. Your elements keep their transparency and placement.` : "Previews appear here when the result is ready. You can return to this project later."}</p></div></div>}
        {!reviewing && layers.length > 0 && <div className={styles.layerTools}>
          <label className={styles.layerSearch}><Search size={14} aria-hidden="true" /><input aria-label="Search layers" placeholder="Search layers…" value={layerQuery} onChange={event => { setLayerQuery(event.target.value); layerListViewport.current?.scrollTo({ top: 0 }); }} /></label>
          <div className={styles.layerFilterRow}><select aria-label="Filter layers" value={layerFilter} onChange={event => { setLayerFilter(event.target.value); layerListViewport.current?.scrollTo({ top: 0 }); }}><option value="all">All layers</option><option value="visible">Visible only</option><option value="hidden">Hidden only</option></select><span aria-live="polite">{filteredLayers.length} of {layers.length}</span></div>
        </div>}
        {!reviewing && layers.length > 0 && <div className={`${styles.layerListViewport} ${styles.scrollableLayerList}`} ref={layerListViewport} data-layer-scroll role="region" aria-label="Layer list" tabIndex={0}><div className={styles.layerList}>{filteredLayers.map(layer => <div key={layer.id} data-layer-row={layer.id} className={selected === layer.id ? styles.activeRow : styles.row}>
          <button className={styles.layerSelect} title="Select layer; double-click to focus on canvas" aria-pressed={selected === layer.id} onClick={() => selectLayer(layer.id)} onDoubleClick={() => focusLayer(layer)}><span className={styles.thumbnail}><img src={layer.url} alt="" /></span><span className={styles.layerCopy}><strong>{layer.name}</strong><small>{layer.width} × {layer.height} px{layer.enhancement ? ` · ${layer.enhancement.scale}× enhanced` : ""}{layer.locked ? " · Locked" : ""}</small></span></button>
          <label className={styles.visibility} title={layer.visible ? "Hide layer" : "Show layer"}><input aria-label={`Show ${layer.name}`} type="checkbox" checked={layer.visible} disabled={disabled} onChange={event => change(layers.map(item => item.id === layer.id ? { ...item, visible: event.target.checked } : item))} />{layer.visible ? <Eye size={15} /> : <EyeOff size={15} />}</label>
        </div>)}</div>
        {!filteredLayers.length && <div className={styles.noLayerMatches}><strong>No matching layers</strong><button onClick={() => { setLayerQuery(""); setLayerFilter("all"); layerListViewport.current?.scrollTo({ top: 0 }); }}>Clear filters</button></div>}
        </div>}
        {!layers.length && !operationPending && job?.status !== "failed" && <div className={styles.emptyLayers}><Layers3 size={26} /><strong>No layers yet</strong><p>Your extracted elements will appear here.</p><ol className={styles.quickSteps}><li><span>1</span>Extract your design</li><li><span>2</span>Review and accept layers</li><li><span>3</span>Arrange and export</li></ol></div>}
        {!reviewing && layers.length > 0 && <div className={styles.exports}><h3>Export artwork</h3><button disabled={disabled || !layers.length} onClick={() => exportFile("zip")}><Download size={14} />Download all · ZIP</button><button disabled={disabled || !layers.length} onClick={() => exportFile("psd")}><Layers3 size={14} />Export layered PSD</button><p>Review AI-generated details before production.</p></div>}
      </aside>
    </main>}
  </StudioShell>;
}
