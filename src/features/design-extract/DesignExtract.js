"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { createClient } from "@/utils/supabase/client";
import StudioShell from "@/components/shared/StudioShell";
import ExtractionProgress from "./ExtractionProgress";
import ExtractionActions from "./ExtractionActions";
import WorkspaceNotice from "./WorkspaceNotice";
import ExtractionReview from "./ExtractionReview";
import LayerInspector from "./LayerInspector";
import MaskEditor from "./MaskEditor";
import { uploadDesignFile } from "./upload";
import { selectVariant } from "@/lib/designExtractVariants";
import useEditorShortcuts from "./useEditorShortcuts";
import { artworkBounds, boardElementBounds, layerBounds, frameArtwork } from "./editorGeometry";
import useCanvasNavigation from "./useCanvasNavigation";
import useOpeningFrame from "./useOpeningFrame";
import { arrangeOverview } from "@/lib/designExtractLayout";
import { designPsdLimit } from "@/lib/designExtractExportPolicy";
import { editorSeed, fetchDesignProject, designRequest, cacheDesignProject, forgetDesignProject } from "./projectClient";
import { Loader2 } from "lucide-react";



import { Layers3, LayoutGrid, Combine, Undo2, Redo2, Save, Minus, Plus, Scan, RotateCcw, Download, Eye, EyeOff, Search, Focus, Keyboard } from "lucide-react";
import styles from "./designExtract.module.css";
import { layerVisible, alreadyUpscaled } from "@/lib/designLayerTypes";
import { layerUpscaleAvailability } from "@/lib/designExtractUpscalePolicy";

