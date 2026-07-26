// Metadata layout wrapper for the Upscale tool page.
// The page.js itself is "use client" so metadata lives here.
export const metadata = {
  title: "AI Image Upscaler | 4K Upscale Photos & Designs",
  description:
    "Upscale your jersey designs, logos, and photos to 4K resolution using AI. Perfect for sublimation print shops that need high-resolution artwork from low-quality source images. Free to try — no watermarks.",
  keywords: [
    "ai image upscaler",
    "4k image upscale",
    "upscale jersey design",
    "upscale sublimation design",
    "hd upscale online",
    "upscale low res image",
    "ai upscale photo",
    "upscale logo",
    "image enhancer ai",
    "super resolution online",
    "upscale png",
    "upscale jpg",
    "print ready image upscaler",
    "sublimation upscale tool",
    "desaynclaw upscaler",
  ],
  alternates: {
    canonical: "https://desaynclaw.com/upscale",
  },
  openGraph: {
    title: "AI 4K Image Upscaler | DesaynClaw",
    description:
      "Upscale any jersey design, logo, or photo to 4K using AI. Ideal for sublimation and DTF print shops needing high-res artwork.",
    url: "https://desaynclaw.com/upscale",
    images: [
      {
        url: "/DESAYNCLAW-Image.JPG",
        width: 1230,
        height: 807,
        alt: "DesaynClaw AI 4K Image Upscaler",
      },
    ],
  },
  twitter: {
    title: "AI 4K Image Upscaler | DesaynClaw",
    description:
      "Upscale low-res jersey designs and logos to 4K quality using AI. Built for sublimation print shops.",
    images: ["/DESAYNCLAW-Image.JPG"],
  },
};

export default function UpscaleLayout({ children }) {
  return children;
}
