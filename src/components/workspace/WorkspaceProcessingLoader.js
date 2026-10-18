"use client";

import { useEffect, useRef } from "react";
import { CheckCircle2 } from "lucide-react";
import SafeInlineSVG from "@/components/shared/SafeInlineSVG";

const DEFAULT_RANGE = [2, 96];
const STAGE_EASE_RATE = 0.3;

function useProcessingProgress(progressRange, { fillRef, textRef, trackRef }) {
  const valueRef = useRef(progressRange?.[0] ?? DEFAULT_RANGE[0]);

  useEffect(() => {
    const [start, end] = progressRange || DEFAULT_RANGE;
    if (!(valueRef.current > start && valueRef.current < end)) valueRef.current = start;

    let frame = 0;
    let lastTime = performance.now();
    let lastShown = -1;

    const paint = (now) => {
      const dt = Math.min(now - lastTime, 120) / 1000;
      lastTime = now;

      const current = valueRef.current;
      valueRef.current = current + (end - current) * (1 - Math.exp(-STAGE_EASE_RATE * dt));
      const value = valueRef.current;

      if (fillRef.current) fillRef.current.style.width = `${value.toFixed(2)}%`;

      const rounded = Math.round(value);
      if (rounded !== lastShown) {
        lastShown = rounded;
        if (textRef.current) textRef.current.textContent = `${rounded}%`;
        trackRef.current?.setAttribute("aria-valuenow", String(rounded));
      }

      frame = requestAnimationFrame(paint);
    };

    frame = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(frame);
  }, [progressRange, fillRef, textRef, trackRef]);
}

export default function WorkspaceProcessingLoader({
  previewUrl,
  label,
  detail,
  stageIndex = 0,
  stageCount = 3,
  stageLabels,
  progressRange = DEFAULT_RANGE,
  className = "",
}) {
  const progressFillRef = useRef(null);
  const progressTextRef = useRef(null);
  const progressTrackRef = useRef(null);
  const stageStart = progressRange?.[0] ?? DEFAULT_RANGE[0];

  useProcessingProgress(progressRange, {
    fillRef: progressFillRef,
    textRef: progressTextRef,
    trackRef: progressTrackRef,
  });

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
            <span ref={progressTextRef}>{Math.round(stageStart)}%</span>
            <em>Stage {stageIndex + 1} of {stageCount}</em>
          </strong>
        </div>
        <div
          className="processing-progress-track"
          ref={progressTrackRef}
          role="progressbar"
          aria-valuenow={Math.round(stageStart)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${label}: ${detail}`}
        >
          <i ref={progressFillRef} style={{ width: `${stageStart}%` }} />
        </div>
        <p>{detail}</p>
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
