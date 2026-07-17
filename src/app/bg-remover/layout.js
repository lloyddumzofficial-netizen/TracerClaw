// Metadata layout wrapper for the BG Remover page.
// The page.js itself is "use client" so metadata lives here.
export const metadata = {
  title: "AI Background Remover | Remove BG from Designs & Logos Free",
  description:
    "Remove backgrounds from sublimation designs, jersey mockups, logos, and photos instantly using AI. Get a clean transparent PNG in seconds — no Photoshop needed. Perfect for print shop designers.",
  keywords: [
    "background remover",
    "remove background ai",
    "remove bg free",
    "transparent background maker",
    "ai background eraser",
    "remove bg sublimation",
    "jersey background remover",
    "logo background remover",
    "png background removal",
    "cutout image online",
    "transparent png maker",
    "remove white background",
    "remove bg shirt design",
    "background eraser online",
    "ai cutout tool",
    "sublimation design cutout",
    "desaynclaw bg remover",
  ],
  alternates: {
    canonical: "https://desaynclaw.com/bg-remover",
  },
  openGraph: {
    title: "AI Background Remover — Free Transparent PNG | DesaynClaw",
    description:
      "Remove backgrounds from jersey designs, logos, and photos using AI. Get a clean transparent PNG instantly — no Photoshop needed.",
    url: "https://desaynclaw.com/bg-remover",
    images: [
      {
        url: "/DESAYNCLAW-Image.JPG",
        width: 1230,
        height: 807,
        alt: "DesaynClaw AI Background Remover",
      },
    ],
  },
  twitter: {
    title: "AI Background Remover | DesaynClaw",
    description:
      "Remove backgrounds from sublimation designs and logos in one click. Free to try.",
    images: ["/DESAYNCLAW-Image.JPG"],
  },
};

export default function BgRemoverLayout({ children }) {
  return children;
}
