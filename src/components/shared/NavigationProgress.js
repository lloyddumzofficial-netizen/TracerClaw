"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

const NAVIGATION_TIMEOUT_MS = 8000;

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
  const [active, setActive] = useState(false);

  useEffect(() => {
    const stop = () => {
      window.clearTimeout(timeoutRef.current);
      setActive(false);
    };
    const handleClick = (event) => {
      if (!isInternalRouteClick(event)) return;
      setActive(true);
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = window.setTimeout(stop, NAVIGATION_TIMEOUT_MS);
    };

    document.addEventListener("click", handleClick, true);
    window.addEventListener("pageshow", stop);
    return () => {
      document.removeEventListener("click", handleClick, true);
      window.removeEventListener("pageshow", stop);
      window.clearTimeout(timeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (previousPathRef.current === pathname) return;
    previousPathRef.current = pathname;
    window.clearTimeout(timeoutRef.current);
    setActive(false);
  }, [pathname]);

  return (
    <div className="global-navigation-progress" data-active={active} aria-hidden="true">
      <span />
    </div>
  );
}
