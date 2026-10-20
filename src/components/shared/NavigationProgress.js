"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { NAVIGATION_START_EVENT } from "@/hooks/useTrackedRouter";

const NAVIGATION_TIMEOUT_MS = 6000;
const COMPLETION_DURATION_MS = 220;

function isInternalRouteClick(event) {
  if (event.defaultPrevented || event.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;

  const target = event.target instanceof Element ? event.target : null;
  const anchor = target?.closest("a[href]");
  if (!anchor || anchor.hasAttribute("download")) return false;
  if (anchor.target && anchor.target.toLowerCase() !== "_self") return false;

  const destination = new URL(anchor.href, window.location.href);
  if (destination.origin !== window.location.origin) return false;
  if (destination.pathname === window.location.pathname) return false;
  return true;
}

export default function NavigationProgress() {
  const pathname = usePathname();
  const previousPathRef = useRef(pathname);
  const timeoutRef = useRef(null);
  const completionRef = useRef(null);
  const [phase, setPhase] = useState("idle");

  useEffect(() => {
    const stop = () => {
      window.clearTimeout(timeoutRef.current);
      window.clearTimeout(completionRef.current);
      setPhase("idle");
    };
    const start = () => {
      setPhase("loading");
      window.clearTimeout(completionRef.current);
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = window.setTimeout(stop, NAVIGATION_TIMEOUT_MS);
    };
    const handleClick = (event) => {
      if (!isInternalRouteClick(event)) return;
      start();
    };

    document.addEventListener("click", handleClick, true);
    window.addEventListener(NAVIGATION_START_EVENT, start);
    window.addEventListener("pageshow", stop);
    return () => {
      document.removeEventListener("click", handleClick, true);
      window.removeEventListener(NAVIGATION_START_EVENT, start);
      window.removeEventListener("pageshow", stop);
      window.clearTimeout(timeoutRef.current);
      window.clearTimeout(completionRef.current);
    };
  }, []);

  useEffect(() => {
    if (previousPathRef.current === pathname) return;
    previousPathRef.current = pathname;
    window.clearTimeout(timeoutRef.current);
    setPhase("complete");
    window.clearTimeout(completionRef.current);
    completionRef.current = window.setTimeout(() => setPhase("idle"), COMPLETION_DURATION_MS);
  }, [pathname]);

  return (
    <div className="global-navigation-progress" data-state={phase} aria-hidden="true">
      <span />
    </div>
  );
}
