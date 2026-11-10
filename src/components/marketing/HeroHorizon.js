"use client";

import { useId } from "react";
import styles from "./HeroHorizon.module.css";

// An open light arc with static bloom, rather than a solid outlined ellipse.
export default function HeroHorizon() {
  const id = useId();
  const glow = `${id}-glow`;
  const soft = `${id}-soft`;
  const light = `${id}-light`;
  const fade = `${id}-fade`;
  const path = "M -100 540 Q 800 -300 1700 540";

  return (
    <>
    <div className={styles.atmosphere} aria-hidden="true" />
    <div className={styles.horizon} aria-hidden="true" data-hero-horizon="">
      <svg className={styles.arc} viewBox="0 0 1600 480" fill="none" preserveAspectRatio="none" focusable="false">
        <defs>
          <linearGradient id={fade} x1="0" y1="0" x2="1600" y2="0" gradientUnits="userSpaceOnUse">
            <stop stopColor="#ffcc58" stopOpacity="0" />
            <stop offset=".15" stopColor="#f7cc6b" stopOpacity=".55" />
            <stop offset=".38" stopColor="#fff0bd" />
            <stop offset=".52" stopColor="#fff7de" />
            <stop offset=".7" stopColor="#f8dd93" stopOpacity=".85" />
            <stop offset="1" stopColor="#ffcc58" stopOpacity="0" />
          </linearGradient>
          <filter id={glow} x="-20%" y="-70%" width="140%" height="240%" colorInterpolationFilters="sRGB"><feGaussianBlur stdDeviation="25" /></filter>
          <filter id={soft} x="-10%" y="-30%" width="120%" height="160%" colorInterpolationFilters="sRGB"><feGaussianBlur stdDeviation="8" /></filter>
          <filter id={light} x="-5%" y="-10%" width="110%" height="120%" colorInterpolationFilters="sRGB"><feGaussianBlur stdDeviation="2.4" /></filter>
        </defs>
        <path d={path} stroke={`url(#${fade})`} strokeWidth="74" opacity=".24" filter={`url(#${glow})`} />
        <path d={path} stroke={`url(#${fade})`} strokeWidth="22" opacity=".72" filter={`url(#${soft})`} />
        <path d={path} stroke={`url(#${fade})`} strokeWidth="6" opacity=".9" filter={`url(#${light})`} />
      </svg>
    </div>
    </>
  );
}
