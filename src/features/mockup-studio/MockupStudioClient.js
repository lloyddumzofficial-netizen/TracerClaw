"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { createClient } from "@/utils/supabase/client";
import { safeJson } from "@/lib/safeJson";
import { toast } from "@/components/ui/Toast";
import {
  DEFAULT_MOCKUP_COLORS, MOCKUP_BACKDROP_PRESETS, MOCKUP_FABRIC_PRESETS, MOCKUP_PARTS,
  MOCKUP_RENDER_COST, MOCKUP_SHOTS, MOCKUP_STYLE_PRESETS,
  MOCKUP_TOTAL_MAX_BYTES, formatMockupMegabytes,
  validateMockupAsset,
} from "./config";
import styles from "./mockupStudio.module.css";
import { AVAILABLE_GARMENT_CATALOG, DEFAULT_GARMENT_TYPE, getGarmentProfile, getGarmentParts, getGarmentShotLabel, getSafeGarmentType } from "./garmentCatalog";
import TemplateGarmentPreview, { hasGarmentTemplate } from "./preview/TemplateGarmentPreview";
import MockupReviewModal from "./review/MockupReviewModal";
import { getMockupRenderStage } from "./review/renderProgress";
import { downloadMockupSetZip, exportCampaignBoard } from "./exports/clientExports";
import PanelFitModal from "./panelPreparation/PanelFitModal";
import { getPanelPreparationSpec } from "./panelPreparation/panelSpecs";
import MockupPreflightModal from "./preflight/MockupPreflightModal";

const INITIAL_COLORS = { ...DEFAULT_MOCKUP_COLORS };

