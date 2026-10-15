"use client";

import { memo, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, Download, Layers3, Sparkles, X, Zap } from "lucide-react";
import styles from "./OnboardingModal.module.css";

const steps = [
  {
    icon: Zap,
    title: "Upload artwork",
    copy: "Start from a shirt mockup, sketch, logo, or raster image.",
  },
  {
    icon: Sparkles,
    title: "Clean extraction",
    copy: "DesaynClaw prepares cleaner production artwork with AI assistance.",
  },
  {
    icon: Download,
    title: "Export files",
    copy: "Save SVG, PNG, ZIP, or send finished exports to Google Drive.",
  },
];

const OnboardingModal = memo(function OnboardingModal({ show, onClose }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!show || !mounted) return null;

  return createPortal(
    <div
      className={styles.overlay}
      onClick={onClose}
    >
      <div
        className={styles.card}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
      >
        <button
          type="button"
          className={styles.closeButton}
          onClick={onClose}
          aria-label="Close welcome guide"
        >
          <X size={17} strokeWidth={1.8} />
        </button>

        <div className={styles.header}>
          <div className={styles.headerMark} aria-hidden="true">
            <Layers3 size={20} strokeWidth={1.7} />
          </div>
          <div>
            <span className={styles.eyebrow}>Welcome to DesaynClaw</span>
            <h2 id="onboarding-title">Your workspace is ready.</h2>
            <p>Three simple steps from rough artwork to production-ready files.</p>
          </div>
        </div>

        <div className={styles.steps}>
          {steps.map(({ icon: Icon, title, copy }, index) => (
            <div className={styles.step} key={title}>
              <span className={styles.stepIndex}>{String(index + 1).padStart(2, "0")}</span>
              <span className={styles.stepIcon}>
                <Icon size={15} />
              </span>
              <div>
                <strong>{title}</strong>
                <p>{copy}</p>
              </div>
            </div>
          ))}
        </div>

        <div className={styles.creditNote}>
          <div>
            <span className={styles.creditDot} aria-hidden="true" />
            <strong>1 Claw</strong>
            <span>per standard generation</span>
          </div>
          <small>Top up anytime from your balance menu.</small>
        </div>

        <button
          className={styles.primaryButton}
          onClick={onClose}
        >
          <span>Enter workspace</span>
          <ArrowRight size={16} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
    </div>,
    document.body
  );
});

export default OnboardingModal;
