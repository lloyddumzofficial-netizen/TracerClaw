"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import StudioShell from "@/components/shared/StudioShell";
import ExtractionProgress from "./ExtractionProgress";
import useCanvasNavigation from "./useCanvasNavigation";
import { Loader2 } from "lucide-react";



import { Layers3, LayoutGrid, Combine, Undo2, Redo2, Save, Minus, Plus, Scan, RotateCcw, Sparkles, Download, Eye, EyeOff, MousePointer2, ArrowUp, ArrowDown, Trash2, LockKeyhole, SlidersHorizontal } from "lucide-react";
import styles from "./designExtract.module.css";

const activeStatuses = ["submitting", "queued", "processing", "saving", "ready"];
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
  const [view, setView] = useState("layout");
  const [busy, setBusy] = useState(false);
  const [startingExtraction, setStartingExtraction] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [segmentMode, setSegmentMode] = useState(false);
  const [requestId, setRequestId] = useState("");
  const [historyVersion, setHistoryVersion] = useState(0);
  const history = useRef({ past: [], future: [] });
  const remote = useRef(null);
  const saved = useRef("");
  const drag = useRef(null);
  const worker = useRef(null);
  const stage = useRef(null);
  const operationPending = Boolean(job && activeStatuses.includes(job.status));
  const disabled = busy || saving || operationPending;
  const selection = layers.find(layer => layer.id === selected);
  const processing = startingExtraction || Boolean(job && ["queued", "processing", "saving"].includes(job.status));
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
    setStartingExtraction(true);
    try {
    await persist(layers);
    const data = await api(`/${projectId}`, { method: "POST", body: JSON.stringify({ kind, layerId: kind === "extract" || fromSource ? null : selected, point, idempotencyKey: crypto.randomUUID() }) });
    setJob(data.job); setSegmentMode(false);
    } finally { setStartingExtraction(false); }
  });
  const review = accept => run(async () => {
    const data = await api(`/${projectId}`, { method: "POST", body: JSON.stringify({ action: accept ? "accept" : "reject", jobId: job.id, revision: remote.current.revision }) });
    load(data); history.current = { past: [], future: [] }; setSelected(null); setHistoryVersion(value => value + 1);
  });
  const fetchAsset = async layer => {
    const { data: { session } } = await createClient().auth.getSession();
    const response = await fetch(`/api/design-extract/${projectId}/asset?layer=${encodeURIComponent(layer)}`, { headers: { Authorization: `Bearer ${session.access_token}` } });
    if (!response.ok) throw new Error("Could not download the layer. Try again.");
    return response.blob();
  };
  const exportFile = format => run(async () => {
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
  });
  const fit = () => {
    if (!stage.current || !project) return;
    const width = view === "composition" ? project.manifest.width : 1400;
    const height = view === "composition" ? project.manifest.height : Math.max(600, Math.ceil(layers.length / 4) * 300);
    const nextZoom = Math.max(.05, Math.min(1, (stage.current.clientWidth - 72) / width, (stage.current.clientHeight - 108) / height));
    setCamera({ zoom: nextZoom, x: (stage.current.clientWidth - width * nextZoom) / 2, y: 54 });
  };
  const moveOrder = delta => {
    const index = layers.findIndex(layer => layer.id === selected), target = index + delta;
    if (target < 0 || target >= layers.length) return;
    const next = [...layers]; [next[index], next[target]] = [next[target], next[index]]; change(next);
  };
  return <StudioShell className={"garment-workspace-ui " + styles.shell} title="Design Extract" projectName={project ? (project.manifest.name || "Design layers") : null} onHome={() => router.push("/")} showCredits={false} statusLeft={<span>{saving ? "Saving…" : busy ? "Working…" : job && activeStatuses.includes(job.status) ? `Extraction: ${job.status}` : (project ? (saved.current === JSON.stringify(layers) ? "All changes saved" : "Unsaved changes") : "Ready to upload")}</span>} statusRight={<span>AI reconstruction · Review details before production</span>} commandBar={project && <div className={styles.toolbar}>
    <button className={styles.primaryAction} disabled={disabled || layers.length > 0} onClick={() => start("extract")}>{processing ? <Loader2 size={14} className={styles.spinner} /> : <Sparkles size={14} />}{processing ? "Extracting layers…" : "Extract layers"}</button>
    <button disabled={disabled} aria-pressed={segmentMode === "source"} onClick={() => { setSegmentMode(value => value === "source" ? false : "source"); setView("layout"); setCamera({ x: 36, y: 54, zoom: .7 }); }}><MousePointer2 size={14} />Extract original element</button>
    <div className={styles.viewSwitch} role="group" aria-label="Canvas view"><button aria-pressed={view === "layout"} onClick={() => setView("layout")}><LayoutGrid size={14} />Overview</button><button aria-pressed={view === "composition"} onClick={() => setView("composition")}><Combine size={14} />Composition</button></div>
    <div className={styles.controlGroup} role="group" aria-label="Edit history"><button title="Undo" aria-label="Undo" disabled={disabled || !history.current.past.length} onClick={() => travel("undo")}><Undo2 size={15} /></button><button title="Redo" aria-label="Redo" disabled={disabled || !history.current.future.length} onClick={() => travel("redo")}><Redo2 size={15} /></button></div>
    <button disabled={disabled} onClick={() => run(async () => { await persist(layers); })}><Save size={14} />Save changes</button>
    <div className={styles.zoomGroup} role="group" aria-label="Canvas zoom"><button aria-label="Zoom out" onClick={() => setZoom(value => Math.max(.05, value / 1.2))}><Minus size={14} /></button><span>{Math.round(zoom * 100)}%</span><button aria-label="Zoom in" onClick={() => setZoom(value => Math.min(4, value * 1.2))}><Plus size={14} /></button><button onClick={fit}><Scan size={14} />Fit</button></div>
    <button title="Restore the overview arrangement" disabled={disabled} onClick={() => change(layers.map((layer, i) => ({ ...layer, layout: { x: 300 + i % 4 * 260, y: Math.floor(i / 4) * 300, scale: Math.min(220 / layer.width, 250 / layer.height, 1) } })))}><RotateCcw size={14} />Reset layout</button>
  </div>}>
    {error && <div className={styles.error} role="alert">{error} <button onClick={() => window.location.reload()}>Reload</button></div>}
    {access !== "allowed" ? <main className={styles.landing}><h2>{access === "checking" ? "Opening workspace…" : "Workspace unavailable"}</h2><p>Sign in with an authorized account to open Design Extract.</p></main> : !project ? <main className={styles.landing}><h2>Opening document…</h2></main> : <main className={styles.workspace} data-history-version={historyVersion}>
      <div className={styles.canvasShell}>
      <div className={styles.canvasHeading}><div><span className={styles.eyebrow}>{view === "layout" ? "ELEMENT OVERVIEW" : "DESIGN COMPOSITION"}</span><p>{view === "layout" ? "Select an element to inspect, refine, or export." : "Arrange layers in their final canvas positions."}</p></div><span className={styles.canvasMeta}>{project.manifest.width} × {project.manifest.height} px <span>·</span> {layers.length} layers</span></div>
      <div className={styles.viewport} ref={stage} aria-busy={processing} role="region" aria-label="Design canvas" tabIndex={0} data-panning={navigation.panning} data-pan-ready={navigation.spaceHeld} {...navigation.handlers}>
        {processing && <ExtractionProgress status={startingExtraction ? "starting" : job.status} previewUrl={project.source_url} operationId={job?.id} paused={Boolean(!startingExtraction && job?.pollingPaused)} />}
        {!processing && <span className={styles.canvasHint}>Scroll to zoom · Drag canvas to pan · Space + drag over elements</span>}
        {segmentMode === "source" && !processing && <p className={styles.sourcePrompt} role="status">Click an element in the source artwork. The cutout will retain original image pixels.</p>}
        {job?.status === "submitting" && !startingExtraction && <div className={styles.progress} role="status"><strong>Check submission</strong><p>{progressMessage}</p></div>}
        {!layers.length && !operationPending && <p className={styles.hint}>Ready. Click Extract layers to separate this design.</p>}
        <div>
          <div data-design-board className={`${styles.board} ${view === "composition" ? styles.composition : ""}`} style={{ width: view === "composition" ? project.manifest.width : 1600, height: view === "composition" ? project.manifest.height : Math.max(700, Math.ceil(layers.length / 4) * 300), transform: `translate(${camera.x}px, ${camera.y}px) scale(${zoom})` }}>
            {view === "layout" && <figure className={`${styles.reference} ${segmentMode === "source" ? styles.sourceSelection : ""}`}><figcaption><span>Source artwork</span><small>{segmentMode === "source" ? "CLICK TO EXTRACT" : "REFERENCE"}</small></figcaption><img src={project.source_url} alt="Original flat design" data-design-element={segmentMode === "source" ? "source" : undefined} onPointerDown={event => {
              if (segmentMode !== "source" || event.button !== 0 || disabled) return;
              event.preventDefault(); event.stopPropagation();
              const rect = event.currentTarget.getBoundingClientRect();
              start("segment", { x: (event.clientX - rect.left) / rect.width * project.manifest.width, y: (event.clientY - rect.top) / rect.height * project.manifest.height }, true);
            }} /></figure>}
            {layers.map(layer => { const placement = layer[view]; return <div key={layer.id} className={`${styles.element} ${selected === layer.id ? styles.selected : ""}`} style={{ left: placement.x, top: placement.y, width: layer.width * placement.scale, height: layer.height * placement.scale, display: layer.visible ? "block" : "none", zIndex: layers.indexOf(layer) + 1 }}
              data-design-element role="button" tabIndex={0} aria-label={`Select ${layer.name}`} aria-pressed={selected === layer.id}
              onKeyDown={event => { if (event.key === "Enter" || event.key === " ") setSelected(layer.id); }}
              onPointerDown={event => {
                if (event.button !== 0) return;
                setSelected(layer.id);
                if (segmentMode === "layer" && layer.id === selected) { const box = event.currentTarget.getBoundingClientRect(); start("segment", { x: (event.clientX - box.left) / box.width * layer.width, y: (event.clientY - box.top) / box.height * layer.height }); return; }
                if (disabled || layer.locked) return;
                event.currentTarget.setPointerCapture(event.pointerId);
                drag.current = { id: layer.id, x: event.clientX, y: event.clientY, placement, before: layers };
              }}
              onPointerMove={event => { const d = drag.current; if (!d || d.id !== layer.id) return; setLayers(d.before.map(item => item.id === d.id ? { ...item, [view]: { ...d.placement, x: d.placement.x + (event.clientX - d.x) / zoom, y: d.placement.y + (event.clientY - d.y) / zoom } } : item)); }}
              onPointerUp={() => { if (drag.current) { history.current.past.push(drag.current.before); history.current.future = []; drag.current = null; setHistoryVersion(value => value + 1); } }}
              onPointerCancel={() => { if (drag.current) setLayers(drag.current.before); drag.current = null; }}>
              {view === "layout" && <span className={styles.elementLabel}><span>{layer.name}</span><small>{layer.width} × {layer.height}</small></span>}<img src={layer.url} alt={layer.name} draggable={false} />
            </div>; })}
          </div>
        </div>
      </div>
      </div>
      <aside className={styles.panel}>
        <header className={styles.panelHeading}><h2><Layers3 size={17} />Layers</h2><span>{layers.length}<small> / 32</small></span></header>
        <p className={styles.panelIntro}>Select a layer to adjust its placement or refine its content.</p>
        <p className={styles.qualityNote}>Automatic layers are AI reconstructions and may be lower resolution or alter details. Use <strong>Extract original element</strong> for cutouts from the source image.</p>
        {job?.status === "submitting" && <section className={styles.properties}><p role="status">Submission needs reconciliation. Find this operation in fal history by its source image and creation time. No automatic resubmission.</p><label>fal request ID<input value={requestId} onChange={event => setRequestId(event.target.value)} /></label><button disabled={busy || !requestId} onClick={() => run(async () => { const data = await api(`/${projectId}`, { method: "POST", body: JSON.stringify({ action: "reconcile", jobId: job.id, requestId }) }); setJob(data.job); })}>Reconnect existing request</button></section>}
        {job?.status === "failed" && <p role="alert">{job.error}</p>}
        {job?.pollingPaused && <button onClick={() => setJob(current => ({ ...current, pollingPaused: false }))}>Resume checking</button>}
        {job?.status === "ready" && <section className={styles.review}><h3>Review extracted layers</h3><div className={styles.previews}>{job.result.layers.map(layer => <img key={layer.id} src={layer.url} alt={layer.name} />)}</div><p>The original is kept until you accept.</p><button disabled={busy} onClick={() => review(true)}>Accept layers</button><button disabled={busy} onClick={() => review(false)}>Discard result</button></section>}
        <div className={styles.layerList}>{[...layers].reverse().map(layer => <div key={layer.id} className={selected === layer.id ? styles.activeRow : styles.row}>
          <button className={styles.layerSelect} aria-pressed={selected === layer.id} onClick={() => setSelected(layer.id)}><span className={styles.thumbnail}><img src={layer.url} alt="" /></span><span className={styles.layerCopy}><strong>{layer.name}</strong><small>{layer.width} × {layer.height} px{layer.locked ? " · Locked" : ""}</small></span></button>
          <label className={styles.visibility} title={layer.visible ? "Hide layer" : "Show layer"}><input aria-label={`Show ${layer.name}`} type="checkbox" checked={layer.visible} disabled={disabled} onChange={event => change(layers.map(item => item.id === layer.id ? { ...item, visible: event.target.checked } : item))} />{layer.visible ? <Eye size={15} /> : <EyeOff size={15} />}</label>
        </div>)}</div>
        {!layers.length && !operationPending && <div className={styles.emptyLayers}><Layers3 size={26} /><strong>Your layers will appear here</strong><p>Extract the artwork to get started.</p></div>}
        {selection ? <section className={styles.properties}><h3><SlidersHorizontal size={14} />Layer properties</h3><label>Layer name<input value={selection.name} disabled={disabled} onChange={event => update({ name: event.target.value })} /></label>
          <label className={styles.lockControl}><span><LockKeyhole size={13} />Lock layer</span><input type="checkbox" checked={selection.locked} disabled={disabled} onChange={event => update({ locked: event.target.checked })} /></label>
          <div className={styles.transformFields}>{["x", "y", "scale"].map(key => <label key={key}><span>{key === "scale" ? "Scale" : key.toUpperCase()}</span><input aria-label={`${view === "layout" ? "Overview" : "Composition"} ${key}`} type="number" step={key === "scale" ? .05 : 1} min={key === "scale" ? .01 : -32768} max={key === "scale" ? 20 : 32768} value={Math.round(selection[view][key] * 100) / 100} disabled={disabled || selection.locked} onChange={event => { const value = Number(event.target.value); if (Number.isFinite(value) && (key !== "scale" || value >= .01 && value <= 20)) update({ [view]: { ...selection[view], [key]: value } }); }} /></label>)}</div>
          <div className={styles.buttons}><button title="Bring forward" disabled={disabled || selection.locked} onClick={() => moveOrder(1)}><ArrowUp size={14} />Forward</button><button title="Send backward" disabled={disabled || selection.locked} onClick={() => moveOrder(-1)}><ArrowDown size={14} />Backward</button><button aria-label="Delete layer" title="Delete layer" disabled={disabled || selection.locked} onClick={() => { change(layers.filter(item => item.id !== selected)); setSelected(null); }}><Trash2 size={14} /></button></div>
          {selection.composition.scale > 1.05 && <p className={styles.qualityNote}>Native layer: {selection.width} × {selection.height} px. Enlarged to {Math.round(selection.composition.scale * 100)}% in the composition; enlargement cannot recover lost detail.</p>}
          <h3><Sparkles size={14} />Refine selection</h3><button disabled={disabled} onClick={() => start("split")}><Layers3 size={14} />Split further · AI</button><button disabled={disabled} aria-pressed={segmentMode === "layer"} onClick={() => setSegmentMode(value => value === "layer" ? false : "layer")}><MousePointer2 size={14} />Extract selected element</button>{segmentMode === "layer" && <p>Click the element inside the selected layer to cut out visible pixels.</p>}
          <button disabled={disabled} onClick={() => exportFile("png")}><Download size={14} />Download PNG</button>
        </section> : layers.length > 0 && <div className={styles.selectionHint}><MousePointer2 size={17} /><p>Select a layer on the canvas or in the list to access its properties.</p></div>}
        <div className={styles.exports}><h3>Export artwork</h3><button disabled={disabled || !layers.length} onClick={() => exportFile("zip")}><Download size={14} />Download all · ZIP</button><button disabled={disabled || !layers.length} onClick={() => exportFile("psd")}><Layers3 size={14} />Export layered PSD</button><p>Review AI-generated details before production.</p></div>
      </aside>
    </main>}
  </StudioShell>;
}
