"use client";

const EVENT_NAMES = {
  pageView: "page_view",
  userSignup: "user_signup",
  userLogin: "user_login",
  traceStarted: "trace_started",
  traceCompleted: "trace_completed",
  downloadSvg: "download_svg",
  checkoutStarted: "checkout_started",
  creditsPurchased: "credits_purchased",
  affiliateReferral: "affiliate_referral",
  error: "error_event",
};

let initialized = false;
let initializing = false;
const pendingEvents = [];
let sentryModulePromise = null;

function isBrowser() {
  return typeof window !== "undefined";
}

function getConfig() {
  return {
    gaId: process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID || "",
    clarityId: process.env.NEXT_PUBLIC_CLARITY_PROJECT_ID || "",
    posthogKey: process.env.NEXT_PUBLIC_POSTHOG_KEY || "",
    posthogHost: process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com",
    sentryDsn: process.env.NEXT_PUBLIC_SENTRY_DSN || "",
  };
}

function hasAnalyticsConsent() {
  if (!isBrowser()) return false;
  return window.localStorage.getItem("cookie_consent") === "accepted";
}

function getDistinctId() {
  if (!isBrowser()) return "server";
  const key = "desaynclaw_analytics_id";
  let id = window.localStorage.getItem(key);
  if (!id) {
    id = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    window.localStorage.setItem(key, id);
  }
  return id;
}

function loadScript(src, id, onLoad) {
  if (!isBrowser() || document.getElementById(id)) {
    onLoad?.();
    return;
  }
  const script = document.createElement("script");
  script.id = id;
  script.src = src;
  script.async = true;
  script.onload = () => onLoad?.();
  document.head.appendChild(script);
}

function initGoogleAnalytics(gaId) {
  if (!gaId) return;
  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function gtag() { window.dataLayer.push(arguments); };
  window.gtag("js", new Date());
  window.gtag("config", gaId, { send_page_view: false });
  loadScript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(gaId)}`, "desaynclaw-ga4");
}

function initClarity(projectId) {
  if (!projectId) return;
  window.clarity = window.clarity || function clarity() {
    (window.clarity.q = window.clarity.q || []).push(arguments);
  };
  loadScript(`https://www.clarity.ms/tag/${encodeURIComponent(projectId)}`, "desaynclaw-clarity");
}

function normalizeProperties(properties = {}) {
  return {
    app: "desaynclaw",
    path: isBrowser() ? window.location.pathname : undefined,
    url: isBrowser() ? window.location.href : undefined,
    ...properties,
  };
}

function sendPostHogEvent(eventName, properties = {}) {
  const { posthogKey, posthogHost } = getConfig();
  if (!posthogKey || !hasAnalyticsConsent()) return;
  const { distinct_id: distinctIdOverride, ...eventProperties } = properties;

  const payload = JSON.stringify({
    api_key: posthogKey,
    event: eventName,
    distinct_id: distinctIdOverride || getDistinctId(),
    properties: eventProperties,
    timestamp: new Date().toISOString(),
  });

  const url = `${posthogHost.replace(/\/$/, "")}/capture/`;
  if (navigator.sendBeacon) {
    navigator.sendBeacon(url, new Blob([payload], { type: "application/json" }));
    return;
  }
  fetch(url, {
    method: "POST",
    body: payload,
    headers: { "Content-Type": "application/json" },
    keepalive: true,
  }).catch(() => {});
}

function getSentry() {
  if (!isBrowser() || !getConfig().sentryDsn) return null;
  sentryModulePromise = sentryModulePromise || import("@sentry/nextjs");
  return sentryModulePromise;
}

function sendToLoadedProviders(eventName, properties) {
  if (window.gtag) {
    window.gtag("event", eventName, properties);
  }
  if (window.clarity) {
    window.clarity("event", eventName);
  }
  sendPostHogEvent(eventName, properties);
  getSentry()?.then((Sentry) => {
    Sentry.addBreadcrumb({ category: "analytics", message: eventName, data: properties, level: "info" });
  });
}

export function initializeAnalytics() {
  if (!isBrowser() || initialized || initializing || !hasAnalyticsConsent()) return;
  initializing = true;

  const config = getConfig();
  const start = () => {
    initGoogleAnalytics(config.gaId);
    initClarity(config.clarityId);
    initialized = true;
    initializing = false;
    while (pendingEvents.length) {
      const [eventName, properties] = pendingEvents.shift();
      sendToLoadedProviders(eventName, properties);
    }
  };

  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(start, { timeout: 2500 });
  } else {
    window.setTimeout(start, 1200);
  }
}

