"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { isTrackableNavigation, NAVIGATION_START_EVENT } from "@/hooks/useAppRouter";

const MINIMUM_VISIBLE_MS = 320;
const COMPLETION_MS = 200;
const FADE_MS = 180;
const SAFETY_TIMEOUT_MS = 12_000;

function isInternalNavigationClick(event) {
  if (event.defaultPrevented || event.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;

  const target = event.target instanceof Element ? event.target : null;
  const anchor = target?.closest("a[href]");
  if (!anchor || anchor.hasAttribute("download")) return false;
  if (anchor.target && anchor.target.toLowerCase() !== "_self") return false;

  return isTrackableNavigation(anchor.href, window.location.href);
}

export default function NavigationFeedback() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const routeKey = `${pathname}?${searchParams.toString()}`;
  const previousRouteRef = useRef(routeKey);
  const startedAtRef = useRef(0);
  const timersRef = useRef(new Set());
  const phaseRef = useRef("idle");
  const [phase, setPhase] = useState("idle");

  const updatePhase = useCallback((nextPhase) => {
    phaseRef.current = nextPhase;
    setPhase(nextPhase);
  }, []);

  const clearTimers = useCallback(() => {
    timersRef.current.forEach((timer) => window.clearTimeout(timer));
    timersRef.current.clear();
  }, []);

  const schedule = useCallback((callback, delay) => {
    const timer = window.setTimeout(() => {
      timersRef.current.delete(timer);
      callback();
    }, delay);
    timersRef.current.add(timer);
  }, []);

  const reset = useCallback(() => {
    clearTimers();
    startedAtRef.current = 0;
    updatePhase("idle");
  }, [clearTimers, updatePhase]);

  const start = useCallback(() => {
    clearTimers();
    startedAtRef.current = performance.now();
    updatePhase("active");
    schedule(reset, SAFETY_TIMEOUT_MS);
  }, [clearTimers, reset, schedule, updatePhase]);

  const complete = useCallback(() => {
    if (phaseRef.current === "idle") return;

    clearTimers();
    const elapsed = performance.now() - startedAtRef.current;
    const wait = Math.max(0, MINIMUM_VISIBLE_MS - elapsed);

    schedule(() => {
      updatePhase("complete");
      schedule(() => {
        updatePhase("fading");
        schedule(reset, FADE_MS);
      }, COMPLETION_MS);
    }, wait);
  }, [clearTimers, reset, schedule, updatePhase]);

  useEffect(() => {
    const handleClick = (event) => {
      if (isInternalNavigationClick(event)) start();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") reset();
    };
    const handlePopState = () => {
      const nextRouteKey = `${window.location.pathname}?${new URLSearchParams(window.location.search).toString()}`;
      if (nextRouteKey !== previousRouteRef.current) start();
    };

    document.addEventListener("click", handleClick, true);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener(NAVIGATION_START_EVENT, start);
    window.addEventListener("popstate", handlePopState);
    window.addEventListener("pageshow", reset);

    return () => {
      document.removeEventListener("click", handleClick, true);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener(NAVIGATION_START_EVENT, start);
      window.removeEventListener("popstate", handlePopState);
      window.removeEventListener("pageshow", reset);
      clearTimers();
    };
  }, [clearTimers, reset, start]);

  useEffect(() => {
    if (previousRouteRef.current === routeKey) return;
    previousRouteRef.current = routeKey;
    complete();
  }, [complete, routeKey]);

  return (
    <div className="global-navigation-feedback" data-state={phase} aria-hidden="true">
      <span />
    </div>
  );
}
