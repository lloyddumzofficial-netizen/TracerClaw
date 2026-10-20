"use client";

import { useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";

export const NAVIGATION_START_EVENT = "desaynclaw:navigation-start";

export function isTrackableNavigation(href, currentHref) {
  try {
    const current = new URL(currentHref);
    const destination = new URL(String(href), current);

    if (destination.origin !== current.origin) return false;
    return destination.pathname !== current.pathname || destination.search !== current.search;
  } catch {
    return false;
  }
}

export function announceNavigation(href) {
  if (typeof window === "undefined" || !isTrackableNavigation(href, window.location.href)) return;
  window.dispatchEvent(new CustomEvent(NAVIGATION_START_EVENT));
}

export function useAppRouter() {
  const router = useRouter();

  const push = useCallback((href, options) => {
    announceNavigation(href);
    return router.push(href, options);
  }, [router]);

  const replace = useCallback((href, options) => {
    announceNavigation(href);
    return router.replace(href, options);
  }, [router]);

  return useMemo(() => ({ ...router, push, replace }), [router, push, replace]);
}
