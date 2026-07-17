import { Outfit } from "next/font/google";
import { ToastContainer } from "@/components/Toast";
import MobileWarning from "./components/MobileWarning";
import CookieConsent from "./components/CookieConsent";
import "./globals.css";

const outfit = Outfit({ subsets: ["latin"], display: "swap" });

export const metadata = {
  metadataBase: new URL("https://desaynclaw.com"),
  title: {
    default: "DesaynClaw | AI Sublimation Design Extractor & Vector Tracer",
    template: "%s | DesaynClaw",
  },
  description:
    "DesaynClaw is the #1 AI-powered tool for sublimation jersey design extraction, vector auto-tracing, logo enhancement, background removal, and 4K upscaling. Convert jersey mockups to flat print-ready SVG files instantly. Trusted by print shops and apparel designers in the Philippines and worldwide.",
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
  authors: [{ name: "desaynbro", url: "https://desaynclaw.com" }],
  creator: "desaynbro",
  publisher: "DesaynClaw",
  category: "Design Tools",
  applicationName: "DesaynClaw",
  alternates: {
    canonical: "https://desaynclaw.com",
  },
  openGraph: {
    type: "website",
    locale: "en_PH",
    url: "https://desaynclaw.com",
    title: "DesaynClaw | AI Sublimation Design Extractor & Vector Tracer",
    description:
      "Extract flat sublimation print files from jersey mockups, convert logos to crisp SVG vectors, remove backgrounds, and upscale designs to 4K — all powered by AI. Built for print shops and apparel designers.",
    siteName: "DesaynClaw",
    images: [
      {
        url: "/DESAYNCLAW-Image.JPG",
        width: 1230,
        height: 807,
        alt: "DesaynClaw AI Sublimation Design Extractor and Vector Tracer",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "DesaynClaw | AI Sublimation Design Extractor & Vector Tracer",
    description:
      "Extract sublimation flat files, vectorize logos, remove backgrounds & upscale designs using AI. Perfect for print shops in the Philippines.",
    images: ["/DESAYNCLAW-Image.JPG"],
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
    // Add your Google Search Console verification token here when ready:
    // google: "YOUR_GOOGLE_VERIFICATION_TOKEN",
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
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "SoftwareApplication",
              "name": "DesaynClaw",
              "url": "https://desaynclaw.com",
              "image": "https://desaynclaw.com/DESAYNCLAW-Image.JPG",
              "sameAs": [
                "https://desaynclaw.com"
              ],
              "applicationCategory": "DesignApplication",
              "applicationSubCategory": "AI image vectorizer and sublimation design tool",
              "operatingSystem": "Web",
              "description":
                "AI-powered tool for sublimation jersey design extraction, vector auto-tracing, logo enhancement, background removal, and 4K image upscaling. Used by print shops and apparel designers.",
              "offers": {
                "@type": "Offer",
                "price": "0",
                "priceCurrency": "PHP",
                "description": "Free credits on sign up. Pay-per-use credit system.",
              },
              "featureList": [
                "Sublimation jersey flat file extraction",
                "AI vector auto-tracer (SVG output)",
                "Logo enhancer and vectorizer",
                "AI background remover",
                "4K AI image upscaler",
                "Flat sublimation print file export",
              ],
              "creator": {
                "@type": "Person",
                "name": "desaynbro",
                "url": "https://desaynclaw.com",
              },
              "publisher": {
                "@type": "Organization",
                "name": "DesaynClaw",
                "url": "https://desaynclaw.com",
                "logo": "https://desaynclaw.com/logo.png"
              }
            }),
          }}
        />
        {/* JSON-LD — Organization and WebSite */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@graph": [
                {
                  "@type": "Organization",
                  "name": "DesaynClaw",
                  "url": "https://desaynclaw.com",
                  "logo": "https://desaynclaw.com/logo.png",
                  "image": "https://desaynclaw.com/DESAYNCLAW-Image.JPG"
                },
                {
                  "@type": "WebSite",
                  "name": "DesaynClaw",
                  "url": "https://desaynclaw.com",
                  "publisher": {
                    "@type": "Organization",
                    "name": "DesaynClaw"
                  }
                }
              ],
            }),
          }}
        />
      </head>
      <body className={outfit.className}>
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
