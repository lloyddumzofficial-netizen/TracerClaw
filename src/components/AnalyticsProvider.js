"use client";

import { useEffect, Suspense } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { initializeAnalytics, trackPageView, analytics } from "@/lib/analytics";

function AnalyticsRouteTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    const onConsent = () => initializeAnalytics();
    window.addEventListener("desaynclaw:cookie-consent", onConsent);
    initializeAnalytics();
    return () => window.removeEventListener("desaynclaw:cookie-consent", onConsent);
  }, []);

  useEffect(() => {
    if (!pathname) return;
    const query = searchParams?.toString();
    const url = query ? `${pathname}?${query}` : pathname;
    initializeAnalytics();
    trackPageView(url);

    const ref = searchParams?.get("ref") || searchParams?.get("affiliate");
    if (ref) analytics.affiliateReferral({ code: ref });
  }, [pathname, searchParams]);

  return null;
}

export default function AnalyticsProvider() {
  return (
    <Suspense fallback={null}>
      <AnalyticsRouteTracker />
    </Suspense>
  );
}