function makeRequestKey() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}_mockup`;
}

function formatProjectDate(value) {
  if (!value) return "Recently updated";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

async function putWithRetry(uploadUrl, file) {
  let error;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
      if (response.ok) return;
      error = new Error(`Storage upload failed (${response.status}).`);
    } catch (caught) {
      error = caught;
    }
    if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 600));
  }
  throw error || new Error("Storage upload failed.");
}

function AssetSlot({ role, asset, busy, required, spec, onChoose, onRemove }) {
  const part = MOCKUP_PARTS[role];
  const actionLabel = busy ? "Uploading" : asset ? "Replace" : "Upload";
  return (
    <article className={`${styles.assetSlot} ${asset ? styles.assetReady : ""}`}>
      <button type="button" className={`${styles.assetButton} ${!asset ? styles.assetButtonEmpty : ""}`} onClick={() => onChoose(role)} disabled={busy} aria-label={`${actionLabel} ${part.label}`}>
        {asset ? <span className={styles.assetPreview}><img src={asset.file_url} alt={`${part.label} preview`} /></span> : null}
        <span className={styles.assetCopy}>
          <strong>{part.label}{required ? <em>Required</em> : null}</strong>
          <small>{asset ? `${asset.width} × ${asset.height}px` : spec ? `${spec.width} × ${spec.height}px · fit required` : `PNG, JPG or WebP · ${formatMockupMegabytes(part.maxBytes)} max`}</small>
        </span>
        <span className={styles.assetAction} data-busy={busy ? "true" : undefined}>
          {asset && !busy ? <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 8 2.4 2.4L12 5" /></svg> : <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 11V3m0 0L5 6m3-3 3 3M3 10v3h10v-3" /></svg>}
          <span>{actionLabel}</span>
        </span>
      </button>
      {asset && <button type="button" className={styles.assetRemove} onClick={() => onRemove(role)} aria-label={`Remove ${part.label}`}>×</button>}
    </article>
  );
}

function CampaignStyleIcon({ type }) {
  if (type === "editorial") {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v2m0 0c-1.7 0-2.7 1.1-2.7 2.4 0 1 .6 1.8 1.5 2.2L4 16.2V19h16v-2.8l-6.8-5.6" /><path d="M4 16.2h16" /></svg>;
  }
  if (type === "performance") {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 16.5a8 8 0 1 1 14 0" /><path d="m12 13 4-4" /><path d="M8 18h8" /></svg>;
  }
  return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="6.5" width="17" height="12" rx="2" /><circle cx="12" cy="12.5" r="3.2" /><path d="M8 6.5 9.2 4.8h5.6L16 6.5" /></svg>;
}

function RenderVisualizer({ active, index }) {
  return (
    <div className={`${styles.renderVisualizer} ${active ? styles.renderVisualizerActive : ""}`} aria-label={active ? `Rendering view ${index + 1}` : `View ${index + 1} queued`}>
      <span className={active ? styles.normalSpinner : styles.queuedIndicator} aria-hidden="true" />
      <span className={styles.normalLoaderLabel}>{active ? "Generating preview…" : "Queued"}</span>
    </div>
  );
}

function CampaignProcessingOverlay({ completed, stage }) {
  const progress = completed === 0 ? 6 : Math.min(96, completed * 20);
  const detail = completed === 0
    ? "Building the production reference and matching the supplied artwork"
    : completed === 1
      ? "Hero anchor approved; matching the remaining camera views"
      : `Preserving placement across ${MOCKUP_SHOTS.length - completed} remaining view${MOCKUP_SHOTS.length - completed === 1 ? "" : "s"}`;
  return (
    <div className={styles.campaignProcessing} aria-live="polite" aria-label={`${stage.label}. ${detail}`}>
      <section className={styles.processingPanel}>
        <header><span><i />Campaign render</span><strong>{completed}<em>/5 views</em></strong></header>
        <div className={styles.processingProgress} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><i style={{ width: `${progress}%` }}><b /></i></div>
        <h3>{stage.label}</h3>
        <p>{detail}</p>
      </section>
    </div>
  );
}

function GarmentPreview({ assets, colors, garmentType }) {
  const profile = getGarmentProfile(garmentType);
  if (hasGarmentTemplate(garmentType)) {
    return (
      <div className={styles.previewStage}>
        <TemplateGarmentPreview garmentType={garmentType} assets={assets} colors={colors} />
      </div>
    );
  }
  if (profile.kind === "shorts") {
    return (
      <div className={styles.previewStage}>
        <div className={styles.previewGrid} aria-label="Basketball shorts technical preview" style={{ "--backdrop": colors.backdrop }}>
          <div className={styles.shortsPreview}>{assets.shorts_front ? <img src={assets.shorts_front.file_url} alt="Shorts front" /> : <span>FRONT</span>}<i /></div>
          <div className={styles.shortsPreview}>{assets.shorts_back ? <img src={assets.shorts_back.file_url} alt="Shorts back" /> : <span>BACK</span>}<i /></div>
        </div>
        <div className={styles.previewLegend}><span>Exact source preview</span><span>{profile.label}</span></div>
      </div>
    );
  }
  return (
    <div className={styles.previewStage}>
      <div className={styles.previewGrid} aria-label="Technical panel preview" style={{ "--backdrop": colors.backdrop }}>
        <div className={styles.previewGarment} style={{ "--body": "#FFFFFF", "--collar": colors.collar, "--left-cuff": colors.leftCuff, "--right-cuff": colors.rightCuff }}>
          <div className={`${styles.previewSleeve} ${styles.previewSleeveLeft}`}>
            {assets.left_sleeve && <img src={assets.left_sleeve.file_url} alt="Left sleeve" />}
          </div>
          <div className={styles.previewBody}>
            {assets.front && <img src={assets.front.file_url} alt="Front body" />}
            <span className={styles.previewCollar} />
          </div>
          <div className={`${styles.previewSleeve} ${styles.previewSleeveRight}`}>
            {assets.right_sleeve && <img src={assets.right_sleeve.file_url} alt="Right sleeve" />}
          </div>
        </div>
        <div className={styles.backPanel} style={{ backgroundColor: "#FFFFFF" }}>
          {assets.back ? <img src={assets.back.file_url} alt="Back body" /> : <span>BACK</span>}
        </div>
        {profile.kind === "kit" ? <div className={styles.kitBottom}>{assets.shorts_front ? <img src={assets.shorts_front.file_url} alt="Shorts front" /> : <span>SHORTS</span>}</div> : null}
      </div>
      <div className={styles.previewLegend}>
        <span>Exact source preview</span>
        <span>{profile.label} · v2</span>
      </div>
    </div>
  );
}

export default function MockupStudioClient() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const fileInputRef = useRef(null);
  const activeRoleRef = useRef(null);
  const pollRef = useRef(null);
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [credits, setCredits] = useState(null);
  const [project, setProject] = useState(null);
  const [projectName, setProjectName] = useState("Premium Jersey Campaign");
  const [garmentType, setGarmentType] = useState(DEFAULT_GARMENT_TYPE);
  const [assets, setAssets] = useState({});
  const [colors, setColors] = useState(INITIAL_COLORS);
  const [stylePreset, setStylePreset] = useState("studio");
  const [styleReviewed, setStyleReviewed] = useState(false);
  const [backdropReviewed, setBackdropReviewed] = useState(false);
  const [uploadingRole, setUploadingRole] = useState(null);
  const [creating, setCreating] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [job, setJob] = useState(null);
  const [outputs, setOutputs] = useState([]);
  const [recentProjects, setRecentProjects] = useState([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [openingProjectId, setOpeningProjectId] = useState(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [preflightOpen, setPreflightOpen] = useState(false);
  const [exportingAction, setExportingAction] = useState(null);
  const [retryUsed, setRetryUsed] = useState(false);
  const [panelFit, setPanelFit] = useState(null);

  const authedFetch = useCallback(async (url, options = {}) => {
    const current = session || (await supabase.auth.getSession()).data.session;
    if (!current?.access_token) throw new Error("Please sign in again.");
    return fetch(url, { ...options, headers: { ...(options.headers || {}), Authorization: `Bearer ${current.access_token}` } });
  }, [session, supabase]);

  useEffect(() => {
    let alive = true;
    const authTimeout = window.setTimeout(() => {
      if (alive) setAuthReady(true);
    }, 8_000);
    supabase.auth.getSession().then(async ({ data }) => {
      if (!alive) return;
      window.clearTimeout(authTimeout);
      setSession(data.session || null);
      setAuthReady(true);
      if (data.session?.user?.id) {
        const { data: profile } = await supabase.from("profiles").select("credits").eq("id", data.session.user.id).single();
        if (alive) setCredits(profile?.credits ?? 0);
      }
    }).catch(() => {
      if (!alive) return;
      window.clearTimeout(authTimeout);
      setSession(null);
      setAuthReady(true);
    });
    return () => {
      alive = false;
      window.clearTimeout(authTimeout);
    };
  }, [supabase]);

  useEffect(() => () => { if (pollRef.current) clearTimeout(pollRef.current); }, []);

  const totalBytes = Object.values(assets).reduce((sum, asset) => sum + Number(asset.file_size || 0), 0);
  const garmentProfile = getGarmentProfile(garmentType);
  const garmentParts = getGarmentParts(garmentType);
  const colorLabels = garmentProfile.kind === "shorts"
    ? { collar: "Waistband", leftCuff: "Left trim", rightCuff: "Right trim" }
    : garmentType === "polo_jersey"
      ? { collar: "Collar", placket: "Placket", leftCuff: "Left cuff", rightCuff: "Right cuff" }
      : { collar: "Collar", leftCuff: "Left cuff", rightCuff: "Right cuff" };
  const requiredReady = garmentParts.required.every(role => assets[role]);
  const artDirectionReady = styleReviewed && backdropReviewed;
  const renderReady = requiredReady && artDirectionReady;
  const reviewShots = useMemo(() => MOCKUP_SHOTS.map(shot => ({ ...shot, label: getGarmentShotLabel(garmentType, shot.key) })), [garmentType]);
  const renderStage = getMockupRenderStage({ rendering, status: job?.status, completed: outputs.length, total: MOCKUP_SHOTS.length });
  const campaignComplete = outputs.length === MOCKUP_SHOTS.length && job?.status === "completed";
  const nextPendingViewIndex = MOCKUP_SHOTS.findIndex(shot => !outputs.some(item => item.view_type === shot.key));

  const createProject = async () => {
    setCreating(true);
    try {
      const response = await authedFetch("/api/mockups", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: projectName, garmentType }),
      });
      const data = await safeJson(response, "Could not create mockup project");
      if (!response.ok) throw new Error(data.error);
      setProject(data.project);
      toast.success("Mockup project ready. Upload the four required panels.");
    } catch (error) {
      toast.error(error.message || "Could not create mockup project.");
    } finally {
      setCreating(false);
    }
  };

  const chooseAsset = role => {
    activeRoleRef.current = role;
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
      fileInputRef.current.click();
    }
  };

  const uploadAsset = async (file, explicitRole) => {
    const role = explicitRole || activeRoleRef.current;
    if (!file || !role || !project) return;
    const validation = validateMockupAsset({ role, contentType: file.type, fileSize: file.size });
    if (!validation.ok) return toast.error(validation.error);
    if (totalBytes - Number(assets[role]?.file_size || 0) + file.size > MOCKUP_TOTAL_MAX_BYTES) {
      return toast.error("This project is limited to 150MB of source assets.");
    }
    setUploadingRole(role);
    try {
      const presignResponse = await authedFetch(`/api/mockups/${project.id}/assets/presign`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, contentType: file.type, fileSize: file.size }),
      });
      const presign = await safeJson(presignResponse, "Could not prepare upload");
      if (!presignResponse.ok) throw new Error(presign.error);
      await putWithRetry(presign.uploadUrl, file);
      const registerResponse = await authedFetch(`/api/mockups/${project.id}/assets`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, contentType: file.type, fileSize: file.size, fileUrl: presign.publicUrl }),
      });
      const registered = await safeJson(registerResponse, "Could not verify upload");
      if (!registerResponse.ok) throw new Error(registered.error);
      setAssets(current => ({ ...current, [role]: registered.asset }));
      toast.success(`${MOCKUP_PARTS[role].label} uploaded.`);
    } catch (error) {
      toast.error(error.message || "Upload failed.");
    } finally {
      setUploadingRole(null);
    }
  };

  const prepareSelectedAsset = file => {
    const role = activeRoleRef.current;
    if (!file || !role || !project) return;
    const validation = validateMockupAsset({ role, contentType: file.type, fileSize: file.size });
    if (!validation.ok) return toast.error(validation.error);
    const spec = getPanelPreparationSpec(garmentType, role);
    if (spec) {
      setPanelFit({ file, role });
      return;
    }
    uploadAsset(file, role);
  };

  const removeAsset = async role => {
    if (!project) return;
    try {
      const response = await authedFetch(`/api/mockups/${project.id}/assets?role=${encodeURIComponent(role)}`, { method: "DELETE" });
      const data = await safeJson(response, "Could not remove asset");
      if (!response.ok) throw new Error(data.error);
      setAssets(current => {
        const next = { ...current };
        delete next[role];
        return next;
      });
    } catch (caught) {
      toast.error(caught.message || "Could not remove asset.");
    }
  };

  const pollJob = useCallback(async jobId => {
    try {
      const response = await authedFetch(`/api/mockups/jobs/${jobId}`);
      const data = await safeJson(response, "Could not check render status");
      if (!response.ok) throw new Error(data.error);
      setJob(data.job);
      setOutputs(data.outputs || []);
      if (data.job.status === "completed") {
        setRendering(false);
        setReviewOpen(true);
        if (data.job.retryFailed) toast.error("The correction could not finish. Your original view was kept, and no Claws were charged.");
        else toast.success("Your five-view premium mockup set is ready.");
        return;
      }
      if (["failed", "refunded"].includes(data.job.status)) {
        setRendering(false);
        if (data.refunded || data.job.status === "refunded") setCredits(value => Number(value || 0) + MOCKUP_RENDER_COST);
        toast.error("The render could not finish. Your Claws were restored.");
        return;
      }
      pollRef.current = setTimeout(() => pollJob(jobId), 5000);
    } catch {
      pollRef.current = setTimeout(() => pollJob(jobId), 8000);
    }
  }, [authedFetch]);

  const hydrateProject = useCallback(data => {
    setPanelFit(null);
    setPreflightOpen(false);
    setProject(data.project);
    setProjectName(data.project.name);
    setGarmentType(getSafeGarmentType(data.project.garment_type));
    setColors({ ...INITIAL_COLORS, ...(data.project.colors || {}) });
    setStylePreset(data.project.style_preset || "studio");
    setStyleReviewed(false);
    setBackdropReviewed(false);
    setAssets(Object.fromEntries((data.assets || []).map(asset => [asset.role, asset])));
    setOutputs(data.outputs || []);
    setJob(data.latestJob || null);
    setRetryUsed(Boolean(data.latestJob?.provider_requests?._retryUsed));
    if (data.latestJob && ["queueing", "queued", "processing"].includes(data.latestJob.status)) {
      setRendering(true);
      pollJob(data.latestJob.id);
    } else {
      setRendering(false);
    }
  }, [pollJob]);

  useEffect(() => {
    if (!session || project) return;
    let cancelled = false;
    setLoadingProjects(true);
    authedFetch("/api/mockups").then(async response => {
      const data = await safeJson(response, "Could not load recent mockup projects");
      if (!response.ok) throw new Error(data.error);
      if (!cancelled) setRecentProjects(data.projects || []);
    }).catch(error => {
      if (!cancelled) toast.error(error.message || "Could not load recent mockup projects.");
    }).finally(() => {
      if (!cancelled) setLoadingProjects(false);
    });
    return () => { cancelled = true; };
  }, [authedFetch, project, session]);

  const openProject = async projectId => {
    setOpeningProjectId(projectId);
    try {
      const response = await authedFetch(`/api/mockups/${projectId}`);
      const data = await safeJson(response, "Could not open mockup project");
      if (!response.ok) throw new Error(data.error);
      hydrateProject(data);
    } catch (error) {
      toast.error(error.message || "Could not open mockup project.");
    } finally {
      setOpeningProjectId(null);
    }
  };

  const generate = async () => {
    if (!requiredReady || !project) return toast.error("Upload all four required panels first.");
    if (!artDirectionReady) return toast.error("Choose a campaign style and backdrop before generating.");
    if (Number(credits || 0) < MOCKUP_RENDER_COST) return toast.error("You need 2 Claws for a five-view mockup set.");
    setPreflightOpen(false);
    setRendering(true);
    setReviewOpen(false);
    setPanelFit(null);
    setRetryUsed(false);
    setOutputs([]);
    try {
      const settingsResponse = await authedFetch(`/api/mockups/${project.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: projectName, colors, stylePreset }),
      });
      const settings = await safeJson(settingsResponse, "Could not save mockup settings");
      if (!settingsResponse.ok) throw new Error(settings.error);
      setProject(settings.project);

      const response = await authedFetch(`/api/mockups/${project.id}/render`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestKey: makeRequestKey() }),
      });
      const data = await safeJson(response, "Could not start premium render");
      if (!response.ok) throw Object.assign(new Error(data.error), { refunded: data.refunded });
      setCredits(data.creditsRemaining ?? Math.max(0, Number(credits || 0) - MOCKUP_RENDER_COST));
      setJob({ id: data.jobId, status: data.status });
      pollJob(data.jobId);
    } catch (error) {
      setRendering(false);
      toast.error(error.message || "Could not start premium render.");
    }
  };

  const openPreflight = () => {
    if (!requiredReady || !project) return toast.error("Upload all four required panels first.");
    if (!artDirectionReady) return toast.error("Choose a campaign style and backdrop before generating.");
    if (Number(credits || 0) < MOCKUP_RENDER_COST) return toast.error("You need 2 Claws for a five-view mockup set.");
    setPreflightOpen(true);
  };

  const startNewProject = () => {
    if (rendering) return toast.error("Wait for the current render to finish before starting another project.");
    if (pollRef.current) clearTimeout(pollRef.current);
    setProject(null);
    setProjectName("Premium Jersey Campaign");
    setGarmentType(DEFAULT_GARMENT_TYPE);
    setAssets({});
    setColors({ ...INITIAL_COLORS });
    setStylePreset("studio");
    setStyleReviewed(false);
    setBackdropReviewed(false);
    setJob(null);
    setOutputs([]);
    setReviewOpen(false);
    setPreflightOpen(false);
    setRetryUsed(false);
    setPanelFit(null);
  };

  const downloadAllViews = async () => {
    setExportingAction("zip");
    try {
      await downloadMockupSetZip({ outputs, projectName, shots: reviewShots });
      toast.success("Your five-view ZIP is ready.");
    } catch (error) {
      toast.error(error.message || "Could not download the mockup set.");
    } finally {
      setExportingAction(null);
    }
  };

  const downloadCampaignBoard = async () => {
    setExportingAction("board");
    try {
      await exportCampaignBoard({ outputs, projectName, garmentLabel: garmentProfile.label, backdrop: colors.backdrop, shots: reviewShots });
      toast.success("Campaign board exported.");
    } catch (error) {
      toast.error(error.message || "Could not export the campaign board.");
    } finally {
      setExportingAction(null);
    }
  };

  const retryCampaignView = async viewType => {
    if (!job?.id || retryUsed) return;
    setExportingAction("retry");
    try {
      const response = await authedFetch(`/api/mockups/jobs/${job.id}/retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ viewType }),
      });
      const data = await safeJson(response, "Could not restart this view");
      if (!response.ok) throw new Error(data.error);
      setRetryUsed(true);
      setReviewOpen(false);
      setRendering(true);
      setJob(current => ({ ...current, status: "processing" }));
      toast.success("Only the selected view is being rebuilt. The other four remain unchanged.");
      pollJob(job.id);
    } catch (error) {
      toast.error(error.message || "Could not restart this view.");
    } finally {
      setExportingAction(null);
    }
  };

  if (!authReady) return <div className={`${styles.studio} ${styles.loadingScreen}`}>Loading Mockup Studio…</div>;
  if (!session) {
    return (
      <main className={`${styles.studio} ${styles.authScreen}`}>
        <div><span className={styles.authEyebrow}>DESAYNCLAW / MOCKUP STUDIO</span><h1>Sign in to continue</h1><p>Your source panels and generated images stay attached to your account.</p><button onClick={() => router.push("/")}>Return home</button></div>
      </main>
    );
  }

  return (
    <main className={styles.studio}>
      <header className={`${styles.topbar} ${!project ? styles.landingTopbar : ""}`}>
        <div className={styles.topbarActions}><button className={styles.homeButton} onClick={() => router.push("/")}>Home</button>{project ? <button className={styles.homeButton} onClick={startNewProject} disabled={rendering}>New project</button> : null}</div>
        {project ? <div className={styles.brand}><Image src="/logo.png" alt="DesaynClaw" width={134} height={26} priority /><div className={styles.productIdentity}><strong>Mockup Studio</strong><span>Garment visualization workspace</span></div></div> : null}
        <div className={styles.credit}><strong>{credits ?? "—"}</strong><span>Claws available</span></div>
      </header>

      {!project ? (
        <section className={styles.startScreen}>
          <div className={styles.startLayout}>
            <div className={styles.startIntro}>
              <div className={styles.landingBrand}><Image src="/logo.png" alt="DesaynClaw" width={154} height={30} priority /><div><strong>Mockup Studio</strong><span>Garment visualization workspace</span></div></div>
              <h1>Create a professional garment mockup set.</h1>
              <p>Upload your exact front, back, and sleeve artwork. DesaynClaw keeps the design consistent across five presentation-ready views.</p>
              <div className={styles.startFacts}><span>Source artwork preserved</span><span>Five consistent views</span><span>Private for 3 days</span></div>
            </div>
            <div className={styles.setupPanel}>
              <header className={styles.setupHeader}><span>New project</span><h2>Set up your campaign</h2><p>Name the project and choose the garment you want to present.</p></header>
              <label className={styles.projectNameLabel}>Project name<input value={projectName} maxLength={100} onChange={event => setProjectName(event.target.value)} /></label>
              <div className={styles.garmentPicker} aria-label="Choose a locked garment template">{Object.entries(AVAILABLE_GARMENT_CATALOG).map(([key, garment], index) => <button type="button" key={key} className={garmentType === key ? styles.garmentActive : ""} onClick={() => setGarmentType(key)} aria-pressed={garmentType === key}><span className={styles.garmentIndex}>{String(index + 1).padStart(2, "0")}</span><span><strong>{garment.label}</strong><small>{garment.description}</small></span></button>)}</div>
              <div className={styles.setupFooter}><button className={styles.primaryButton} onClick={createProject} disabled={creating || !projectName.trim()}>{creating ? "Creating project…" : "Create mockup project"}</button><small>Creating a project is free. Claws are charged only when you generate the final set.</small></div>
            </div>
          </div>
          <section className={styles.recentProjects} aria-labelledby="recent-projects-title">
            <header><div><span>Your work</span><h2 id="recent-projects-title">Continue a recent project</h2></div><p>Drafts and completed sets are available for 3 days.</p></header>
            {loadingProjects ? <div className={styles.recentEmpty}>Loading projects…</div> : recentProjects.length ? (
              <div className={styles.recentGrid}>{recentProjects.map(item => {
                const profile = getGarmentProfile(item.garment_type);
                return <button type="button" key={item.id} className={styles.projectCard} onClick={() => openProject(item.id)} disabled={openingProjectId === item.id}>
                  <span className={styles.projectThumb}>{item.preview_url ? <img src={item.preview_url} alt="" /> : <span>DC</span>}</span>
                  <span className={styles.projectCardBody}><strong>{item.name}</strong><small>{profile.label} · {formatProjectDate(item.updated_at)}</small><span>{openingProjectId === item.id ? "Opening…" : item.status}</span></span>
                </button>;
              })}</div>
            ) : <div className={styles.recentEmpty}><strong>No saved mockup projects yet.</strong><span>Your first draft will appear here automatically.</span></div>}
          </section>
        </section>
      ) : (
        <div className={styles.workspace}>
          <aside className={styles.leftPanel}>
            <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={event => prepareSelectedAsset(event.target.files?.[0])} />
            <div className={styles.garmentLock}><span>GARMENT</span><div><strong>{garmentProfile.label}</strong><small>{garmentProfile.description} · locked for this project</small></div></div>
            <div className={styles.assetList}>{garmentParts.required.map(role => <AssetSlot key={role} role={role} asset={assets[role]} busy={uploadingRole === role} required spec={getPanelPreparationSpec(garmentType, role)} onChoose={chooseAsset} onRemove={removeAsset} />)}</div>
            <details className={styles.optionalAssets}>
              <summary>Optional construction assets <span>{garmentParts.optional.filter(role => assets[role]).length}/{garmentParts.optional.length}</span></summary>
              <div className={styles.assetList}>{garmentParts.optional.map(role => <AssetSlot key={role} role={role} asset={assets[role]} busy={uploadingRole === role} required={false} onChoose={chooseAsset} onRemove={removeAsset} />)}</div>
            </details>
            <div className={styles.storageMeter}><div><span>Project storage</span><strong>{formatMockupMegabytes(totalBytes)} / 150MB</strong></div><progress max={MOCKUP_TOTAL_MAX_BYTES} value={totalBytes} /></div>
            <section className={styles.sourceIntegrity} aria-label="Source integrity summary">
              <div><span>Source integrity</span><strong>{garmentParts.required.filter(role => assets[role]).length}/{garmentParts.required.length} panels ready</strong></div>
              <p>Your uploaded artwork remains the color, placement, and design authority for every generated view.</p>
              <dl><div><dt>Body artwork</dt><dd>Locked to source</dd></div><div><dt>Color handling</dt><dd>Source exact</dd></div><div><dt>Asset retention</dt><dd>3 days</dd></div></dl>
            </section>
          </aside>

          <section className={styles.canvasPanel}>
            <div className={styles.canvasHeader}><h1>{projectName}</h1><div className={`${styles.previewStatus} ${renderReady ? styles.previewStatusReady : ""}`}>{!requiredReady ? `${garmentParts.required.filter(role => assets[role]).length}/${garmentParts.required.length} required panels` : !artDirectionReady ? "Art direction required" : "Ready to render"}</div></div>
            <div className={styles.previewShell}>
              <GarmentPreview assets={assets} colors={colors} garmentType={garmentType} />
              {rendering ? <CampaignProcessingOverlay completed={outputs.length} stage={renderStage} /> : null}
            </div>
            <section className={styles.outputSection}>
              <header><div><span>CAMPAIGN OUTPUTS</span><strong>Five-view presentation set</strong></div><div className={styles.outputHeaderActions}><small data-tone={renderStage.tone}>{renderStage.label}</small></div></header>
              <div className={styles.outputStrip}>
                {MOCKUP_SHOTS.map((shot, index) => {
                  const output = outputs.find(item => item.view_type === shot.key);
                  const shotLabel = getGarmentShotLabel(garmentType, shot.key);
                  return <article key={shot.key} className={output ? styles.outputReady : ""}>
                    <div className={`${styles.outputMedia} ${output ? "" : styles.outputPlaceholder}`}>{output ? <img src={output.file_url} alt={shotLabel} /> : rendering ? <RenderVisualizer active={index === nextPendingViewIndex} index={index} /> : null}</div>
                    <div className={styles.outputOverlay}>
                      <span className={styles.outputIndex}>{String(index + 1).padStart(2, "0")}</span>
                      <div><strong>{shotLabel}</strong><p>{rendering && !output ? "Rendering view…" : shot.description}</p></div>
                      {output ? <a href={output.file_url} target="_blank" rel="noreferrer" aria-label={`Open ${shotLabel}`}>Open</a> : <span className={styles.outputState}>{rendering ? "Working" : "Pending"}</span>}
                    </div>
                  </article>;
                })}
              </div>
            </section>
          </section>

          <aside className={styles.rightPanel}>
            <div className={styles.rightPanelScroll}>
              <div className={styles.panelHeading}><span>02</span><div><h2>Art direction</h2><p>Controlled presets keep the set visually consistent.</p></div></div>
              <section className={styles.controlSection}><h3>Trim colors</h3>{Object.entries(colorLabels).map(([key, label]) => <label className={styles.colorControl} key={key}><span>{label}</span><input type="color" value={colors[key]} onChange={event => setColors(current => ({ ...current, [key]: event.target.value }))} /><code>{colors[key].toUpperCase()}</code></label>)}</section>
              <section className={styles.controlSection}>
                <div className={styles.controlTitle}><h3>Garment fabric</h3><span>Material lock</span></div>
                <label className={styles.fabricControl}>
                  <span className={styles.srOnly}>Garment fabric</span>
                  <select value={colors.fabricPreset} onChange={event => setColors(current => ({ ...current, fabricPreset: event.target.value }))}>
                    {Object.entries(MOCKUP_FABRIC_PRESETS).map(([key, fabric]) => <option key={key} value={key}>{fabric.label}</option>)}
                  </select>
                  <small>{MOCKUP_FABRIC_PRESETS[colors.fabricPreset]?.description}</small>
                </label>
              </section>
              <section className={styles.controlSection}><div className={styles.controlTitle}><h3>Campaign style</h3><span>{styleReviewed ? "Selected" : "Required"}</span></div><div className={styles.styleList}>{Object.entries(MOCKUP_STYLE_PRESETS).map(([key, preset]) => <button type="button" key={key} className={stylePreset === key && styleReviewed ? styles.styleActive : ""} onClick={() => { setStylePreset(key); setStyleReviewed(true); }} aria-pressed={stylePreset === key && styleReviewed}><span className={styles.campaignIcon}><CampaignStyleIcon type={key} /></span><div><strong>{preset.label}</strong><small>{preset.description}</small></div>{stylePreset === key && styleReviewed ? <span className={styles.styleMark}>Selected</span> : null}</button>)}</div></section>
              <section className={styles.controlSection}>
                <div className={styles.controlTitle}><h3>Backdrop</h3><span>{backdropReviewed ? "Selected" : "Required"}</span></div>
                <label className={styles.backdropColor} style={{ "--campaign-color": colors.backdrop }}><span>Campaign color</span><input type="color" value={colors.backdrop} onChange={event => { setColors(current => ({ ...current, backdrop: event.target.value })); setBackdropReviewed(true); }} /><code>{colors.backdrop.toUpperCase()}</code></label>
                <div className={styles.backdropGrid}>{Object.entries(MOCKUP_BACKDROP_PRESETS).map(([key, preset]) => <button type="button" key={key} className={colors.backdropPreset === key && backdropReviewed ? styles.backdropActive : ""} onClick={() => { setColors(current => ({ ...current, backdropPreset: key })); setBackdropReviewed(true); }} aria-pressed={colors.backdropPreset === key && backdropReviewed}><span className={styles.backdropSwatch} style={{ background: `radial-gradient(circle at 55% 42%, ${colors.backdrop}, #070707 72%)` }} /><strong>{preset.label}</strong><small>{preset.description}</small></button>)}</div>
              </section>
            </div>
            <footer className={styles.renderActions}>
              <div className={styles.renderSummary}><div><span>Deliverables</span><strong>{campaignComplete ? "5 views ready · 1K PNG" : "5 views · 1K PNG"}</strong></div><div><span>{campaignComplete ? "Campaign status" : "Render cost"}</span><strong>{campaignComplete ? "Ready for review" : `${MOCKUP_RENDER_COST} Claws`}</strong></div></div>
              <button className={`${styles.generateButton} ${campaignComplete ? styles.reviewSetButton : ""}`} onClick={campaignComplete ? () => setReviewOpen(true) : openPreflight} disabled={campaignComplete ? false : !renderReady || rendering}>{campaignComplete ? <>Review campaign set <span>Open 5 views</span></> : rendering ? `Rendering ${outputs.length}/5…` : !requiredReady ? "Upload required panels" : !artDirectionReady ? "Complete art direction" : <>Review and generate <span>2 Claws</span></>}</button>
              {job && !rendering && job.status !== "completed" && <button className={styles.retryButton} onClick={() => pollJob(job.id)}>Check render status</button>}
              <p className={styles.billingNote}>{campaignComplete ? "Compare every generated view against its source artwork." : "Technical preview is free. Failed sets are refunded automatically."}</p>
            </footer>
          </aside>
        </div>
      )}
      <MockupReviewModal open={reviewOpen} outputs={outputs} shots={reviewShots} projectName={projectName} garmentLabel={garmentProfile.label} assets={assets} busyAction={exportingAction} retryUsed={retryUsed} onClose={() => setReviewOpen(false)} onDownloadAll={downloadAllViews} onExportBoard={downloadCampaignBoard} onRetryView={retryCampaignView} />
      <MockupPreflightModal
        open={preflightOpen}
        garmentType={garmentType}
        garmentLabel={garmentProfile.label}
        assets={assets}
        colors={colors}
        styleLabel={MOCKUP_STYLE_PRESETS[stylePreset]?.label || stylePreset}
        fabricLabel={MOCKUP_FABRIC_PRESETS[colors.fabricPreset]?.label || "Micro Cool"}
        backdropLabel={MOCKUP_BACKDROP_PRESETS[colors.backdropPreset]?.label || "Custom campaign color"}
        busy={rendering}
        onClose={() => setPreflightOpen(false)}
        onConfirm={generate}
      />
      {panelFit ? <PanelFitModal
        file={panelFit.file}
        role={panelFit.role}
        garmentType={garmentType}
        onCancel={() => setPanelFit(null)}
        onApply={async preparedFile => {
          const role = panelFit.role;
          setPanelFit(null);
          await uploadAsset(preparedFile, role);
        }}
      /> : null}
    </main>
  );
}
