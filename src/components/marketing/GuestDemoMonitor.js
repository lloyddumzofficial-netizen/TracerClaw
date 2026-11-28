"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { PlayIcon as Play } from "@phosphor-icons/react/ssr";
import tutorialThumbnail from "../../../public/EMAIL-VIDEO-THUMBNAIL-TUTOORIAL.jpg";
import styles from "./GuestDemoMonitor.module.css";
import { HeroGlow } from "./HeroHorizon";

const DEMO_VIDEO_URL =
  "https://pub-f2ce547db5ec43259557b815b0c02ae8.r2.dev/desaynclaw_video-tutorial/DESAYNCLAW-TUTORIAL.compressed.mp4";

export default function GuestDemoMonitor() {
  const videoRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);

  const handlePlay = () => {
    videoRef.current?.play().catch(() => {});
  };

  return (
    <section className={`guest-demo-stage ${styles.stage}`} aria-label="DesaynClaw product demonstration">
      <HeroGlow />
      <div className="guest-demo-device">
        <div className="guest-demo-mac">
          <div className="guest-demo-windowbar" aria-hidden="true">
            <span className="guest-demo-window-controls">
              <i />
              <i />
              <i />
            </span>
            <span className="guest-demo-window-title">DesaynClaw Studio</span>
            <span className="guest-demo-window-status"><i /> Live preview</span>
          </div>
          <div className="guest-demo-screen">
            <video
              ref={videoRef}
              controls
              playsInline
              preload="metadata"
              poster={tutorialThumbnail.src}
              aria-label="Watch the complete DesaynClaw video tutorial"
              onPlay={() => { setHasStarted(true); setIsPlaying(true); }}
              onPause={() => setIsPlaying(false)}
              onEnded={() => setIsPlaying(false)}
            >
              <source src={DEMO_VIDEO_URL} type="video/mp4" />
              Your browser does not support HTML video.
            </video>
            {!hasStarted && (
              <div className={styles.poster} aria-hidden="true" data-demo-poster="">
                <Image src={tutorialThumbnail} alt="" fill sizes="(max-width: 760px) 100vw, 90vw" />
              </div>
            )}
            {!isPlaying && (
              <button className="guest-demo-play" type="button" onClick={handlePlay} aria-label="Play the DesaynClaw product walkthrough">
                <Play size={27} weight="fill" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      </div>

    </section>
  );
}