const activeStatuses = ["submitting", "queued", "processing", "saving", "ready"];
const operationLabels = { submitting: "Checking submission", queued: "Waiting in queue", processing: "Extracting layers", saving: "Saving generated layers", ready: "Ready to review" };
function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a"); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export default function DesignExtract({ projectId }) {
  const router = useRouter();
  const seed = useRef(editorSeed(projectId));
  const [referencePreview, setReferencePreview] = useState(seed.current?.thumbnailUrl || null);
  const [access, setAccess] = useState(seed.current && !seed.current.preview && seed.current.billing ? "allowed" : "checking");
  const [project, setProject] = useState(seed.current?.project || { id: projectId, source_url: null, manifest: { width: 240, height: 320, layers: [] } });
  const [openingPlaceholder, setOpeningPlaceholder] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const [layers, setLayers] = useState(seed.current?.project.manifest.layers || []);
  const [job, setJob] = useState(seed.current?.job || null);
  const [pricing, setPricing] = useState(seed.current?.billing || null);
  const priceLabel = kind => pricing?.mode === "paid" ? ` · ${pricing.prices[kind]} Claw${pricing.prices[kind] === 1 ? "" : "s"}` : "";
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
  const [points, setPoints] = useState([]), [pointLabel, setPointLabel] = useState(1);
  const [maskEditing, setMaskEditing] = useState(false);
  const [versions, setVersions] = useState({});
  const [compare, setCompare] = useState(false), [comparison, setComparison] = useState(50);
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => { setReducedMotion(localStorage.getItem("design-extract-reduced-motion") === "true"); }, []);
  const switchSegment = mode => { setSegmentMode(current => current === mode ? false : mode); setPoints([]); setCompare(false); };
  const addPoint = (event, width, height) => {
    event.preventDefault(); event.stopPropagation();
    const box = event.currentTarget.getBoundingClientRect();
    setPoints(current => current.length >= 32 ? current : [...current, { x: Math.min(width - 1, Math.max(0, (event.clientX - box.left) / box.width * width)), y: Math.min(height - 1, Math.max(0, (event.clientY - box.top) / box.height * height)), label: pointLabel }]);
  };
  const pointMarkers = (width, height) => points.map((point, index) => <span key={index} className={styles.selectionPoint} data-include={point.label === 1} style={{ left: point.x / width * 100 + "%", top: point.y / height * 100 + "%" }}>{point.label ? "+" : "−"}</span>);
  const [requestId, setRequestId] = useState("");
  const [vectorizing, setVectorizing] = useState(null);
  const [upscaling, setUpscaling] = useState(null);
  const [svgDownloads, setSvgDownloads] = useState({});
  const [historyVersion, setHistoryVersion] = useState(0);
  const history = useRef({ past: [], future: [] });
  const remote = useRef(seed.current && !seed.current.preview ? seed.current.project : null);
  const saved = useRef(seed.current && !seed.current.preview ? JSON.stringify(seed.current.project.manifest.layers) : "");
  const drag = useRef(null);
  const worker = useRef(null);
  const exportAbort = useRef(null);
  const stage = useRef(null);
  const startGuide = useRef(null);
  const framedReview = useRef(null);
  const shortcuts = useRef(null);
  const operationPending = Boolean(job && activeStatuses.includes(job.status));
  const disabled = access !== "allowed" || busy || saving || operationPending || maskEditing;
  const autoSavingLayers = job?.status === "ready" && job.kind === "extract";
  const reviewing = job?.status === "ready" && !autoSavingLayers;
  const showingFailure = job?.status === "failed" && dismissedFailure !== job.id;
  const awaitingDispatch = job?.status === "submitting" && (job.billing_state === "held" && job.charge_amount > 0 || job.processor === "workflow") && !job.dispatch_started_at && !job.request_id;
  const recoveryView = showingFailure || job?.status === "submitting" && !awaitingDispatch;
  const previewing = reviewing || autoSavingLayers || job?.status === "saving" && Boolean(job.result?.layers?.length);
  const canvasLayers = previewing ? (job.result?.layers || []).map(layer => selectVariant(layer, versions[layer.id])) : layers;
  const selection = reviewing ? null : layers.find(layer => layer.id === selected);
  const focusedLayer = previewing ? canvasLayers.find(layer => layer.id === reviewSelected) : selection;
  const filteredLayers = [...layers].reverse().filter(layer => layer.name.toLowerCase().includes(layerQuery.trim().toLowerCase()) && (layerFilter === "all" || (layerFilter === "visible" ? layerVisible(layer,view) : !layerVisible(layer,view))));
  const layerListViewport = useRef(null);
  const processing = startingExtraction || awaitingDispatch || autoSavingLayers || Boolean(job && ["queued", "processing", "saving"].includes(job.status));
  const enhancementItems = job?.status === "saving" ? job.result?.enhancement?.items : null;
  const enhancingLayerId = enhancementItems?.find(item => !["done", "failed", "uncertain", "skipped"].includes(item.status))?.layerId;
  const targetLayerId = startingExtraction ? extractionTarget : enhancingLayerId || job?.layer_id || (job?.kind === "split" ? selected : null);
  const sourceProcessing = processing && !targetLayerId;
  const enhancing = Boolean(enhancementItems?.length);
  const enhancementFinished = enhancementItems?.filter(item => ["done", "failed", "uncertain", "skipped"].includes(item.status)).length || 0;
  const enhancementProgress = enhancing ? `${enhancementFinished} of ${enhancementItems.length} layers finished` : null;
  const progressStatus = startingExtraction || awaitingDispatch ? "starting" : enhancing ? "enhancing" : autoSavingLayers ? "saving" : job?.status;
  const progressPaused = Boolean(!startingExtraction && job?.pollingPaused);
  const navigation = useCanvasNavigation(stage, access === "allowed", drag, reducedMotion);
  const { camera, setCamera, setZoom } = navigation;
  const zoom = camera.zoom;
  useOpeningFrame({ enabled: access === "allowed" && !reviewing, frameKey: `${job?.id || "document"}:${job?.status === "accepted" ? "accepted" : previewing ? "preview" : "source"}`, viewport: stage, guide: startGuide, layers: canvasLayers, view, source: project.manifest, camera, setCamera });
  const progressMessage = job?.status === "queued" ? "Your design is waiting in the AI queue. Processing will start when a worker is available." : job?.status === "processing" ? "AI is separating your design into layers. Keep this page open or return to this project later." : job?.status === "saving" ? "AI processing is complete. Saving the extracted layers for preview…" : job?.status === "submitting" ? "The request needs reconciliation. See the Layers panel for recovery options." : null;

  const api = useCallback(async (path, options) => {
    try { return await designRequest(path, options); }
    catch (error) {
      if ([401, 403].includes(error.status)) {
        exportAbort.current?.abort(); forgetDesignProject(projectId); setAccess("denied"); setLayers([]); setJob(null); setMaskEditing(false);
        setProject({ id: projectId, source_url: null, manifest: { width: 240, height: 320, layers: [] } });
      }
      throw error;
    }
  }, [projectId]);
  const load = useCallback(data => {
    cacheDesignProject(data);
    if (data.billing) setPricing(data.billing);
    remote.current = data.project;
    saved.current = JSON.stringify(data.project.manifest.layers);
    setProject(data.project); setLayers(data.project.manifest.layers); setJob(data.job || null);
  }, []);
  useEffect(() => {
    let live = true;
    const placeholder = setTimeout(() => { if (live) setOpeningPlaceholder(true); }, 200);
    (async () => {
      try {
        const data = await fetchDesignProject(projectId, !seed.current || seed.current.preview || !seed.current.billing || reloadKey > 0);
        if (!live) return;
        load(data); setAccess("allowed"); setError(""); setOpeningPlaceholder(false);

      } catch (err) { if (live) { setAccess([401, 403, 404, 410].includes(err.status) ? "denied" : "unavailable"); setError(err.message); if ([401, 403, 404, 410].includes(err.status)) { setProject({ id: projectId, source_url: null, manifest: { width: 240, height: 320, layers: [] } }); setLayers([]); setJob(null); } } }
      finally { clearTimeout(placeholder); }
    })();
    return () => { live = false; clearTimeout(placeholder); exportAbort.current?.abort(); worker.current?.terminate(); };
  }, [load, projectId, reloadKey]);
  useEffect(() => {
    const clear = () => { exportAbort.current?.abort(); forgetDesignProject(projectId); setAccess("denied"); setProject({ id: projectId, source_url: null, manifest: { width: 240, height: 320, layers: [] } }); setLayers([]); setJob(null); setMaskEditing(false); setError("Your session changed. Sign in and reopen this document."); };
    const { data: { subscription } } = createClient().auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" || remote.current?.user_id && session?.user?.id && remote.current.user_id !== session.user.id) clear();
    });
    return () => subscription.unsubscribe();
  }, [projectId]);
  useEffect(() => {
    if (!project.expires_at) return;
    const remaining = Date.parse(project.expires_at) - Date.now();
    if (remaining > 2147483647) return;
    const timer = setTimeout(() => { exportAbort.current?.abort(); forgetDesignProject(projectId); setAccess("denied"); setLayers([]); setJob(null); setMaskEditing(false); setProject({ id: projectId, source_url: null, manifest: { width: 240, height: 320, layers: [] } }); setError("This project has expired."); }, Math.max(0, remaining));
    return () => clearTimeout(timer);
  }, [project.expires_at, projectId]);
  useEffect(() => {
    const offline = () => setJob(current => current && ["queued", "processing", "saving"].includes(current.status) ? { ...current, pollingPaused: true } : current);
    window.addEventListener("offline", offline);
    return () => window.removeEventListener("offline", offline);
  }, []);
  useEffect(() => {
    if (access !== "allowed" || !projectId || !job || (!awaitingDispatch && (!["queued", "processing", "saving"].includes(job.status) && !(job.status === "ready" && job.kind === "extract"))) || job.pollingPaused) return;
    let live = true;
    const timer = setTimeout(async () => {
      try { const data = await api(`/${projectId}/sync`, { method: "POST" }); if (live) { if (data.billing) setPricing(data.billing); if (data.project.revision !== remote.current?.revision) load(data); else { setJob(data.job ? { ...data.job, syncFailures: 0 } : null); cacheDesignProject(data); } setError(""); } }
      catch (err) { if (live) { const failures = (job.syncFailures || 0) + 1; setJob(current => current ? ({ ...current, syncFailures: failures, pollingPaused: failures >= 3 || [401, 403].includes(err.status) }) : null); if ([401, 403].includes(err.status)) setError(err.message); else if (failures >= 3) setError("Could not check extraction progress. Your document is preserved; use Resume checking to reconnect."); } }
    }, Math.min(16000, 4000 * 2 ** (job.syncFailures || 0)));
    if (job.pollingPaused) clearTimeout(timer);
    return () => { live = false; clearTimeout(timer); };
  }, [api, projectId, job, access, load, awaitingDispatch]);

  const persist = useCallback(async next => {
    if (!remote.current || saved.current === JSON.stringify(next)) return;
    setSaving(true);
    try {
      const data = await api(`/${projectId}`, { method: "PATCH", body: JSON.stringify({ revision: remote.current.revision, layers: next }) });
      remote.current = data.project; saved.current = JSON.stringify(next); setProject(data.project);
      cacheDesignProject({ project: data.project, job, billing: pricing });
    } finally { setSaving(false); }
  }, [api, projectId, job, pricing]);
  useEffect(() => {
    if (!project || disabled || error || drag.current || saved.current === JSON.stringify(layers)) return;
    const timer = setTimeout(() => persist(layers).catch(err => setError(err.message)), 1500);
    return () => clearTimeout(timer);
  }, [project, layers, disabled, persist, error, historyVersion]);
  useEffect(() => {
    const warn = event => { if (access === "allowed" && remote.current && saved.current !== JSON.stringify(layers)) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [layers, access]);
  const change = next => {
    if (disabled) return;
    forgetDesignProject(projectId);
    history.current.past.push(layers); if (history.current.past.length > 40) history.current.past.shift();
    history.current.future = []; setLayers(next); setHistoryVersion(value => value + 1);
  };
  const update = patch => change(layers.map(layer => layer.id === selected ? { ...layer, ...patch } : layer));
  const travel = direction => {
    const from = direction === "undo" ? history.current.past : history.current.future;
    const to = direction === "undo" ? history.current.future : history.current.past;
    if (disabled || !from.length) return;
    forgetDesignProject(projectId);
    to.push(layers); setLayers(from.pop()); setHistoryVersion(value => value + 1);
  };
  const run = async callback => { setError(""); setBusy(true); try { await callback(); } catch (err) { if (err.name !== "AbortError") setError(err.message); } finally { setBusy(false); } };
  const start = (kind, points, fromSource = false) => run(async () => {
    if (kind === "extract" || fromSource) setView("layout");
    setExtractionTarget(kind === "extract" || fromSource ? null : selected);
    setStartingExtraction(true);
    try {
    await persist(layers);
    const data = await api(`/${projectId}`, { method: "POST", body: JSON.stringify({ kind, layerId: kind === "extract" || fromSource ? null : selected, points, priceVersion: pricing?.priceVersion, acknowledgedClaws: pricing?.mode === "paid" ? pricing.prices[kind] : 0, idempotencyKey: crypto.randomUUID() }) });
    if (Number.isInteger(data.job?.creditsRemaining)) setPricing(current => current ? { ...current, balance: data.job.creditsRemaining } : current);
    setJob(data.job); setSegmentMode(false); setPoints([]); setVersions({}); forgetDesignProject(projectId);
    } catch (error) {
      try { load(await fetchDesignProject(projectId, true)); } catch { /* Keep the current document if recovery is offline. */ }
      throw error;
    } finally { setStartingExtraction(false); }
  });
  const review = accept => run(async () => {
    const data = await api(`/${projectId}`, { method: "POST", body: JSON.stringify({ action: accept ? "accept" : "reject", jobId: job.id, versions, revision: remote.current.revision }) });
    load(data); history.current = { past: [], future: [] }; setSelected(null); setReviewSelected(null); setLayerQuery(""); setLayerFilter("all"); setHistoryVersion(value => value + 1);
  });
  const fetchAsset = async (layer, variant, format, signal) => {
    const { data: { session } } = await createClient().auth.getSession();
    if (!session) throw new Error("Sign in to read artwork");
    const response = await fetch(`/api/design-extract/${projectId}/asset?layer=${encodeURIComponent(layer)}${variant ? `&variant=${variant}` : ""}${format ? `&format=${format}` : ""}`, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(65000)]) : AbortSignal.timeout(65000), headers: { Authorization: `Bearer ${session.access_token}` } });
    if (!response.ok) throw new Error("Could not download the layer. Try again.");
    return response.blob();
  };
  const upscaleImage = () => run(async () => {
    if(!selection || selection.kind === "svg")return;
    if(alreadyUpscaled(selection))throw new Error("This image is already upscaled.");
    const availability = layerUpscaleAvailability(selection);
    if (!availability.plan) throw new Error(availability.reason);
    const layerId=selection.id;setUpscaling(layerId);
    try {
      await persist(layers);
      const data=await api('/'+projectId+'/upscale',{method:'POST',body:JSON.stringify({layerId,revision:remote.current.revision})});
      load({...data,job});setSelected(layerId);history.current={past:[],future:[]};setHistoryVersion(value=>value+1);
    } catch(error) {
      try {load(await fetchDesignProject(projectId,true));} catch { /* Preserve the current document while offline. */ }
      throw error;
    } finally {setUpscaling(null);}
  });
  const convertSvg = () => run(async () => {
    if (!selection) return;
    const layer = selection;
    if(layer.kind === "svg"){download(await fetchAsset(layer.id,null,"svg"), `${layer.name.replace(/[^a-zA-Z0-9_-]/g,"_")}.svg`);return;}
    setVectorizing(layer.id);
    try {
      await persist(layers);
      const { data: { session } } = await createClient().auth.getSession();
      if (!session) throw new Error("Sign in to convert a layer.");
      const response = await fetch(`/api/design-extract/${projectId}/svg`, { method: "POST", headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ layerId: layer.id, attach: !svgDownloads[layer.id], revision: remote.current.revision }) });
      if (!response.ok) { const error = await response.json().catch(() => null); if(response.status===422)setSvgDownloads(current=>({...current,[layer.id]:layer.url})); throw new Error(error?.error || "SVG conversion failed. Your PNG is unchanged."); }
      if(svgDownloads[layer.id]){download(await response.blob(),`${layer.name}.svg`);return;}
      const data=await response.json();const before=layers;load({...data,job});setSelected(data.layerId);history.current={past:[...history.current.past,before],future:[]};setHistoryVersion(value=>value+1);setView("layout");
      const nextLayer=data.project.manifest.layers.find(item=>item.id===data.layerId);if(nextLayer&&stage.current){const p=nextLayer.layout;if(p.x*camera.zoom+camera.x<0||(p.x+nextLayer.width*p.scale)*camera.zoom+camera.x>stage.current.clientWidth-312)requestAnimationFrame(()=>frame(artworkBounds(data.project.manifest.layers,"layout",data.project.manifest),4));}
    } finally { setVectorizing(null); }
  });
  const exportFile = format => run(async () => {
    if (format === "psd") {
      const limit = designPsdLimit({ ...project.manifest, layers });
      if (limit) throw new Error(limit);
    }
    const controller = new AbortController(); exportAbort.current = controller;
    setExporting(format);
    try {
    await persist(layers);
    controller.signal.throwIfAborted();
    if (format === "png") { if (!selection) return; download(await fetchAsset(selected, null, null, controller.signal), `${selection.name.replace(/[^a-zA-Z0-9_-]/g, "_")}.png`); return; }
    const files = [];
    let exportBytes = 0;
    for (const layer of layers) {
      const file = await fetchAsset(layer.id,null,layer.kind === "svg" ? "svg" : undefined, controller.signal);
      exportBytes += file.size;
      if (exportBytes > 256 * 1024 * 1024) throw new Error("This export exceeds browser memory limits. Download individual layers instead.");
      files.push(file);
    }
    const source = format === "psd" ? await fetchAsset("source", null, null, controller.signal) : null;
    if (exportBytes + (source?.size || 0) > 256 * 1024 * 1024) throw new Error("This export exceeds browser memory limits. Download individual layers instead.");
    controller.signal.throwIfAborted();
    await new Promise((resolve, reject) => {
      const exporter = new Worker(new URL("./export.worker.js", import.meta.url)); worker.current = exporter;
      let finished = false;
      const finish = (error, blob) => {
        if (finished) return; finished = true;
        clearTimeout(deadline); controller.signal.removeEventListener("abort", cancel);
        exporter.terminate(); if (worker.current === exporter) worker.current = null;
        if (error) reject(error); else { download(blob, `design-extract.${format}`); resolve(); }
      };
      const cancel = () => finish(new DOMException("Export cancelled", "AbortError"));
      const deadline = setTimeout(() => finish(new Error("Export timed out. Download individual layers or ZIP instead.")), 120000);
      controller.signal.addEventListener("abort", cancel, { once: true });
      exporter.onmessage = ({ data }) => finish(data.error ? new Error(data.error) : null, data.blob);
      exporter.onerror = () => finish(new Error("Export failed. Try PNG/ZIP for large projects."));
      try { exporter.postMessage({ format, manifest: { ...project.manifest, layers }, files, source }); }
      catch (error) { finish(error); }
    });
    } finally { if (exportAbort.current === controller) exportAbort.current = null; setExporting(null); }
  });
  const frame = (bounds, maxZoom = view === "layout" ? 4 : 1) => {
    if (!stage.current) return;
    const inspectorWidth = stage.current.querySelector("[data-design-inspector]")?.getBoundingClientRect().width || 0;
    const next = frameArtwork(bounds, { width: Math.max(160, stage.current.clientWidth - (inspectorWidth ? inspectorWidth + 32 : 0)), height: stage.current.clientHeight - (startGuide.current ? 96 : 0) }, maxZoom);
    if (next) setCamera(next);
  };
  const fit = () => { if (project) frame(artworkBounds(canvasLayers, view, project.manifest, [boardElementBounds(startGuide.current)])); };
  const toggleCompare = () => {
    if (!compare) frame({ x: 0, y: 0, width: project.manifest.width, height: project.manifest.height });
    setCompare(value => !value); setView("composition"); setSegmentMode(false); setPoints([]);
  };
  const detailView = () => {
    if (!stage.current) return;
    const bounds = compare || !focusedLayer ? { x: 0, y: 0, width: project.manifest.width, height: project.manifest.height } : layerBounds(focusedLayer, view);
    const detailZoom = compare || !focusedLayer ? 1 : Math.min(4, 1 / focusedLayer[view].scale);
    setCamera({ zoom: detailZoom, x: stage.current.clientWidth / 2 - (bounds.x + bounds.width / 2) * detailZoom, y: stage.current.clientHeight / 2 - (bounds.y + bounds.height / 2) * detailZoom });
  };
  const focusLayer = layer => { if (layer && layerVisible(layer,view)) frame(layerBounds(layer, view), 2); };
  const selectLayer = id => {
    if (maskEditing) return;
    if (id !== selected && segmentMode) { setSegmentMode(false); setPoints([]); }
    setSelected(id);
    const target=layers.find(layer=>layer.id===id);
    if(target?.kind==='svg')requestAnimationFrame(()=>{if(!stage.current)return;const b=layerBounds(target,view),inspector=stage.current.querySelector('[data-design-inspector]');const freeWidth=stage.current.clientWidth-(inspector?inspector.getBoundingClientRect().width+32:0);if(b&&(b.x+b.width)*camera.zoom+camera.x>freeWidth)frame(artworkBounds(layers,view,project.manifest));});
    const viewport = layerListViewport.current;
    const row = viewport && [...viewport.querySelectorAll("[data-layer-row]")].find(element => element.dataset.layerRow === id);
    if (!row) return;
    const bounds = row.getBoundingClientRect(), listFrame = viewport.getBoundingClientRect();
    if (bounds.top < listFrame.top) viewport.scrollTop += bounds.top - listFrame.top;
    else if (bounds.bottom > listFrame.bottom) viewport.scrollTop += bounds.bottom - listFrame.bottom;
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
    const close = () => { for (const menu of [shortcuts.current]) if (menu) menu.open = false; };
    const outside = event => { for (const menu of [shortcuts.current]) if (menu?.open && !menu.contains(event.target)) menu.open = false; };
    window.addEventListener("resize", close); window.addEventListener("pointerdown", outside);
    return () => { window.removeEventListener("resize", close); window.removeEventListener("pointerdown", outside); };
  }, []);
  useEditorShortcuts({
    canEdit: !disabled && !maskEditing, canDelete: Boolean(selection && !selection.locked), hasSelection: Boolean(focusedLayer),
    save: () => run(() => persist(layers)), travel, fit, focus: () => focusLayer(focusedLayer), remove: deleteSelection,
    escape: () => { setSegmentMode(false); setPoints([]); setMaskEditing(false); setCompare(false); setSelected(null); setReviewSelected(null); if (shortcuts.current) shortcuts.current.open = false; if (drag.current) { setLayers(drag.current.before); drag.current = null; } },
  });
  const moveOrder = delta => {
    const index = layers.findIndex(layer => layer.id === selected), target = index + delta;
    if (target < 0 || target >= layers.length) return;
    const next = [...layers]; [next[index], next[target]] = [next[target], next[index]]; change(next);
  };
  const showStartGuide = access === "allowed" && view === "layout" && !layers.length && !operationPending && !segmentMode;
  const introHeight = Math.max(400, 240 * project.manifest.height / project.manifest.width);
  const introWidth = introHeight * project.manifest.width / project.manifest.height;
  return <StudioShell className={"garment-workspace-ui " + styles.shell + (reducedMotion ? " " + styles.reducedMotion : "")} title="Design Extract" onHome={() => router.push("/")} showCredits credits={pricing?.balance} onCreditsClick={() => router.push("/#pricing")} commandBarPosition="bottom" statusLeft={<><span className={styles.documentStatus}>{(busy || saving || exporting) && <Loader2 size={12} className={styles.spinner} />}{access === "checking" ? "Loading document" : exporting ? `Exporting ${exporting.toUpperCase()}…` : saving ? "Saving…" : busy ? "Working…" : job && activeStatuses.includes(job.status) ? autoSavingLayers ? "Saving layers…" : enhancing ? `Enhancing layers · ${enhancementFinished}/${enhancementItems.length}` : job.pollingPaused ? "Checking paused" : operationLabels[job.status] : (project ? (saved.current === JSON.stringify(layers) ? "All changes saved" : "Unsaved changes") : "Ready to upload")}</span>{project && <span className={styles.navigationHint}>Scroll to zoom · Space + drag to pan · F to focus · Shift+F to fit</span>}</>} statusRight={null} commandBar={project && <div className={styles.toolbar} role="toolbar" aria-label="Design editing tools">
    <ExtractionActions disabled={disabled} processing={processing} paused={progressPaused} progressLabel={progressPaused ? "Checking paused" : autoSavingLayers ? "Saving layers…" : enhancing ? "Enhancing layers…" : "Extracting…"} reviewing={reviewing} hasLayers={layers.length > 0} pricing={pricing} sourceSelected={segmentMode === "source"} onSource={() => { switchSegment("source"); setSelected(null); setView("layout"); requestAnimationFrame(() => frame(artworkBounds([], "layout", project.manifest), 4)); }} onReconstruct={() => start("extract")} />
    <div className={styles.viewSwitch} role="group" aria-label="Canvas view"><button title="Overview" aria-label="Overview" disabled={access !== "allowed" || maskEditing} aria-pressed={view === "layout"} onClick={() => setView("layout")}><LayoutGrid size={16} /></button><button title="Composition" aria-label="Composition" disabled={access !== "allowed" || maskEditing} aria-pressed={view === "composition"} onClick={() => setView("composition")}><Combine size={16} /></button></div>
    <div className={styles.controlGroup} role="group" aria-label="Edit history"><button title="Undo" aria-label="Undo" disabled={disabled || !history.current.past.length} onClick={() => travel("undo")}><Undo2 size={15} /></button><button title="Redo" aria-label="Redo" disabled={disabled || !history.current.future.length} onClick={() => travel("redo")}><Redo2 size={15} /></button></div>
    <button className={`${styles.saveAction} ${styles.iconAction}`} aria-label={saving ? "Saving…" : "Save changes"} title="Save changes · Ctrl / ⌘ S" disabled={disabled} aria-busy={saving} onClick={() => run(async () => { await persist(layers); })}>{saving ? <Loader2 size={14} className={styles.spinner} /> : <Save size={14} />}</button>
    <button disabled={access !== "allowed" || maskEditing || !canvasLayers.length} aria-pressed={compare} onClick={toggleCompare}>Compare</button><button disabled={access !== "allowed"} onClick={detailView}>100% detail</button><span className={styles.toolbarMeta}>{project.manifest.width} × {project.manifest.height} px · {canvasLayers.length} {reviewing ? "layers to review" : "layers"}</span>
    <button className={styles.quickExport} aria-label={exporting === "psd" ? "Exporting PSD…" : "Quick export PSD"} disabled={disabled || !layers.length} aria-busy={exporting === "psd"} title={layers.length ? "Advanced feature · Included" : "Extract and accept layers before exporting a PSD"} onClick={() => exportFile("psd")}>
      {exporting === "psd" ? <Loader2 size={18} className={styles.spinner} /> : <Image src="/brand-logos/adobe-photoshop.svg" width={20} height={20} alt="" aria-hidden="true" />}
      <span>{exporting === "psd" ? "Exporting…" : "Export PSD"}</span><Download size={14} />
    </button>
    <div className={styles.zoomGroup} role="group" aria-label="Canvas zoom"><button aria-label="Zoom out" disabled={access !== "allowed"} onClick={() => setZoom(value => Math.max(.05, value / 1.2))}><Minus size={14} /></button><span>{Math.round(zoom * 100)}%</span><button aria-label="Zoom in" disabled={access !== "allowed"} onClick={() => setZoom(value => Math.min(4, value * 1.2))}><Plus size={14} /></button><button aria-label="Fit" disabled={access !== "allowed" || maskEditing} title="Fit all artwork (Shift+F)" onClick={fit}><Scan size={16} /></button><button aria-label="Focus layer" title="Focus selected layer (F)" disabled={processing || access !== "allowed" || !focusedLayer || !layerVisible(focusedLayer,view)} onClick={() => focusLayer(focusedLayer)}><Focus size={15} /></button></div>
    <button className={styles.iconAction} aria-label="Reset layout" title="Reset layout · Restore overview arrangement" disabled={disabled} onClick={() => change(arrangeOverview(layers, project.manifest))}><RotateCcw size={16} /></button>
    <details className={styles.shortcutMenu} ref={shortcuts} onToggle={event => {
      if (!event.currentTarget.open) return;
      const bounds = event.currentTarget.querySelector("summary").getBoundingClientRect();
      const popover = event.currentTarget.querySelector("[data-shortcut-popover]");
      popover.style.left = Math.max(16, Math.min(window.innerWidth - 316, bounds.right - 300)) + "px";
      const height = popover.offsetHeight;
      const top = bounds.bottom + height + 10 > window.innerHeight - 16 ? bounds.top - height - 10 : bounds.bottom + 10;
      popover.style.top = Math.max(16, top) + "px";
    }}><summary aria-label="Keyboard shortcuts" title="Keyboard shortcuts"><Keyboard size={16} /></summary><div className={styles.shortcutPopover} data-shortcut-popover><h3>Workspace preferences</h3><label className={styles.motionPreference}><input type="checkbox" checked={reducedMotion} onChange={event => { setReducedMotion(event.target.checked); localStorage.setItem("design-extract-reduced-motion", String(event.target.checked)); }} />Reduced Motion</label><h3>Keyboard shortcuts</h3><dl>{[["Save", "Ctrl / ⌘ S"], ["Undo", "Ctrl / ⌘ Z"], ["Redo", "Ctrl / ⌘ Shift Z"], ["Focus selected layer", "F"], ["Fit all artwork", "Shift F"], ["Delete unlocked layer", "Delete"], ["Clear selection / exit tool", "Esc"], ["Pan over an element", "Space + drag"]].map(([label, key]) => <div key={label}><dt>{label}</dt><dd><kbd>{key}</kbd></dd></div>)}</dl></div></details>
  </div>}>
    {error && <WorkspaceNotice key={error} message={error} onDismiss={() => setError("")} onRetry={access !== "allowed" ? () => { setAccess("checking"); setError(""); setReloadKey(value => value + 1); } : undefined} />}
    <main className={styles.workspace} data-history-version={historyVersion}>
      <div className={styles.canvasShell}>
      <div className={styles.viewport} ref={stage} aria-busy={processing || access === "checking"} role="region" aria-label="Design canvas" tabIndex={0} data-panning={navigation.panning} data-pan-ready={navigation.spaceHeld} {...navigation.handlers}>

        {project && <div className={styles.canvasDetails} data-canvas-details aria-live="polite"><strong>{focusedLayer?.name || "Source artwork"}</strong><span>{focusedLayer?.kind === "svg" ? "SVG · " : ""}{focusedLayer?.width || project.manifest.width} × {focusedLayer?.height || project.manifest.height} px</span></div>}
        {selection && !maskEditing && !segmentMode && !compare && <LayerInspector key={selection.id} layer={selection} view={view} disabled={disabled} segmentMode={segmentMode} onUpdate={update} onForward={() => moveOrder(1)} onBackward={() => moveOrder(-1)} onDelete={deleteSelection} onSplit={() => start("split")} onSegment={() => { focusLayer(selection); switchSegment("layer"); }} splitPriceLabel={priceLabel("split")} segmentPriceLabel={priceLabel("segment")} onMask={() => { focusLayer(selection); setMaskEditing(true); setCompare(false); setSegmentMode(false); }} onVersion={version => run(async () => { await persist(layers); const data = await api("/" + projectId, { method: "PATCH", body: JSON.stringify({ action: "version", layerId: selected, version, revision: remote.current.revision }) }); load({ ...data, job }); history.current = { past: [], future: [] }; })} upscaling={upscaling === selection.id} onUpscale={upscaleImage} convertingSvg={vectorizing === selection.id} svgReady={selection.kind === "svg" || svgDownloads[selection.id] === selection.url} onConvertSvg={convertSvg} onDownload={() => exportFile("png")} onClose={() => { setSelected(null); setSegmentMode(false); }} />}
        {segmentMode && !processing && <section className={styles.selectionControls} data-design-inspector aria-label="Selection preview"><strong>Select visible content</strong><p>Add Include and Exclude points, then submit your selection.</p><div><button aria-pressed={pointLabel === 1} onClick={() => setPointLabel(1)}>Include</button><button aria-pressed={pointLabel === 0} onClick={() => setPointLabel(0)}>Exclude</button><button disabled={!points.length} onClick={() => setPoints(current => current.slice(0, -1))}>Undo point</button></div><small>{points.length} / 32 points · Original pixels preserved</small><div><button disabled={disabled || !points.some(point => point.label === 1)} onClick={() => start("segment", points, segmentMode === "source")}>Extract selection{priceLabel("segment")}</button><button onClick={() => { setSegmentMode(false); setPoints([]); }}>Cancel selection</button></div></section>}
        {compare && <label className={styles.compareControl} data-design-inspector>Source / Result<input aria-label="Source result comparison" type="range" min="0" max="100" value={comparison} onChange={event => setComparison(Number(event.target.value))} /></label>}
        {maskEditing && selection && <MaskEditor key={selection.id} layer={selection} view={view} camera={camera} busy={busy} fetchAsset={fetchAsset} onDiscard={() => setMaskEditing(false)} onApply={async (blob, softness, edgeCleanup) => {
          setBusy(true); setError("");
          try {
            await persist(layers);
            const { data: { session } } = await createClient().auth.getSession();
            if (!session) throw new Error("Sign in to apply the mask");
            const maskUrl = await uploadDesignFile({ file: new File([blob], "mask.png", { type: "image/png" }), token: session.access_token });
            const data = await api(`/${projectId}`, { method: "PATCH", body: JSON.stringify({ action: "mask", layerId: selected, maskUrl, softness, edgeCleanup, revision: remote.current.revision }) });
            load({ ...data, job }); setMaskEditing(false); history.current = { past: [], future: [] };
          } finally { setBusy(false); }
        }} />}
        {job?.status === "submitting" && !awaitingDispatch && !startingExtraction && <div className={styles.progress} role="status"><strong>Check submission</strong><p>{progressMessage}</p></div>}

        <div>
          <div data-design-board className={`${styles.board} ${view === "composition" ? styles.composition : ""}`} style={{ "--label-scale": 1 / zoom, width: view === "composition" ? project.manifest.width : 1600, height: view === "composition" ? project.manifest.height : Math.max(700, Math.ceil(layers.length / 4) * 300), transform: `translate(${camera.x}px, ${camera.y}px) scale(${zoom})` }}>
            {(view === "layout" || sourceProcessing) && <figure style={showStartGuide ? { width: introWidth } : undefined} className={`${styles.reference} ${segmentMode === "source" ? styles.sourceSelection : ""}`}><div className={styles.artworkFrame} style={{ aspectRatio: `${project.manifest.width} / ${project.manifest.height}` }}>{referencePreview && project.source_url && <img className={styles.referencePreview} src={referencePreview} alt="" aria-hidden="true" />}<img onLoad={() => setReferencePreview(null)} hidden={!project.source_url} src={project.source_url || undefined} alt="Original flat design" data-design-element={segmentMode === "source" ? "source" : undefined} onPointerDown={event => {
              if (segmentMode !== "source" || event.button !== 0 || disabled) return;
              event.preventDefault(); event.stopPropagation();
              addPoint(event, project.manifest.width, project.manifest.height);
            }} />{segmentMode === "source" && pointMarkers(project.manifest.width, project.manifest.height)}{sourceProcessing && <ExtractionProgress status={progressStatus} detail={enhancementProgress} operationId={job?.id} startedAt={job?.created_at} paused={progressPaused} />}</div></figure>}
            {showStartGuide && <section style={{ left: introWidth + 60, height: introHeight }} className={styles.emptyBoard} ref={startGuide} aria-label="Getting started with Design Extract">
              <span className={styles.emptyBoardIcon}><Layers3 size={22} /></span>
              <span className={styles.eyebrow}>Start with your artwork</span>
              <h2>{job?.status === "failed" ? <>Your original<br />is safe.</> : <>One design.<br />Individual elements.</>}</h2>
              <p>Automatically separate shapes, logos, text artwork, and design elements into transparent image layers.</p>
              <span className={styles.startHint}>{job?.status === "failed" ? "Use Recover existing result in the Layers panel to check the completed output." : <>Choose <strong>Extract elements</strong> to start. No manual selection needed.</>}</span>
              <small>Visible content only. Text may be split into letters; hidden areas are not reconstructed.</small>
            </section>}
            {compare && <img className={styles.comparisonSource} src={project.source_url} alt="Comparison source" style={{ width: project.manifest.width, height: project.manifest.height, clipPath: `inset(0 ${100 - comparison}% 0 0)` }} />}
            {compare && <span className={styles.comparisonDivider} style={{ left: project.manifest.width * comparison / 100, height: project.manifest.height }} />}
            {canvasLayers.map(layer => { const placement = layer[view]; return <div key={layer.id} className={`${styles.element} ${(previewing ? reviewSelected : selected) === layer.id ? styles.selected : ""}`} style={{ left: placement.x, top: placement.y, width: layer.width * placement.scale, height: layer.height * placement.scale, display: layerVisible(layer,view) && !(maskEditing && selected === layer.id) ? "block" : "none", clipPath: compare ? `inset(0 0 0 ${Math.max(0, Math.min(100, (project.manifest.width * comparison / 100 - placement.x) / (layer.width * placement.scale) * 100))}%)` : undefined, zIndex: canvasLayers.indexOf(layer) + 1 }}
              data-design-element title={`${layer.name} · ${layer.width} × ${layer.height} px`} role="button" tabIndex={0} aria-label={`${previewing ? "Inspect generated" : "Select"} ${layer.name}`} aria-pressed={(previewing ? reviewSelected : selected) === layer.id}
              onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); if (reviewing) setReviewSelected(layer.id); else selectLayer(layer.id); } }}
              onPointerDown={event => {
                if (event.button !== 0 || maskEditing) return;
                if (previewing) { setReviewSelected(layer.id); return; }
                if (compare || previewing) return;
                if (segmentMode === "layer" && layer.id !== selected) return;
                selectLayer(layer.id);
                if (segmentMode === "layer" && layer.id === selected) { addPoint(event, layer.width, layer.height); return; }
                if (disabled || layer.locked) return;
                event.currentTarget.setPointerCapture(event.pointerId);
                drag.current = { id: layer.id, x: event.clientX, y: event.clientY, placement, before: layers };
              }}
              onPointerMove={event => { const d = drag.current; if (!d || d.id !== layer.id) return; setLayers(d.before.map(item => item.id === d.id ? { ...item, [view]: { ...d.placement, x: d.placement.x + (event.clientX - d.x) / zoom, y: d.placement.y + (event.clientY - d.y) / zoom } } : item)); }}
              onPointerUp={() => { if (drag.current) { forgetDesignProject(projectId); history.current.past.push(drag.current.before); if (history.current.past.length > 40) history.current.past.shift(); history.current.future = []; drag.current = null; setHistoryVersion(value => value + 1); } }}
              onPointerCancel={() => { if (drag.current) setLayers(drag.current.before); drag.current = null; }}>
              <img src={layer.url} alt={layer.name} draggable={false} />{segmentMode === "layer" && selected === layer.id && pointMarkers(layer.width, layer.height)}{upscaling === layer.id && <ExtractionProgress status="upscaling" operationId={`upscale-${layer.id}`} compact />}{vectorizing === layer.id && <ExtractionProgress status="vectorizing" operationId={`svg-${layer.id}`} compact />}{processing && !sourceProcessing && targetLayerId === layer.id && <ExtractionProgress status={progressStatus} detail={enhancementProgress} operationId={job?.id} startedAt={job?.created_at} paused={progressPaused} compact />}
            </div>; })}
          </div>
        </div>
      </div>
      </div>
      <aside className={styles.panel} data-recovery={recoveryView}>
        <header className={styles.panelHeading}><h2><Layers3 size={17} />Layers</h2><span>{previewing ? canvasLayers.length : layers.length}<small>{reviewing ? " new" : " / 32"}</small></span></header>


        {access === "checking" && openingPlaceholder && <div className={styles.openingSkeleton} role="status" aria-label="Loading layers"><span /><span /><span /></div>}
        {job?.status === "accepted" && job.result?.warnings?.length > 0 && <details className={styles.extractionNote}><summary>Extraction notes</summary>{job.result.warnings.map((warning, index) => <p key={index}>{warning.replaceAll("before accepting", "before production")}</p>)}</details>}
        {job?.status === "submitting" && !awaitingDispatch && <section className={styles.properties}><p role="status">Submission needs reconciliation. Find this operation in fal history by its source image and creation time. No automatic resubmission.</p><label>fal request ID<input value={requestId} onChange={event => setRequestId(event.target.value)} /></label><button disabled={busy || !requestId} onClick={() => run(async () => { const data = await api(`/${projectId}`, { method: "POST", body: JSON.stringify({ action: "reconcile", jobId: job.id, requestId }) }); setJob(data.job); })}>Reconnect existing request</button></section>}
        {showingFailure && <section className={styles.failedResult}>
          <h3>Extraction needs attention</h3><p role="alert">{job.error}</p>
          <p>Your original artwork is safe. Recover the existing result before starting another extraction.</p>
          {(job.canRecover || job.request_id) && <button disabled={busy || saving} onClick={() => run(async () => { const data = await api(`/${projectId}`, { method: "POST", body: JSON.stringify({ action: "recover", jobId: job.id }) }); setJob(data.job); })}>{busy ? <Loader2 size={14} className={styles.spinner} /> : <RotateCcw size={14} />}{busy ? "Recovering result…" : "Recover existing result"}</button>}
          <small>Recovery does not start a new AI generation.</small>
          {layers.length > 0 && <button disabled={busy} onClick={() => setDismissedFailure(job.id)}>Show saved layers</button>}
        </section>}
        {job?.status === "failed" && !showingFailure && <button className={styles.issueToggle} onClick={() => setDismissedFailure(null)}>View extraction issue</button>}
        {job?.pollingPaused && <button onClick={() => setJob(current => ({ ...current, pollingPaused: false, syncFailures: 0 }))}>Resume checking</button>}
        {reviewing && <ExtractionReview job={{ ...job, result: { ...job.result, layers: canvasLayers } }} versions={versions} onVersion={(id, version) => setVersions(current => ({ ...current, [id]: version }))} selectedId={reviewSelected} busy={busy} onPreview={layer => { setReviewSelected(layer.id); focusLayer(layer); }} onAccept={() => review(true)} onDiscard={() => review(false)} />}
        {processing && <div className={styles.pendingLayers} role="status">{progressPaused ? <Layers3 size={16} /> : <Loader2 size={16} className={styles.spinner} />}<div><strong>{progressPaused ? "Checking paused" : enhancing ? "Enhancing your layers" : job?.status === "saving" ? "Saving your layers" : "Extraction in progress"}</strong><p>{progressPaused ? "Resume checking below to reconnect." : enhancing ? `${enhancementProgress}. Your elements keep their transparency and placement.` : "Previews appear here when the result is ready. You can return to this project later."}</p></div></div>}
        {enhancing && previewing && <section className={styles.basePreviews} aria-label="Available layer previews"><small>Base previews · Enhancement in progress</small><div>{canvasLayers.map(layer => <button key={layer.id} onClick={() => { setReviewSelected(layer.id); focusLayer(layer); }}><img src={layer.url} alt="" /><span>{layer.name}<small>{layer.baseVariant?.width || layer.width} × {layer.baseVariant?.height || layer.height} px base</small></span></button>)}</div></section>}
        {!previewing && layers.length > 0 && <div className={styles.layerTools}>
          <label className={styles.layerSearch}><Search size={14} aria-hidden="true" /><input aria-label="Search layers" placeholder="Search layers…" value={layerQuery} onChange={event => { setLayerQuery(event.target.value); layerListViewport.current?.scrollTo({ top: 0 }); }} /></label>
          <div className={styles.layerFilterRow}><select aria-label="Filter layers" value={layerFilter} onChange={event => { setLayerFilter(event.target.value); layerListViewport.current?.scrollTo({ top: 0 }); }}><option value="all">All layers</option><option value="visible">Visible only</option><option value="hidden">Hidden only</option></select><span aria-live="polite">{filteredLayers.length} of {layers.length}</span></div>
        </div>}
        {!previewing && layers.length > 0 && <div className={`${styles.layerListViewport} ${styles.scrollableLayerList}`} ref={layerListViewport} data-layer-scroll role="region" aria-label="Layer list" tabIndex={0}><div className={styles.layerList}>{filteredLayers.map(layer => <div key={layer.id} data-layer-row={layer.id} className={selected === layer.id ? styles.activeRow : styles.row}>
          <button className={styles.layerSelect} disabled={maskEditing} title="Select layer; double-click to focus on canvas" aria-pressed={selected === layer.id} onClick={() => selectLayer(layer.id)} onDoubleClick={() => focusLayer(layer)}><span className={styles.thumbnail}><img src={layer.kind === "svg" ? layer.previewUrl : layer.url} alt="" /></span><span className={styles.layerCopy}><strong>{layer.name}</strong><small>{layer.kind === "svg" ? "SVG · " : ""}{layer.width} × {layer.height} px{layer.enhancement ? ` · ${layer.enhancement.scale}× enhanced` : ""}{layer.locked ? " · Locked" : ""}</small></span></button>
          <label className={styles.visibility} title={`${layerVisible(layer,view) ? "Hide" : "Show"} in ${view === "layout" ? "Overview" : "Composition"}`}><input aria-label={`Show ${layer.name}`} type="checkbox" checked={layerVisible(layer,view)} disabled={disabled} onChange={event => change(layers.map(item => item.id === layer.id ? { ...item, visible: view === "composition" ? event.target.checked : item.visible, visibility: { overview: layerVisible(item,"layout"), composition: layerVisible(item,"composition"), [view === "layout" ? "overview" : "composition"]: event.target.checked } } : item))} />{layerVisible(layer,view) ? <Eye size={15} /> : <EyeOff size={15} />}</label>
        </div>)}</div>
        {!filteredLayers.length && <div className={styles.noLayerMatches}><strong>No matching layers</strong><button onClick={() => { setLayerQuery(""); setLayerFilter("all"); layerListViewport.current?.scrollTo({ top: 0 }); }}>Clear filters</button></div>}
        </div>}
        {access === "allowed" && !layers.length && !operationPending && job?.status !== "failed" && <div className={styles.emptyLayers}><Layers3 size={26} /><strong>No layers yet</strong><p>Your extracted elements will appear here.</p><ol className={styles.quickSteps}><li><span>1</span>Extract your design</li><li><span>2</span>Review and accept layers</li><li><span>3</span>Arrange and export</li></ol></div>}
        {!previewing && layers.length > 0 && <div className={styles.exports}><h3>Export artwork</h3><button disabled={disabled || !layers.length} onClick={() => exportFile("zip")}><Download size={14} />Download all · ZIP</button><button disabled={disabled || !layers.length} onClick={() => exportFile("psd")}><Layers3 size={14} />Export layered PSD</button></div>}
      </aside>
    </main>
  </StudioShell>;
}
