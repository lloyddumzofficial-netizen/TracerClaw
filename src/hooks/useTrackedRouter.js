"use client";

import { useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";

export const NAVIGATION_START_EVENT = "desaynclaw:navigation-start";

function shouldTrackNavigation(href) {
  if (typeof window === "undefined") return false;
  try {
    const destination = new URL(String(href), window.location.href);
    if (destination.origin !== window.location.origin) return false;
    return destination.href !== window.location.href;
  } catch {
    return false;
  }
}

export function announceNavigation(href) {
  if (!shouldTrackNavigation(href)) return;
  window.dispatchEvent(new CustomEvent(NAVIGATION_START_EVENT, { detail: { href: String(href) } }));
}

export function useTrackedRouter() {
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
