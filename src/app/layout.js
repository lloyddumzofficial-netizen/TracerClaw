import { Outfit } from "next/font/google";
import { ToastContainer } from "@/components/Toast";
import MobileWarning from "./components/MobileWarning";
import CookieConsent from "./components/CookieConsent";
import AnalyticsProvider from "@/components/AnalyticsProvider";
import {
  defaultDescription,
  openGraphImage,
  organizationJsonLd,
  siteName,
  siteUrl,
  softwareApplicationJsonLd,
  websiteJsonLd,
} from "@/lib/siteMetadata";
import "./globals.css";

const outfit = Outfit({ subsets: ["latin"], display: "swap" });

export const metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "DesaynClaw | AI Sublimation Design Extractor & Vector Tracer",
    template: "%s | DesaynClaw",
  },
  description: defaultDescription,
  keywords: [
    // Core product features
    "sublimation design extractor",
    "jersey flat extract",
    "flat sublimation file",
    "jersey design to flat file",
    "ai jersey tracer",
    "auto trace jersey",
    "sublimation print file",
    "jersey mockup to flat",
    "extract jersey design",
    // Vector tracing
    "vector auto tracer",
    "ai vector tracer",
    "image to vector",
    "svg converter",
    "png to svg",
    "jpg to svg",
    "ai svg converter",
    "vector tracing online",
    "raster to vector",
    "auto vectorizer",
    // Logo tools
    "logo enhancer",
    "ai logo enhancer",
    "logo upscaler",
    "logo vectorizer",
    "logo to svg",
    "logo cleanup ai",
    "low res logo fix",
    "logo extract",
    // Background removal
    "background remover",
    "remove background ai",
    "transparent background",
    "bg remover online",
    "ai background eraser",
    "remove bg sublimation",
    // Upscaling
    "image upscaler",
    "4k upscale",
    "ai upscale image",
    "upscale jersey design",
    "hd upscale online",
    // Philippines market
    "sublimation philippines",
    "jersey design philippines",
    "print shop tools philippines",
    "dtf printing philippines",
    "sublimation shop tools",
    "jersey mockup extractor",
    // Design / apparel niche
    "apparel design tool",
    "sports jersey design",
    "uniform design extractor",
    "school uniform design",
    "barangay jersey design",
    "basketball jersey flat file",
    "volleyball jersey design",
    "sublimation tshirt design",
    "tshirt design extractor",
    "polo shirt flat design",
    // Brand
    "desaynclaw",
    "desayn claw",
    "desaynbro",
  ],
  authors: [{ name: "desaynbro", url: siteUrl }],
  creator: "desaynbro",
  publisher: siteName,
  category: "Design Tools",
  applicationName: siteName,
  alternates: {
    canonical: siteUrl,
  },
  openGraph: {
    type: "website",
    locale: "en_PH",
    url: siteUrl,
    title: "DesaynClaw | AI Sublimation Design Extractor & Vector Tracer",
    description:
      "Extract flat sublimation print files from jersey mockups, convert logos to crisp SVG vectors, remove backgrounds, and upscale designs to 4K — all powered by AI. Built for print shops and apparel designers.",
    siteName,
    images: [
      {
        url: openGraphImage,
        width: 1200,
        height: 630,
        alt: "DesaynClaw AI Sublimation Design Extractor and Vector Tracer",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "DesaynClaw | AI Sublimation Design Extractor & Vector Tracer",
    description:
      "Extract sublimation flat files, vectorize logos, remove backgrounds & upscale designs using AI. Perfect for print shops in the Philippines.",
    images: [openGraphImage],
    creator: "@desaynbro",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  verification: {
    google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION || undefined,
  },
};

import MaintenanceScreen from "./components/MaintenanceScreen";
import GlobalMobileSync from "@/components/GlobalMobileSync";

const isMaintenance = process.env.NEXT_PUBLIC_MAINTENANCE_MODE === 'true'; // Emergency maintenance mode

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        {/* JSON-LD Structured Data — SoftwareApplication */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(softwareApplicationJsonLd),
          }}
        />
        {/* JSON-LD — WebSite with SearchAction for sitelinks searchbox */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(websiteJsonLd),
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(organizationJsonLd),
          }}
        />
      </head>
      <body className={outfit.className}>
        <AnalyticsProvider />
        {isMaintenance ? (
          <MaintenanceScreen />
        ) : (
          <>
            <MobileWarning />
            <GlobalMobileSync />
            {children}
          </>
        )}
        <CookieConsent />
        <ToastContainer />
      </body>
    </html>
  );
}
