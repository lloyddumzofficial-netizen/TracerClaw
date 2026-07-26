"use client";

import Link from "next/link";
import { useEffect } from "react";
import { trackEvent } from "@/lib/analytics";

export function SeoPageTracker({ pageType, slug, title }) {
  useEffect(() => {
    trackEvent("seo_landing_page_view", { page_type: pageType, slug, title });
  }, [pageType, slug, title]);

  return null;
}

export function TrackedSeoLink({ href, children, eventName = "seo_cta_click", properties = {}, ...props }) {
  return (
    <Link
      href={href}
      {...props}
      onClick={() => trackEvent(eventName, { href: String(href), ...properties })}
    >
      {children}
    </Link>
  );
}
