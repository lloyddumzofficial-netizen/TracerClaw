"use client";

import Image from "next/image";
import { CheckCircle2, Download, ImageIcon, Loader2, Plus, RefreshCw, ShieldCheck, Sparkles, X } from "lucide-react";
import styles from "./image-tool.module.css";
import useElapsedTime, { formatElapsedTime } from "@/hooks/useElapsedTime";

export default function ImageToolPropertiesPanel({
  tool,
  modeControl,
  outputRows,
  isDownloading = false,
  isUploading = false,
  previewSurface,
  onPreviewSurfaceChange,
  fileName,
  sourceMeta,
  isProcessing,
  hasProcessableSource,
  noCredits,
  resultUrl,
  onRun,
  onDownload,
  onReplace,
  onNewImage,
  onClose,
  closeButtonRef,
  processingStatus,
}) {
  const elapsed = useElapsedTime(isProcessing);
  const outputResolution = sourceMeta
    ? `${sourceMeta.outputWidth} × ${sourceMeta.outputHeight}`
    : "Pending source";
  const actionLabel = isProcessing
    ? processingStatus || tool.processingLabel
    : resultUrl
      ? tool.completeLabel
      : noCredits
        ? "Get more Claws"
        : tool.runLabel;
  const rows = outputRows || [
    ["Resolution", outputResolution], ["Format", "Lossless PNG"], ["Scale", tool.outputBadge], ["Color", "Protected"],
  ];

  return (
    <aside className={styles.propertiesPanel} aria-label={tool.settingsTitle}>
      <header className={styles.propertiesHeader}>
        <div><Sparkles size={14} /><span>{tool.settingsTitle}</span></div>
        {onClose && <button ref={closeButtonRef} type="button" onClick={onClose} aria-label="Close settings panel" aria-expanded="true"><X size={14} /></button>}
      </header>

      <div className={styles.propertiesScroll}>
        <section className={styles.sidebarSection}>
          <span className={styles.sidebarLabel}>Source Detail</span>
          <div className={styles.sourceSelector}>
            <span className={styles.selectorIcon}><ImageIcon size={14} /></span>
            <div>
              <strong title={fileName}>{fileName || "Uploaded artwork"}</strong>
              <small>{sourceMeta ? `${sourceMeta.format} · ${sourceMeta.fileSize} · ${sourceMeta.width} × ${sourceMeta.height}` : "Reading image data…"}</small>
            </div>
            <button type="button" onClick={onReplace} disabled={isProcessing || isUploading}>Replace</button>
          </div>
          <p className={styles.sidebarDescription}>The original upload stays unchanged while {tool.agent.name} builds the {tool.transparent ? "transparent cutout" : "enhanced output"}.</p>
        </section>

        <section className={styles.sidebarSection}>
          <span className={styles.sidebarLabel}>{tool.modeLabel}</span>
          <div className={styles.modeCard}>
            <span className={styles.modeIcon}><Sparkles size={16} /></span>
            <div>
              {modeControl || (
                <>
                  <strong>{tool.modeName}</strong>
                  <small>{tool.modeDetail}</small>
                </>
              )}
            </div>
            <span className={styles.modeCost} title="1 Claw per new generation">1 Claw</span>
          </div>
          <p className={styles.sidebarDescription}>{tool.modeDescription}</p>
        </section>

        <section className={styles.sidebarSection}>
          <span className={styles.sidebarLabel}>Actions</span>
          <button className={styles.statusAction} type="button" onClick={onRun} disabled={isProcessing || isUploading || Boolean(resultUrl) || !hasProcessableSource}>
            {resultUrl
              ? <CheckCircle2 size={15} />
              : isProcessing
                ? <Loader2 size={15} className="animate-spin" />
                : <Sparkles size={15} />}
            {actionLabel}
          </button>

          <button className={styles.primaryExport} type="button" onClick={onDownload} disabled={!resultUrl || isDownloading}>
            {isDownloading ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} {isDownloading ? "Preparing download…" : tool.downloadLabel}
          </button>

          <div className={styles.actionGrid}>
            <button type="button" onClick={onReplace} disabled={isProcessing || isUploading} aria-label="Replace source">
              <RefreshCw size={14} /><span>Replace<br />Source</span>
            </button>
            <button type="button" onClick={onNewImage} disabled={isProcessing || isUploading} aria-label="New image">
              <Plus size={14} /><span>New<br />Image</span>
            </button>
          </div>
          {noCredits && !resultUrl && <p className={styles.creditWarning}>Add 1 Claw to continue.</p>}
        </section>

        <section className={`${styles.sidebarSection} ${styles.outputSection}`}>
          <span className={styles.sidebarLabel}>Output Details</span>
          <div className={styles.processReadout}>
            <div><span>{isProcessing ? processingStatus || "Processing" : resultUrl ? "Complete" : "Processing time"}</span><strong>{isProcessing ? `${formatElapsedTime(elapsed)} elapsed` : resultUrl ? "Ready" : "Varies by image"}</strong></div>
            <div className={styles.stageRail}><i className={isProcessing ? styles.busyRail : resultUrl ? styles.activeRail : ""} /></div>
            <small>{tool.modeName}</small>
          </div>
          <div className={styles.detailRows}>
            {rows.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}
          </div>
          {resultUrl && onPreviewSurfaceChange && (
            <div className={styles.previewSurfaces} role="group" aria-label="Preview background">
              {[ ["checker", "Transparent"], ["light", "Light"], ["dark", "Dark"] ].map(([surface, label]) => (
                <button key={surface} type="button" onClick={() => onPreviewSurfaceChange(surface)} aria-pressed={previewSurface === surface}>
                  <i className={styles[`swatch_${surface}`]} aria-hidden="true" />{label}
                </button>
              ))}
            </div>
          )}
        </section>

        <aside className={styles.agentCard} aria-label={`${tool.agent.name}, your ${tool.agent.role.toLowerCase()}`}>
          <div className={styles.agentCardCopy}>
            <div className={styles.agentIdentity}>
              <span>{tool.agent.id}</span>
              <div>
                <b>{tool.agent.name}</b>
                <small>{tool.agent.role}</small>
              </div>
            </div>
            <strong className={styles.agentHeadline}>{tool.agent.headline}<br />{tool.agent.subheadline}</strong>
            <p>{tool.agent.description}</p>
          </div>
          <div className={styles.agentPortrait} aria-hidden="true">
            <Image
              src={tool.agent.image}
              alt=""
              fill
              sizes="150px"
            />
          </div>
        </aside>
      </div>

      <footer className={styles.sidebarFooter}>
        <ShieldCheck size={12} /><span>Auto-deletes after 3 days</span>
      </footer>
    </aside>
  );
}
