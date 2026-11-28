"use client";

import { useRef, useState } from "react";
import { ClockIcon as Clock3, PlayIcon as Play } from "@phosphor-icons/react/ssr";

const DEMO_VIDEO_URL =
  "https://pub-f2ce547db5ec43259557b815b0c02ae8.r2.dev/MARKETING%20VIDEO%202.mp4";


export default function HomepageTutorialSection() {
  const videoRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const handlePlay = () => {
    videoRef.current?.play().catch(() => {});
  };

  return (
    <section
      id="how-desaynclaw-works"
      className="homepage-tutorial-section"
      aria-labelledby="homepage-tutorial-title"
    >
      <header className="homepage-tutorial-heading">
        <div>
          <h2 id="homepage-tutorial-title">See the artwork workflow in action.</h2>
        </div>
        <div className="homepage-tutorial-summary">
          <p>A quick look at turning garment mockups into flat artwork, reviewing the details, and preparing your files for export.</p>
          <span><Clock3 size={13} aria-hidden="true" /> 1-minute product demo</span>
        </div>
      </header>

      <div className="homepage-tutorial-player" data-playing={isPlaying}>
        <div className="homepage-tutorial-playerbar" aria-hidden="true">
          <span>DesaynClaw Studio</span>
          <span>Artwork demo</span>
        </div>
        <div className="homepage-tutorial-video-wrap">
          <video
            ref={videoRef}
            controls
            playsInline
            preload="metadata"
            controlsList="nodownload"
            aria-label="DesaynClaw artwork workflow demo"
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onEnded={() => setIsPlaying(false)}
          >
            <source src={DEMO_VIDEO_URL} type="video/mp4" />
            Your browser does not support HTML video.
          </video>
          {!isPlaying && (
            <button className="homepage-tutorial-play" type="button" onClick={handlePlay} aria-label="Play the DesaynClaw artwork demo">
              <Play size={28} weight="fill" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
