"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { ArrowUpRight, Star } from "lucide-react";
import BeforeAfterSlider from "@/components/marketing/BeforeAfterSlider";
import GuestDemoMonitor from "@/components/marketing/GuestDemoMonitor";
import GuestPricingSection from "@/components/marketing/GuestPricingSection";
import HomeTrustMarquee from "@/components/marketing/HomeTrustMarquee";
import { GARMENT_SAMPLES } from "@/lib/garmentSamples";
import heroStyles from "./GuestHomepageHero.module.css";
import HeroHorizon from "./HeroHorizon";

export function GuestHomepageSampleSection() {
  return (
    <div className="guest-landing guest-landing-lower guest-landing-sample">
      <section className={`guest-landing-example ${heroStyles.sampleSection}`} id="preview" aria-label="Original artwork and extracted output comparison">
        <div className={`guest-landing-example-copy ${heroStyles.sampleHeader}`}>
          <p className={heroStyles.sampleEyebrow}>Garment samples</p>
          <h2>From mockup to flat artwork.</h2>
        </div>
        <div className="guest-landing-proof-board">
          <div className={`guest-landing-example-grid ${heroStyles.sampleGrid}`}>
            {GARMENT_SAMPLES.map((comparison) => (
              <article className="guest-landing-example-card" key={comparison.id} aria-label={comparison.title}>
                <div className="guest-landing-example-slider">
                  <BeforeAfterSlider
                    rasterUrl={comparison.originalUrl}
                    vectorUrl={comparison.extractedUrl}
                    rasterAlt={comparison.originalAlt}
                    vectorAlt={comparison.extractedAlt}
                    height="540px"
                    objectFit="contain"
                    objectPosition="center"
                    leftLabel="EXTRACTED"
                    rightLabel="ORIGINAL"
                    description=""
                  />
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

    </div>
  );
}

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

        <nav className="guest-landing-links" aria-label="Explore DesaynClaw">
          <a className="is-current" href="#start">Home</a>
          <a href="#how-desaynclaw-works">How DesaynClaw works</a>
          <a href="#workspace-tools">Tools</a>
          <a href="#preview">Samples</a>
          <a href="#pricing">Pricing</a>
        </nav>

        <button className="guest-landing-nav-cta" type="button" onClick={onStart} disabled={!isInteractive}>
          Start designing <ArrowUpRight size={17} aria-hidden="true" />
        </button>
      </header>

      <section className={`guest-landing-hero ${heroStyles.hero}`} aria-labelledby="guest-landing-heading">
        <HeroHorizon />
        <h1 id="guest-landing-heading"><span className="guest-landing-title-mark">AI-generated<span className="guest-landing-title-handles" aria-hidden="true" /></span><span className="guest-landing-title-question"> artwork?</span><br /><em>Turn it into <span className="guest-landing-output-mark">editable flat design</span>.</em></h1>
        <p className="guest-landing-description">
          Extract artwork from garments and logos, refine the details, and deliver clean files your production team can actually use.
        </p>
        <div className="guest-landing-actions">
          <button className="guest-landing-primary" type="button" onClick={onStart} disabled={!isInteractive}>
            Start designing <span><ArrowUpRight size={18} aria-hidden="true" /></span>
          </button>
          <a className="guest-landing-secondary" href="#hero-product-demo">See a real example <ArrowUpRight size={15} aria-hidden="true" /></a>
        </div>
          {/* Reserve the proof row during SSR and loading: the horizon is
              bottom-anchored and must not move when live stats arrive. */}
          <div className={`guest-landing-community${hasCommunityProof ? "" : ` ${heroStyles.communityPending}`}`}
            aria-hidden={!hasCommunityProof}
            aria-label={totalUsers > 0 ? `Trusted by ${totalUsers.toLocaleString()} DesaynClaw creatives` : "Real DesaynClaw community members"}>
            {avatars.length > 0 && (
              <div className="guest-landing-avatars" aria-label="Recent DesaynClaw members">
                {avatars.map((avatarUrl, index) => (
                  // These URLs come from the public-stats endpoint and may use different OAuth hosts.
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
