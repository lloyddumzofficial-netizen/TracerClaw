"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import styles from "./MovingArtworkGallery.module.css";

const artworks = [
  "Tabako Festival front artwork", "Tabako Festival back artwork",
  "Obsidian Wolves basketball artwork", "Black and gold team artwork",
  "Cyan geometric panel artwork", "Blue and white sports jersey artwork",
  "Teal cycling jersey artwork",
];

export default function MovingArtworkGallery() {
  const stageRef = useRef(null);
  const travelRef = useRef(0);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReducedMotion(preference.matches);
    sync();
    preference.addEventListener("change", sync);
    return () => preference.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    const cards = [...stage.children];
    let width = stage.clientWidth;
    let visible = false;
    let frame = 0;
    let previous = 0;
    const draw = () => {
      const step = width < 600 ? 208 : 288;
      const loop = step * cards.length;
      cards.forEach((card, index) => {
        const x = ((index * step - travelRef.current + loop / 2) % loop + loop) % loop - loop / 2;
        const distance = Math.min(Math.abs(x) / (width / 2), 1.3);
        const y = -distance * distance * 25;
        const turn = Math.max(-36, Math.min(36, -x / (width / 2) * 30));
        card.style.transform = `translate(-50%, -50%) translate3d(${x}px, ${y}px, 0) rotateY(${turn}deg)`;
      });
    };
    const tick = now => {
      travelRef.current += Math.min(now - (previous || now), 50) * (reducedMotion ? .014 : .035);
      previous = now;
      draw();
      frame = requestAnimationFrame(tick);
    };
    const sync = () => {
      cancelAnimationFrame(frame);
      previous = 0;
      if (visible && !document.hidden) frame = requestAnimationFrame(tick);
    };
    const resize = new ResizeObserver(() => { width = stage.clientWidth; draw(); });
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); });
    draw();
    resize.observe(stage);
    observer.observe(stage);
    document.addEventListener("visibilitychange", sync);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      observer.disconnect();
      document.removeEventListener("visibilitychange", sync);
    };
  }, [reducedMotion]);

  return (
    <section className={styles.section} aria-labelledby="moving-artwork-heading">
      <header className={styles.heading}>
        <span>Made for production</span>
        <h2 id="moving-artwork-heading">Artwork worth a closer look.</h2>
      </header>
      <div className={styles.viewport}>
        <div className={styles.stage} ref={stageRef} data-artwork-gallery="">
          {artworks.map((alt, index) => (
            <figure className={styles.card} key={alt} style={{ "--x": `${(index - 3) * 288}px`, "--y": "0px", "--turn": "0deg" }}>
              <Image src={`/Moving_Images/${index + 1}.JPG`} alt={alt} width={563} height={834} sizes="(max-width: 600px) 184px, 260px" />
            </figure>
          ))}
        </div>
      </div>
      <footer className={styles.footer}>
        <p>Explore detailed garment panels and bold team graphics, all inside DesaynClaw.</p>
      </footer>
    </section>
  );
}
