"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { ArrowLeftRight, ArrowUpRight, Star } from "lucide-react";
import BeforeAfterSlider from "@/components/marketing/BeforeAfterSlider";
import GuestDemoMonitor from "@/components/marketing/GuestDemoMonitor";
import GuestPricingSection from "@/components/marketing/GuestPricingSection";
import HomeTrustMarquee from "@/components/marketing/HomeTrustMarquee";

const SAMPLE_ASSET_ROOT =
  "https://pub-f2ce547db5ec43259557b815b0c02ae8.r2.dev/sample_outputs/Desaynclaw_samples-Front%26Back";

const HOMEPAGE_COMPARISONS = [
  {
    id: "front",
    number: "01",
    title: "Front artwork",
    meta: "Garment view",
    originalUrl: `${SAMPLE_ASSET_ROOT}/FRONT/ORIGINAL_FRONT.png`,
    extractedUrl: `${SAMPLE_ASSET_ROOT}/FRONT/EXTRACTED_FRONT.png`,
  },
  {
    id: "back",
    number: "02",
    title: "Back artwork",
    meta: "Garment view",
    originalUrl: `${SAMPLE_ASSET_ROOT}/BACK/BACK_ORIGINAL.png`,
    extractedUrl: `${SAMPLE_ASSET_ROOT}/BACK/BACK_EXTRACETED.png`,
  },
];

export function GuestHomepageSampleSection() {
  return (
    <div className="guest-landing guest-landing-lower guest-landing-sample">
      <section className="guest-landing-example" id="preview" aria-label="Original artwork and extracted output comparison">
        <div className="guest-landing-example-copy">
          <div className="guest-landing-example-kicker">
            <span>PRODUCTION PROOF</span>
            <small>FRONT / BACK COMPARISON</small>
          </div>
          <h2>The difference is in <em>the details.</em></h2>
          <p>Compare the source garment with the clean extracted artwork. Drag either divider to inspect the result edge by edge.</p>
        </div>
        <div className="guest-landing-example-grid">
          {HOMEPAGE_COMPARISONS.map((comparison) => (
            <article className="guest-landing-example-card" key={comparison.id}>
              <div className="guest-landing-example-card-heading">
                <div className="guest-landing-example-card-title">
                  <span>{comparison.number}</span>
                  <div>
                    <strong>{comparison.title}</strong>
                    <small>{comparison.meta}</small>
                  </div>
                </div>
                <span className="guest-landing-example-drag"><ArrowLeftRight size={13} aria-hidden="true" /> Drag divider</span>
              </div>
              <div className="guest-landing-example-slider">
                <BeforeAfterSlider
                  rasterUrl={comparison.originalUrl}
                  vectorUrl={comparison.extractedUrl}
                  rasterAlt={`Original garment ${comparison.id} view`}
                  vectorAlt={`Extracted artwork ${comparison.id} view`}
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
          <a href="#process">How it works</a>
          <a href="#tools">Tools</a>
          <a href="#preview">Samples</a>
          <a href="#pricing">Pricing</a>
        </nav>

        <button className="guest-landing-nav-cta" type="button" onClick={onStart} disabled={!isInteractive}>
          Start designing <ArrowUpRight size={17} aria-hidden="true" />
        </button>
      </header>

      <section className="guest-landing-hero" aria-labelledby="guest-landing-heading">
        <h1 id="guest-landing-heading"><span className="guest-landing-title-mark">AI-generated<span className="guest-landing-title-handles" aria-hidden="true" /></span><span className="guest-landing-title-question"> artwork?</span><br /><em>Turn it into <span className="guest-landing-output-mark">editable flat design</span>.</em></h1>
        <p className="guest-landing-description">
          Extract artwork from garments and logos, refine the details, and deliver clean files your production team can actually use.
        </p>
        <div className="guest-landing-actions">
          <button className="guest-landing-primary" type="button" onClick={onStart} disabled={!isInteractive}>
            Start designing <span><ArrowUpRight size={18} aria-hidden="true" /></span>
          </button>
          <a className="guest-landing-secondary" href="#preview">See a real example <ArrowUpRight size={15} aria-hidden="true" /></a>
        </div>
        <p className="guest-landing-access-note">Free account required to save your work.</p>
        {hasCommunityProof && (
          <div className="guest-landing-community" aria-label={totalUsers > 0 ? `Trusted by ${totalUsers.toLocaleString()} DesaynClaw creatives` : "Real DesaynClaw community members"}>
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
        )}
      </section>

      <HomeTrustMarquee guest />

      <GuestDemoMonitor />
    </div>
  );
}
