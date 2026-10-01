"use client";

import { useRef, useState } from "react";
import { Play } from "lucide-react";

const DEMO_VIDEO_URL =
  "https://pub-f2ce547db5ec43259557b815b0c02ae8.r2.dev/MARKETING%20VIDEO%202.mp4";

export default function GuestDemoMonitor() {
  const videoRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const handlePlay = () => {
    videoRef.current?.play().catch(() => {});
  };

  return (
    <section className="guest-demo-stage" aria-label="DesaynClaw product demonstration">
      <div className="guest-demo-device">
        <div className="guest-demo-mac">
          <div className="guest-demo-screen">
            <video
              ref={videoRef}
              controls
              playsInline
              preload="metadata"
              poster="https://pub-f2ce547db5ec43259557b815b0c02ae8.r2.dev/images-desaynclaw/THUMBNAIL-VIDEO-DEMO.jpg"
              aria-label="Watch the DesaynClaw artwork extraction workflow"
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onEnded={() => setIsPlaying(false)}
            >
              <source src={DEMO_VIDEO_URL} type="video/mp4" />
              Your browser does not support HTML video.
            </video>
            {!isPlaying && (
              <button className="guest-demo-play" type="button" onClick={handlePlay} aria-label="Play the DesaynClaw product walkthrough">
                <Play size={27} fill="currentColor" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="guest-demo-caption" aria-hidden="true">
        <span>DESAYNCLAW WORKSPACE</span>
        <small>01:21 PRODUCT WALKTHROUGH</small>
      </div>
    </section>
  );
}
