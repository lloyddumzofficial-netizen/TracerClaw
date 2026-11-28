"use client";

import { memo, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeftIcon as ArrowLeft, ArrowRightIcon as ArrowRight, CheckIcon as Check, CropIcon as Crop, FileArrowDownIcon as FileDown, StackIcon as Layers3, UploadIcon as Upload, XIcon as X } from "@phosphor-icons/react/ssr";
import useDialogFocus from "@/hooks/useDialogFocus";
import styles from "./OnboardingModal.module.css";

const steps = [
  { icon: Layers3, title: "Welcome to DesaynClaw", copy: "Your artwork, ready for production. Extract garment designs, refine logos, and prepare clean files in one workspace." },
  { icon: Upload, title: "Start with your artwork", copy: "Choose a workspace and upload your image. Use Garment Extract, Logo Vectorizer, Pattern Rebuilder, or Background Remover." },
  { icon: Crop, title: "A good crop makes the difference", copy: "For garments, frame one body panel without sleeves or extra margins. For logos, keep the complete mark inside your selection." },
  { icon: FileDown, title: "Review. Refine. Export.", copy: "Compare your result, refine available settings, and download your finished files. Check the Claw cost before you generate." },
];

const OnboardingModal = memo(function OnboardingModal({ show, onClose }) {
  const [mounted, setMounted] = useState(false);
  const [step, setStep] = useState(0);
  const dialogRef = useRef(null);
  const headingRef = useRef(null);
  useEffect(() => { setMounted(true); }, []);
  useEffect(() => { if (show) setStep(0); }, [show]);
  useDialogFocus(show && mounted, dialogRef, onClose);
  useEffect(() => { if (step > 0) headingRef.current?.focus({ preventScroll: true }); }, [step]);
  if (!show || !mounted) return null;
  const { icon: Icon, title, copy } = steps[step];
  const last = step === steps.length - 1;

  return createPortal(
    <div className={styles.overlay} onClick={onClose}>
      <section className={styles.card} ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="onboarding-title" aria-describedby="onboarding-description" tabIndex={-1} onClick={event => event.stopPropagation()}>
        <div className={styles.preview} aria-hidden="true" data-step={step}>
          <div className={styles.previewGrid} />
          <div className={styles.previewMark} key={step}><Icon size={46} weight="light" /></div>
          <span className={styles.previewCaption}>{["DESAYNCLAW WORKSPACE", "YOUR NEXT PROJECT", "FRAME WHAT MATTERS", "READY FOR PRODUCTION"][step]}</span>
          {step === 1 && <div className={styles.fileHint}>PNG <span>·</span> JPG <span>·</span> WEBP</div>}
          {step === 2 && <div className={styles.cropFrame}><i /><i /><i /><i /></div>}
          {step === 3 && <div className={styles.fileHint}><Check size={12} /> SVG <span>·</span> PNG <span>·</span> ZIP</div>}
        </div>
        <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close welcome guide"><X size={16} /></button>
        <div className={styles.content}>
          <h2 ref={headingRef} tabIndex={-1} id="onboarding-title">{title}</h2>
          <p id="onboarding-description">{copy}</p>
        </div>
        <footer className={styles.footer}>
          <div className={styles.dots} aria-label={`Step ${step + 1} of ${steps.length}`}>
            {steps.map((item, index) => <button type="button" key={item.title} aria-label={`Go to step ${index + 1}: ${item.title}`} aria-current={index === step ? "step" : undefined} onClick={() => setStep(index)} />)}
          </div>
          <div className={styles.actions}>
            {step > 0 && <button type="button" className={styles.textButton} onClick={() => setStep(value => value - 1)} aria-label="Previous step"><ArrowLeft size={14} /></button>}
            {!last && <button type="button" className={styles.textButton} onClick={onClose}>Skip</button>}
            <button type="button" className={styles.primaryButton} onClick={() => last ? onClose() : setStep(value => value + 1)}>{last ? "Get started" : "Next"}<ArrowRight size={15} /></button>
          </div>
        </footer>
      </section>
    </div>, document.body
  );
});
export default OnboardingModal;
