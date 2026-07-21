"use client";

import { useEffect, useState } from "react";

function detectMobileDevice() {
  if (typeof window === "undefined") return null;

  const width = window.innerWidth;
  const hasTouch = typeof navigator !== "undefined" && navigator.maxTouchPoints > 1;
  const coarsePointer = typeof window.matchMedia === "function"
    ? window.matchMedia("(pointer: coarse)").matches
    : false;
  const narrowViewport = width <= 768;
  const tabletViewport = width <= 1180 && (hasTouch || coarsePointer);

  return narrowViewport || tabletViewport;
}

export function useIsMobileDevice() {
  const [isMobileDevice, setIsMobileDevice] = useState(() => detectMobileDevice());

  useEffect(() => {
    const checkDevice = () => {
      setIsMobileDevice(detectMobileDevice());
    };

    checkDevice();
    window.addEventListener("resize", checkDevice);
    window.addEventListener("orientationchange", checkDevice);

    return () => {
      window.removeEventListener("resize", checkDevice);
      window.removeEventListener("orientationchange", checkDevice);
    };
  }, []);

  return isMobileDevice;
}
