export const siteUrl = (
  process.env.NEXT_PUBLIC_SITE_URL || "https://desaynclaw.com"
).replace(/\/$/, "");

export const siteName = "DesaynClaw";

export const defaultDescription =
  "DesaynClaw is the #1 AI-powered tool for sublimation jersey design extraction, vector auto-tracing, logo enhancement, background removal, and 4K upscaling. Convert jersey mockups to flat print-ready SVG files instantly. Trusted by print shops and apparel designers in the Philippines and worldwide.";

export const openGraphImage = "/a-clean--minimal-social-media-promotional-banner-f-01.jpg";

export const softwareApplicationJsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: siteName,
  url: siteUrl,
  applicationCategory: "DesignApplication",
  operatingSystem: "Web",
  description:
    "AI-powered tool for sublimation jersey design extraction, vector auto-tracing, logo enhancement, background removal, and 4K image upscaling. Used by print shops and apparel designers.",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "PHP",
    description: "Free credits on sign up. Pay-per-use credit system.",
  },
  featureList: [
    "Sublimation jersey flat file extraction",
    "AI vector auto-tracer (SVG output)",
    "Logo enhancer and vectorizer",
    "AI background remover",
    "4K AI image upscaler",
    "Flat sublimation print file export",
  ],
  creator: {
    "@type": "Person",
    name: "desaynbro",
    url: siteUrl,
  },
};

export const websiteJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: siteName,
  url: siteUrl,
  potentialAction: {
    "@type": "SearchAction",
    target: {
      "@type": "EntryPoint",
      urlTemplate: `${siteUrl}/?q={search_term_string}`,
    },
    "query-input": "required name=search_term_string",
  },
};

export const organizationJsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: siteName,
  url: siteUrl,
  logo: `${siteUrl}/logo.png`,
  sameAs: ["https://desaynclaw.com"],
};
