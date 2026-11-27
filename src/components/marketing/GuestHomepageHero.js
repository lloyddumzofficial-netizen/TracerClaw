"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Play, Star } from "lucide-react";
import GuestDemoMonitor from "@/components/marketing/GuestDemoMonitor";
import GuestPricingSection from "@/components/marketing/GuestPricingSection";
import HomeTrustMarquee from "@/components/marketing/HomeTrustMarquee";
import heroStyles from "./GuestHomepageHero.module.css";
import HeroHorizon from "./HeroHorizon";

export function GuestHomepageConversionSections({ onStart }) {
  return (
    <div className="guest-landing guest-landing-lower">
      <GuestPricingSection onStart={onStart} />
    </div>
  );
}

export default function GuestHomepageHero({ onStart, publicStats }) {
  const [isInteractive, setIsInteractive] = useState(false);
  const totalUsers = Number.isFinite(publicStats?.totalUsers) ? publicStats.totalUsers : 0;
  const reviewCount = Number.isFinite(publicStats?.reviewCount) ? publicStats.reviewCount : 0;
  const avatars = Array.isArray(publicStats?.avatars) ? publicStats.avatars.slice(0, 5) : [];
  const hasCommunityProof = totalUsers > 0 || avatars.length > 0;

  // Server-rendered buttons can become visible a moment before React attaches
  // their click handlers. Keep protected entry points disabled until hydration
  // so a fast click is never silently dropped.
  useEffect(() => setIsInteractive(true), []);

  return (
    <div className="guest-landing">
      <header className="guest-landing-nav" aria-label="Main navigation">
        <a className="guest-landing-brand" href="#start" aria-label="DesaynClaw home">
          <Image
            src="/nav bar logo.png"
            alt="DesaynClaw"
            width={188}
            height={40}
            priority
            unoptimized
          />
        </a>

        <nav className={`guest-landing-links ${heroStyles.navLinks}`} aria-label="Explore DesaynClaw">
          <a className="is-current" href="#start">Home</a>
          <a href="#how-desaynclaw-works">How DesaynClaw works</a>
          <a href="#workspace-tools">Tools</a>
          <a href="#preview">Samples</a>
          <a href="#pricing">Pricing</a>
        </nav>

        <button className={`guest-landing-nav-cta ${heroStyles.navCta}`} type="button" onClick={onStart} disabled={!isInteractive}>
          Start designing
        </button>
      </header>

      <section className={`guest-landing-hero ${heroStyles.hero}`} aria-labelledby="guest-landing-heading">
        <HeroHorizon />
        <div className={heroStyles.featureBadge}>
          <span>New</span>
          AI artwork editing
        </div>
        <h1 id="guest-landing-heading">
          <span className={heroStyles.titleLine}>AI-generated artwork?</span>
          <span className={heroStyles.titleLine}>Turn it into editable flat design.</span>
        </h1>
        <p className="guest-landing-description">
          Extract flat artwork from jersey mockups. Refine the details. Export editable SVG and high-resolution PNG files.
        </p>
        <div className="guest-landing-actions">
          <button className="guest-landing-primary" type="button" onClick={onStart} disabled={!isInteractive}>
            Start designing
          </button>
          <a className={heroStyles.tutorialLink} href="#hero-product-demo"><Play size={15} aria-hidden="true" /> Watch how it works</a>
        </div>
        {/* Reserve this row while stats load so the background stays anchored. */}
        <div className={`guest-landing-community${hasCommunityProof ? "" : ` ${heroStyles.communityPending}`}`}
          aria-hidden={!hasCommunityProof}
          aria-label={totalUsers > 0 ? `Trusted by ${totalUsers.toLocaleString()} DesaynClaw creatives` : "Real DesaynClaw community members"}>
          {avatars.length > 0 && (
            <div className="guest-landing-avatars" aria-label="Recent DesaynClaw members">
              {avatars.map((avatarUrl, index) => (
                <img key={avatarUrl} src={avatarUrl} alt="" loading="lazy" referrerPolicy="no-referrer" style={{ zIndex: avatars.length - index }} />
              ))}
            </div>
          )}
          <div className="guest-landing-community-copy">
            <strong>{totalUsers > 0 ? `Trusted by ${totalUsers.toLocaleString()} creatives` : "Real DesaynClaw creatives"}</strong>
            {reviewCount > 0 && (
              <span className="guest-landing-review-summary">
                <span className="guest-landing-review-stars" aria-label="5 out of 5 stars">
                  {Array.from({ length: 5 }).map((_, index) => (
                    <Star key={index} size={11} fill="currentColor" aria-hidden="true" />
                  ))}
                </span>
                <span>{reviewCount.toLocaleString()} project reviews</span>
              </span>
            )}
          </div>
        </div>
      </section>

      <div className={heroStyles.trust}><HomeTrustMarquee guest /></div>
      <div className={heroStyles.demo} id="hero-product-demo"><GuestDemoMonitor /></div>
    </div>
  );
}
