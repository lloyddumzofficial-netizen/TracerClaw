"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

const STORAGE_KEY = "claw-agents-promo-seen-v1";
const PRIVACY_KEY = "ai_disclaimer_seen";
const ONE_DAY_MS = 86_400_000;

const PromoModal = memo(function PromoModal({ enabled = true, onChooseAgent, onVisibilityChange }) {
  const [show, setShow] = useState(false);
  const dialogRef = useRef(null);
  const closeRef = useRef(null);

  useEffect(() => {
    onVisibilityChange?.(show);
    return () => {
      if (show) onVisibilityChange?.(false);
    };
  }, [onVisibilityChange, show]);

  const handleClose = useCallback(() => {
    setShow(false);
    localStorage.setItem(STORAGE_KEY, Date.now().toString());
  }, []);

  useEffect(() => {
    if (!enabled) {
      setShow(false);
      return undefined;
    }

    let timer;
    const schedulePromo = () => {
      if (!localStorage.getItem(PRIVACY_KEY)) return;

      const lastSeen = Number(localStorage.getItem(STORAGE_KEY) || 0);
      if (Date.now() - lastSeen < ONE_DAY_MS) return;

      timer = window.setTimeout(() => setShow(true), 2400);
    };

    schedulePromo();
    window.addEventListener("desaynclaw:data-privacy-accepted", schedulePromo);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("desaynclaw:data-privacy-accepted", schedulePromo);
    };
  }, [enabled]);

  useEffect(() => {
    if (!show) return undefined;

    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus({ preventScroll: true });

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        handleClose();
        return;
      }
      if (event.key !== "Tab") return;

      const buttons = dialogRef.current?.querySelectorAll("button:not(:disabled)");
      if (!buttons?.length) return;
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      const focusOutside = !dialogRef.current.contains(document.activeElement);
      if (event.shiftKey && (document.activeElement === first || focusOutside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || focusOutside)) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      if (!document.querySelector('[role="dialog"]') && previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus({ preventScroll: true });
      }
    };
  }, [handleClose, show]);

  if (!show) return null;

  const handleChooseAgent = () => {
    handleClose();
    onChooseAgent?.();
  };

  return createPortal(
    <div className="claw-agents-promo-overlay" role="presentation" onClick={handleClose}>
      <section
        ref={dialogRef}
        className="claw-agents-promo"
        role="dialog"
        aria-modal="true"
        aria-label="Meet the DesaynClaw agents"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          ref={closeRef}
          className="claw-agents-promo-close"
          type="button"
          onClick={handleClose}
          aria-label="Close agent announcement"
        >
          <X size={17} aria-hidden="true" />
        </button>

        <button
          className="claw-agents-promo-action"
          type="button"
          onClick={handleChooseAgent}
          aria-label="Choose a DesaynClaw agent"
        >
          <img src="/POP-UP-BANNER.jpg" width={2328} height={1892} alt="Meet the DesaynClaw Claw Agents" />
        </button>
      </section>
    </div>,
    document.body,
  );
});

export default PromoModal;
