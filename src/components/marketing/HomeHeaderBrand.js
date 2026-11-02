"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./HomeHeaderBrand.module.css";

export default function HomeHeaderBrand({ heroLogoRef, scrollRootRef }) {
  const buttonRef = useRef(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const logo = heroLogoRef.current;
    const header = buttonRef.current?.closest("header");
    if (!logo || !header) return;
    if (!("IntersectionObserver" in window)) {
      setVisible(true);
      return;
    }

    let observer;
    const observeLogo = () => {
      observer?.disconnect();
      const headerHeight = Math.ceil(header.getBoundingClientRect().height);
      observer = new IntersectionObserver(([entry]) => {
        setVisible(!entry.isIntersecting && entry.boundingClientRect.bottom <= headerHeight);
      }, { rootMargin: `-${headerHeight}px 0px 0px 0px`, threshold: 0 });
      observer.observe(logo);
    };

    observeLogo();
    window.addEventListener("resize", observeLogo, { passive: true });
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", observeLogo);
    };
  }, [heroLogoRef]);

  const returnToTop = () => {
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth";
    scrollRootRef.current?.scrollTo({ top: 0, behavior });
    window.scrollTo({ top: 0, behavior });
    // The return control becomes hidden again at the hero. Move focus to the
    // visible logo instead of leaving keyboard focus on a disappearing button.
    heroLogoRef.current?.focus({ preventScroll: true });
  };

  return (
    <button
      ref={buttonRef}
      className={`home-topbar-brand ${styles.brand}`}
      data-visible={visible}
      type="button"
      onClick={returnToTop}
      aria-label="Return to the top of your workspace"
      aria-hidden={!visible}
      tabIndex={visible ? 0 : -1}
    >
      <img src="/nav bar logo.png" alt="DesaynClaw" />
    </button>
  );
}
