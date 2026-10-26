"use client";

import Image from "next/image";
import { ArrowUpRight, Columns2, Loader2, ShieldCheck, UploadCloud } from "lucide-react";
import { formatUploadLimit, resolveImageUploadLimit } from "@/lib/uploadLimits";
import styles from "./image-tool.module.css";

export default function ImageToolEntryScreen({
  tool,
  isUploading = false,
  comparePosition,
  onChooseFile,
  onCompareChange,
}) {
  return (
    <div className={styles.entry}>
      <section className={styles.commandPanel} aria-labelledby={`${tool.id}-entry-title`}>
        <div className={styles.intro}>
          <span className={styles.eyebrow}>{tool.eyebrow}</span>
          <h1 id={`${tool.id}-entry-title`}>{tool.headline}<span>{tool.subheadline}</span></h1>
          <p>{tool.description}</p>
        </div>
        <div className={styles.uploadDropzone}>
          <div className={styles.dropzoneMark}><UploadCloud size={24} /></div>
          <div className={styles.dropzoneCopy}>
            <span>Source artwork</span>
            <strong>Drag &amp; drop your image here</strong>
            <small>PNG, JPG or WebP · up to {formatUploadLimit(resolveImageUploadLimit({ purpose: tool.uploadPurpose }))}</small>
            {tool.uploadHint && <small>{tool.uploadHint}</small>}
          </div>
          <div className={styles.dropzoneDivider}><span>or</span></div>
          <button type="button" onClick={onChooseFile} className={styles.browseUpload} disabled={isUploading}>
            {isUploading ? <><Loader2 size={14} className="animate-spin" /> Uploading image…</> : <>Browse image <ArrowUpRight size={14} aria-hidden="true" /></>}
          </button>
        </div>
        <div className={styles.assurance}><ShieldCheck size={14} /><span>Private processing · files delete automatically after 3 days</span></div>
      </section>

      <section className={styles.proofPanel} aria-label={`${tool.agent.name} ${tool.previewName}`}>
        <header className={styles.proofHeader}>
          <div className={styles.proofTitle}><strong>Comparison</strong><span>{tool.agent.name} sample</span></div>
          <span className={styles.proofMode}>Original&nbsp;&nbsp;/&nbsp;&nbsp;{tool.outputLabel}</span>
        </header>
        <div className={`${styles.proofCanvas} ${tool.transparent ? styles.cutoutProof : ""}`}>
          <div className={styles.blueprintGrid} aria-hidden="true" />
          <div className={styles.agentNote}><span>{tool.agent.role}</span><strong>{tool.agent.name.toUpperCase()}</strong><small>{tool.agent.specialty}</small></div>
          <div className={`${styles.agentLayer} ${styles.enhancedLayer}`}>
            <Image src={tool.agent.image} alt={`${tool.agent.name}, the DesaynClaw ${tool.agent.role}`} fill priority sizes="(max-width: 820px) 100vw, 58vw" />
          </div>
          <div className={tool.transparent ? styles.cutoutOriginal : `${styles.agentLayer} ${styles.originalLayer}`} style={{ clipPath: `inset(0 ${100 - comparePosition}% 0 0)` }} aria-hidden="true">
            {tool.transparent ? <div className={styles.agentLayer}><Image src={tool.agent.image} alt="" fill priority sizes="(max-width: 820px) 100vw, 58vw" /></div> : <Image src={tool.agent.image} alt="" fill priority sizes="(max-width: 820px) 100vw, 58vw" />}
          </div>
          <span className={styles.compareDivider} style={{ left: `${comparePosition}%` }} aria-hidden="true"><i><Columns2 size={13} /></i></span>
          <input className={styles.compareRange} type="range" min="4" max="96" step="1" value={comparePosition} onInput={onCompareChange} onChange={onCompareChange} aria-label={`Compare ${tool.agent.name} before and after ${tool.previewName}`} />
          <span className={`${styles.compareLabel} ${styles.originalLabel}`}>Original</span>
          <span className={`${styles.compareLabel} ${styles.enhancedLabel}`}>{tool.outputLabel}</span>
          <span className={styles.scaleBadge}><strong>{tool.outputBadge}</strong> output</span>
        </div>
        <footer className={styles.proofFooter}>
          <div className={styles.outputSummary}><strong>{tool.modeName}</strong><span>{tool.outputSummary}</span></div>
          <div className={styles.dragInstruction}><Columns2 size={13} /><span>Drag to inspect detail</span></div>
        </footer>
      </section>
    </div>
  );
}
