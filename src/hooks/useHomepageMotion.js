"use client";

import { useCallback, useEffect, useRef } from "react";
import { NAVIGATION_START_EVENT } from "./useAppRouter";

const REVEAL_SECTIONS = [
  ".home-content-frame > .workflow-preview-section",
  ".home-content-frame > .desktop-tools-shelf",
  ".home-content-frame .guest-landing-example",
  ".home-content-frame > .edu-demo-section",
  ".home-content-frame > .edu-cards-section",
  ".home-content-frame > .how-it-works-section",
  ".home-content-frame > .homepage-tutorial-section",
  ".home-content-frame > .product-features-section",
  ".home-content-frame > .tool-showcase-section",
  ".home-content-frame > .great-for-section",
  ".home-content-frame > .testimonial-showcase",
  ".home-content-frame #pricing",
  ".home-content-frame #faq",
].join(",");

// Explicit exclusions: no computed-style/overflow scan on each wheel event.
const NATIVE_SURFACES = '[data-home-native-scroll], [role="dialog"], [aria-modal="true"], .modal-content, .recent-grid, .ba-slider-stage, input, textarea, select, video, iframe';

export default function useHomepageMotion({ rootRef, view, blocked }) {
  const controllerRef = useRef(null);
  const blockedRef = useRef(blocked);

  useEffect(() => {
    blockedRef.current = blocked;
    controllerRef.current?.sync();
  }, [blocked]);

  // Stable across auth updates. Native fallback also serves touch and keyboard users.
  const scrollToSection = useCallback((target) => {
    const element = typeof target === "string" ? document.getElementById(target.replace(/^#/, "")) : target;
    if (target !== 0 && !element) return;
    const offset = element && element.id !== "start"
      ? parseFloat(getComputedStyle(element).scrollMarginTop) || 96 : 0;
    // Resolve to pixels once: Lenis also applies CSS scroll-margin for element
    // targets, which would otherwise count the header clearance twice.
    const top = element ? element.getBoundingClientRect().top + window.scrollY - offset : 0;
    if (controllerRef.current?.scrollTo(top)) return;
    window.scrollTo({
      top,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
    });
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const desktop = window.matchMedia("(hover: hover) and (pointer: fine)");
    let disposed = false;
    let generation = 0;
    let lenis;
    let frame = 0;
    let ticking = false;
    let navigating = false;
    let dragging = false;
    let privacyBlocked = !localStorage.getItem("ai_disclaimer_seen");
    let restoreScrollBehavior;

    const cancelFrame = () => { cancelAnimationFrame(frame); frame = 0; };
    const tick = (time) => {
      frame = 0;
      if (!lenis || lenis.isStopped || document.hidden) return;
      ticking = true;
      lenis.raf(time);
      ticking = false;
      if (!frame && lenis.isScrolling === "smooth") frame = requestAnimationFrame(tick);
    };
    const wake = () => {
      if (lenis && !frame && !ticking && !lenis.isStopped && !document.hidden) {
        // Each idle-to-active transition gets a fresh clock, not a large stale delta.
        lenis.time = 0;
        frame = requestAnimationFrame(tick);
      }
    };
    const sync = () => {
      if (!lenis) return;
      if (blockedRef.current || privacyBlocked || dragging || navigating || document.hidden) {
        // Flush the target before stopping so closing a dialog cannot resume stale inertia.
        lenis.scrollTo(window.scrollY, { immediate: true, force: true });
        lenis.stop();
        cancelFrame();
      } else {
        lenis.start();
      }
    };
    const destroy = () => {
      cancelFrame();
      lenis?.destroy();
      lenis = undefined;
      delete root.dataset.homeSmooth;
      restoreScrollBehavior?.();
      restoreScrollBehavior = undefined;
    };
    const configure = async () => {
      const token = ++generation;
      destroy();
      if (preference.matches || !desktop.matches || navigating) return;
      try {
        const { default: Lenis } = await import("lenis");
        if (disposed || token !== generation) return;
        lenis = new Lenis({
          autoRaf: false, smoothWheel: true, lerp: 0.1, wheelMultiplier: 1,
          syncTouch: false, anchors: false,
          prevent: (node) => node instanceof Element && node.matches(NATIVE_SURFACES),
        });
        const html = document.documentElement;
        const value = html.style.getPropertyValue("scroll-behavior");
        const priority = html.style.getPropertyPriority("scroll-behavior");
        html.style.setProperty("scroll-behavior", "auto", "important");
        restoreScrollBehavior = () => {
          if (value) html.style.setProperty("scroll-behavior", value, priority);
          else html.style.removeProperty("scroll-behavior");
        };
        root.dataset.homeSmooth = "true";
        lenis.on("scroll", wake);
        sync();
      } catch {
        // Enhancement failure must never prevent navigation or native scrolling.
        destroy();
      }
    };
    const onAnchor = (event) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target.closest?.("a[href]");
      if (!link || link.target || link.hasAttribute("download")) return;
      const url = new URL(link.href, window.location.href);
      if (!url.hash || url.origin !== location.origin || url.pathname !== location.pathname || url.search !== location.search) return;
      let id;
      try { id = decodeURIComponent(url.hash.slice(1)); } catch { return; }
      const target = document.getElementById(id);
      if (!target || !root.contains(target)) return;
      event.preventDefault();
      if (location.hash !== url.hash) history.pushState(null, "", url.hash);
      scrollToSection(target);
    };
    const onNavigate = () => { navigating = true; ++generation; destroy(); };
    const onPrivacyAccepted = () => { privacyBlocked = false; sync(); };
    const onPageShow = () => { navigating = false; configure(); };
    const onDragEnter = (event) => {
      if (!Array.from(event.dataTransfer?.types || []).includes("Files")) return;
      dragging = true;
      sync();
    };
    const onDragEnd = (event) => {
      if (event.type === "dragleave" && event.relatedTarget) return;
      dragging = false;
      sync();
    };
    const controller = {
      sync,
      scrollTo: (target) => {
        if (!lenis || lenis.isStopped) return false;
        lenis.scrollTo(target, { onComplete: cancelFrame });
        wake();
        return true;
      },
    };
    controllerRef.current = controller;
    preference.addEventListener("change", configure);
    desktop.addEventListener("change", configure);
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("wheel", wake, { passive: true });
    window.addEventListener(NAVIGATION_START_EVENT, onNavigate);
    window.addEventListener("desaynclaw:data-privacy-accepted", onPrivacyAccepted);
    window.addEventListener("pagehide", onNavigate);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragleave", onDragEnd);
    window.addEventListener("dragend", onDragEnd);
    window.addEventListener("drop", onDragEnd);
    root.addEventListener("click", onAnchor);
    configure();
    return () => {
      disposed = true;
      ++generation;
      destroy();
      if (controllerRef.current === controller) controllerRef.current = null;
      preference.removeEventListener("change", configure);
      desktop.removeEventListener("change", configure);
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("wheel", wake);
      window.removeEventListener(NAVIGATION_START_EVENT, onNavigate);
      window.removeEventListener("desaynclaw:data-privacy-accepted", onPrivacyAccepted);
      window.removeEventListener("pagehide", onNavigate);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragleave", onDragEnd);
      window.removeEventListener("dragend", onDragEnd);
      window.removeEventListener("drop", onDragEnd);
      root.removeEventListener("click", onAnchor);
    };
  }, [rootRef, view, scrollToSection]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !("IntersectionObserver" in window)) return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sections = [...root.querySelectorAll(REVEAL_SECTIONS)];
    let observer;
    const clear = () => {
      observer?.disconnect();
      sections.forEach((section) => {
        delete section.dataset.homeReveal;
        delete section.dataset.homeRevealed;
        [...section.children].forEach((piece) => {
          delete piece.dataset.homeRevealPiece;
          piece.style.removeProperty("--home-reveal-order");
        });
      });
    };
    const configure = () => {
      clear();
      if (preference.matches) return;
      observer = new IntersectionObserver((entries) => {
        entries.forEach(({ target, isIntersecting }) => {
          if (!isIntersecting) return;
          target.dataset.homeRevealed = "true";
          observer.unobserve(target);
        });
      }, { rootMargin: "0px 0px -24px 0px", threshold: 0 });
      // Never hide content already on screen, including restored scroll positions.
      const belowFold = sections.filter(section => section.getBoundingClientRect().top >= window.innerHeight);
      belowFold.forEach(section => {
        section.dataset.homeReveal = "true";
        [...section.children].forEach((piece, index) => {
          piece.dataset.homeRevealPiece = "true";
          piece.style.setProperty("--home-reveal-order", String(Math.min(index, 3)));
        });
        observer.observe(section);
      });
    };
    const onFocus = (event) => {
      const section = event.target.closest?.("[data-home-reveal]");
      if (section) { section.dataset.homeRevealed = "true"; observer?.unobserve(section); }
    };
    configure();
    root.addEventListener("focusin", onFocus);
    preference.addEventListener("change", configure);
    return () => {
      clear();
      root.removeEventListener("focusin", onFocus);
      preference.removeEventListener("change", configure);
    };
  }, [rootRef, view]);

  return scrollToSection;
}
