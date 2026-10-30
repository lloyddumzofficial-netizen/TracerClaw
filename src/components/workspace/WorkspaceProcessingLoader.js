"use client";

import { CheckCircle2 } from "lucide-react";
import SafeInlineSVG from "@/components/shared/SafeInlineSVG";
import useElapsedTime, { formatElapsedTime } from "@/hooks/useElapsedTime";
import styles from "./WorkspaceProcessingLoader.module.css";

export default function WorkspaceProcessingLoader({
  previewUrl,
  label,
  detail,
  stageIndex = 0,
  stageCount = 3,
  stageLabels = [],
  className = "",
}) {
  const elapsed = useElapsedTime(true, stageIndex);

  return (
    <div className={`processing-blueprint-stage ${className}`.trim()} role="status" aria-live="polite">
      <div className="processing-blueprint-bg" />
      <div className="processing-blueprint-board">
        <div className="processing-blueprint-canvas">
          {previewUrl && (
            <img
              src={previewUrl}
              alt="Processing preview"
              referrerPolicy="no-referrer"
              decoding="async"
            />
          )}
          <div className="processing-canvas-shade" aria-hidden="true" />
          <span className="processing-canvas-scan" aria-hidden="true" />
          <div className="processing-logo-outline" aria-hidden="true">
            <img className="processing-logo-ghost" src="/SVG/LOGO%20OUTLINE.svg" alt="" decoding="async" />
            <SafeInlineSVG className="processing-logo-vector" url="/SVG/LOGO%20OUTLINE.svg" />
            <span className="processing-logo-orbit is-outer" />
            <span className="processing-logo-orbit is-inner" />
            <span className="processing-logo-node n1" />
            <span className="processing-logo-node n2" />
            <span className="processing-logo-node n3" />
            <span className="processing-logo-node n4" />
          </div>
        </div>
      </div>

      <div className="processing-layer-panel">
        <div className="processing-layer-header">
          <span>
            <i className="processing-stage-dot" aria-hidden="true" />
            {label}
          </span>
          <strong>
            <span className={styles.elapsed} aria-hidden="true">{formatElapsedTime(elapsed)} elapsed</span>
            <em>Stage {stageIndex + 1} of {stageCount}</em>
          </strong>
        </div>
        <div
          className={`processing-progress-track ${styles.indeterminate}`}
          role="progressbar"
          aria-label={`${label}: ${detail}`}
        >
          <i />
        </div>
        <p>{detail}</p>
        {elapsed >= 45 && <p className={styles.slowNotice}>Taking longer than usual. Your source is still available.</p>}
        <div className="processing-layer-stack">
          {stageLabels.map((stageLabel, index) => {
            const state = index < stageIndex ? "is-done" : index === stageIndex ? "is-active" : "is-pending";
            return (
              <div key={stageLabel} className={state}>
                {index < stageIndex
                  ? <CheckCircle2 size={13} />
                  : index === stageIndex
                    ? (
                      <span className="processing-stage-activity" aria-hidden="true">
                        <i />
                        <i />
                        <i />
                      </span>
                    )
                    : <span className="processing-stage-pip" aria-hidden="true">{index + 1}</span>}
                <span>{stageLabel}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
