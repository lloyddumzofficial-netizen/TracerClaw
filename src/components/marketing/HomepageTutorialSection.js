"use client";

import { useRef, useState } from "react";
import { Clock3, Play } from "lucide-react";

const TUTORIAL_VIDEO_URL =
  "https://pub-f2ce547db5ec43259557b815b0c02ae8.r2.dev/desaynclaw_video-tutorial/DESAYNCLAW-TUTORIAL.compressed.mp4";


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
          <h2 id="homepage-tutorial-title">Watch the complete workflow, from upload to export.</h2>
        </div>
        <div className="homepage-tutorial-summary">
          <p>Mike walks through the real DesaynClaw workflow—including Claws, artwork extraction, review, and Google Drive delivery.</p>
          <span><Clock3 size={13} aria-hidden="true" /> 5-minute product tutorial</span>
        </div>
      </header>

      <div className="homepage-tutorial-player" data-playing={isPlaying}>
        <div className="homepage-tutorial-playerbar" aria-hidden="true">
          <span>DesaynClaw Academy</span>
          <span>Official walkthrough</span>
        </div>
        <div className="homepage-tutorial-video-wrap">
          <video
            ref={videoRef}
            controls
            playsInline
            preload="metadata"
            controlsList="nodownload"
            aria-label="How to use DesaynClaw complete tutorial"
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onEnded={() => setIsPlaying(false)}
          >
            <source src={TUTORIAL_VIDEO_URL} type="video/mp4" />
            Your browser does not support HTML video.
          </video>
          {!isPlaying && (
            <button className="homepage-tutorial-play" type="button" onClick={handlePlay} aria-label="Play the DesaynClaw tutorial">
              <Play size={28} fill="currentColor" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