export function getMonitoringStatus() {
  if (!isBrowser()) {
    return { browser: false };
  }

  const config = getConfig();
  const sentryClient = window.Sentry?.getClient?.();

  return {
    browser: true,
    consent: window.localStorage.getItem("cookie_consent") || null,
    marketingAnalyticsInitialized: initialized,
    configured: {
      ga4: Boolean(config.gaId),
      clarity: Boolean(config.clarityId),
      posthog: Boolean(config.posthogKey),
      sentry: Boolean(config.sentryDsn),
    },
    loaded: {
      ga4: typeof window.gtag === "function",
      clarity: typeof window.clarity === "function",
      clarityScript: Boolean(document.getElementById("desaynclaw-clarity")),
      sentry: Boolean(sentryClient),
    },
    captureReady: {
      posthog: Boolean(config.posthogKey) && hasAnalyticsConsent(),
    },
  };
}

export function installMonitoringDebug() {
  if (!isBrowser()) return;
  window.desaynclawMonitoringStatus = getMonitoringStatus;
  window.desaynclawTestSentry = async function desaynclawTestSentry(message = "DesaynClaw browser Sentry test") {
    const Sentry = await getSentry();
    if (!Sentry) return { sent: false, reason: "NEXT_PUBLIC_SENTRY_DSN is not configured in the browser bundle" };
    const eventId = Sentry.captureException(new Error(message), {
      tags: { source: "desaynclaw-monitoring-debug" },
      extra: getMonitoringStatus(),
    });
    await Sentry.flush?.(2000);
    return { sent: true, eventId };
  };
}

export function trackEvent(eventName, properties = {}) {
  if (!isBrowser() || !hasAnalyticsConsent()) return;
  const normalized = normalizeProperties(properties);

  if (!initialized) {
    pendingEvents.push([eventName, normalized]);
    initializeAnalytics();
    return;
  }
  sendToLoadedProviders(eventName, normalized);
}

export function trackPageView(url, title = document.title) {
  trackEvent(EVENT_NAMES.pageView, { page_location: url, page_title: title });
}

export function identifyUser(user) {
  if (!isBrowser() || !hasAnalyticsConsent() || !user?.id) return;
  const traits = { email: user.email || undefined };

  if (window.gtag) {
    window.gtag("set", { user_id: user.id });
  }
  sendPostHogEvent("$identify", { $anon_distinct_id: getDistinctId(), $set: traits, distinct_id: user.id });
  getSentry()?.then((Sentry) => Sentry.setUser({ id: user.id, email: user.email }));
}

export function trackAuthSession(user, properties = {}) {
  if (!isBrowser() || !user?.id || !hasAnalyticsConsent()) return;
  identifyUser(user);

  const loginKey = `desaynclaw_login_tracked_${user.id}`;
  if (!window.sessionStorage.getItem(loginKey)) {
    trackEvent(EVENT_NAMES.userLogin, properties);
    window.sessionStorage.setItem(loginKey, "1");
  }

  const createdAt = user.created_at ? new Date(user.created_at).getTime() : 0;
  const isFreshSignup = createdAt && Date.now() - createdAt < 5 * 60 * 1000;
  const signupKey = `desaynclaw_signup_tracked_${user.id}`;
  if (isFreshSignup && !window.localStorage.getItem(signupKey)) {
    trackEvent(EVENT_NAMES.userSignup, properties);
    window.localStorage.setItem(signupKey, "1");
  }
}

export function resetAnalytics() {
  if (!isBrowser()) return;
  getSentry()?.then((Sentry) => Sentry.setUser(null));
}

export function trackError(error, properties = {}) {
  const message = error?.message || String(error);
  trackEvent(EVENT_NAMES.error, { ...properties, message });
  getSentry()?.then((Sentry) => {
    Sentry.captureException(error instanceof Error ? error : new Error(message), { extra: properties });
  });
}

export const analyticsEvents = EVENT_NAMES;

export const analytics = {
  trackEvent,
  pageView: trackPageView,
  userSignup: (properties) => trackEvent(EVENT_NAMES.userSignup, properties),
  userLogin: (properties) => trackEvent(EVENT_NAMES.userLogin, properties),
  traceStarted: (properties) => trackEvent(EVENT_NAMES.traceStarted, properties),
  traceCompleted: (properties) => trackEvent(EVENT_NAMES.traceCompleted, properties),
  downloadSvg: (properties) => trackEvent(EVENT_NAMES.downloadSvg, properties),
  checkoutStarted: (properties) => trackEvent(EVENT_NAMES.checkoutStarted, properties),
  creditsPurchased: (properties) => trackEvent(EVENT_NAMES.creditsPurchased, properties),
  affiliateReferral: (properties) => trackEvent(EVENT_NAMES.affiliateReferral, properties),
  error: trackError,
  identify: identifyUser,
  authSession: trackAuthSession,
  reset: resetAnalytics,
  status: getMonitoringStatus,
  installDebug: installMonitoringDebug,
};
