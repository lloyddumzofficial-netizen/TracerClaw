"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRightIcon as ArrowRight, XIcon as X } from "@phosphor-icons/react/ssr";
import styles from "./OrbitAnnouncement.module.css";

const DAY_MS = 24 * 60 * 60 * 1000;
const sessionViews = new Map();

export default function OrbitAnnouncement({ userId, blocked }) {
  const dialogRef = useRef(null);
  const [showVideo, setShowVideo] = useState(false);

  useEffect(() => {
    if (!userId || blocked) return;
    const key = `desaynclaw:orbit:last-seen:${userId}`;
    const dialog = dialogRef.current;
    let timer;

    const check = () => {
      window.clearTimeout(timer);
      if (document.visibilityState !== "visible") return;
      if (dialog.open) {
        timer = window.setTimeout(check, 60_000);
        return;
      }
      let lastSeen = sessionViews.get(key) ?? 0;
      try {
        lastSeen = Math.max(lastSeen, Number(window.localStorage.getItem(key)) || 0);
      } catch {}
      const now = Date.now();
      const remaining = DAY_MS - (now - Math.min(now, lastSeen));
      if (remaining > 0) {
        timer = window.setTimeout(check, remaining);
        return;
      }

      dialog.showModal();
      setShowVideo(true);
      sessionViews.set(key, now);
      try {
        window.localStorage.setItem(key, String(now));
      } catch {}
      timer = window.setTimeout(check, DAY_MS);
    };

    // Give existing sign-in and onboarding prompts time to settle.
    timer = window.setTimeout(check, 1200);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", check);
      if (dialog.open) dialog.close();
    };
  }, [userId, blocked]);

  const close = () => dialogRef.current.close();

  return (
    <dialog className={styles.dialog} ref={dialogRef} aria-labelledby="orbit-announcement-title" data-home-native-scroll
      onClose={() => setShowVideo(false)}>
      <div className={styles.media}>
        {showVideo && (
          <video
            aria-label="DesaynClaw Orbit walkthrough"
            src="/video_marketing/desaynclaw-orbit.mp4"
            autoPlay
            muted
            loop
            playsInline
            controls
            preload="metadata"
          />
        )}
        <button type="button" className={styles.close} aria-label="Close announcement" onClick={close} autoFocus>
          <X size={17} aria-hidden="true" />
        </button>
      </div>
      <div className={styles.content}>
        <h2 id="orbit-announcement-title">DesaynClaw Orbit</h2>
        <p className={styles.lead}>Extract flat artwork, separate design elements, and convert logos into editable SVGs.</p>
        <p>Start with a garment mockup, logo, or flat design. Clean up the background, upscale the details, and export artwork for printing or further edits.</p>
        <a href="#workspace-tools" onClick={close} className={styles.action}>
          Explore the tools <ArrowRight size={16} aria-hidden="true" />
        </a>
        <a href="#how-desaynclaw-works" onClick={close} className={styles.secondary}>Watch the walkthrough</a>
      </div>
    </dialog>
  );
}
