"use client";

import { memo, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Zap, Sparkles, Download } from "lucide-react";
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
        <div className={styles.header}>
          <span className={styles.eyebrow}>Workspace ready</span>
          <h2 id="onboarding-title">Welcome to DesaynClaw</h2>
          <p>
            A compact guide before you start tracing, cleaning, and exporting production files.
          </p>
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
          <strong>1 claw = 1 standard generation</strong>
          <span>Need more? Top up anytime from the Claws button.</span>
        </div>

        <button
          className={styles.primaryButton}
          onClick={onClose}
        >
          Start creating
        </button>
      </div>
    </div>,
    document.body
  );
});

export default OnboardingModal;
