"use client";

import { useEffect, useRef } from "react";

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function useDialogFocus(open, dialogRef, onClose) {
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const controls = () => [...dialog.querySelectorAll(FOCUSABLE)].filter(el => el.getClientRects().length > 0);
    (controls()[0] || dialog).focus({ preventScroll: true });
    const onKeyDown = event => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current?.();
      } else if (event.key === "Tab") {
        const items = controls();
        const currentIndex = items.indexOf(document.activeElement);
        const leaving = event.shiftKey ? currentIndex <= 0 : currentIndex < 0 || currentIndex === items.length - 1;
        if (leaving) {
          event.preventDefault();
          (event.shiftKey ? items.at(-1) : items[0])?.focus();
          if (!items.length) dialog.focus();
        }
      }
    };
    dialog.addEventListener("keydown", onKeyDown);
    return () => {
      dialog.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [open, dialogRef]);
}
