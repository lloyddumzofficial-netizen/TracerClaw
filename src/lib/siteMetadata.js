export const siteUrl = (
  process.env.NEXT_PUBLIC_SITE_URL || "https://desaynclaw.com"
).replace(/\/$/, "");

export const siteName = "DesaynClaw";

export const defaultDescription =
  "DesaynClaw is the #1 AI-powered tool for sublimation jersey design extraction, vector auto-tracing, logo enhancement, background removal, and 4K upscaling. Convert jersey mockups to flat print-ready SVG files instantly. Trusted by print shops and apparel designers in the Philippines and worldwide.";

export const openGraphImage = "/DESAYNCLAW-Image.JPG";

export const softwareApplicationJsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: siteName,
  url: siteUrl,
  image: `${siteUrl}${openGraphImage}`,
  applicationCategory: "DesignApplication",
  applicationSubCategory: "AI image vectorizer and sublimation design tool",
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
  publisher: {
    "@type": "Organization",
    name: siteName,
    url: siteUrl,
    logo: `${siteUrl}/logo.png`,
  },
};

export const webApplicationJsonLd = {
  ...softwareApplicationJsonLd,
  "@type": "WebApplication",
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
  image: `${siteUrl}${openGraphImage}`,
  sameAs: [siteUrl],
};

export const rootJsonLdGraph = {
  "@context": "https://schema.org",
  "@graph": [
    { ...softwareApplicationJsonLd, "@context": undefined },
    { ...webApplicationJsonLd, "@context": undefined },
    { ...organizationJsonLd, "@context": undefined },
    { ...websiteJsonLd, "@context": undefined },
  ],
};
