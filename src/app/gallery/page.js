import Link from "next/link";
import SeoShell, { styles } from "@/components/seo/SeoShell";
import { galleryExamples } from "@/lib/seo/galleryExamples";
import { siteName, siteUrl } from "@/lib/siteMetadata";
import { absoluteUrl, breadcrumbJsonLd } from "@/lib/seo/schema";

export const metadata = {
  title: "AI Conversion Examples Gallery",
  description: "Before and after examples of AI logo cleanup, background removal, image enhancement, and SVG-ready artwork preparation.",
  alternates: {
    canonical: absoluteUrl("/gallery"),
  },
  openGraph: {
    type: "website",
    url: absoluteUrl("/gallery"),
    siteName,
    title: "AI Conversion Examples Gallery | DesaynClaw",
    description: "Before and after examples of AI logo cleanup, background removal, image enhancement, and SVG-ready artwork preparation.",
    images: ["/DESAYNCLAW-Image.JPG"],
  },
};

export default function GalleryIndexPage() {
  return (
    <SeoShell
      jsonLd={[breadcrumbJsonLd([{ name: "Home", url: siteUrl }, { name: "Gallery", url: "/gallery" }])]}
      pageType="gallery_index"
      slug="gallery"
      title="AI Conversion Examples Gallery"
    >
      <p style={styles.eyebrow}>Before and after</p>
      <h1 style={styles.h1}>AI conversion examples</h1>
      <p style={styles.lead}>
        Searchable examples showing how DesaynClaw helps clean, enhance, isolate,
        and prepare artwork for print and SVG workflows.
      </p>
      <div style={styles.grid}>
        {galleryExamples.map((example) => (
          <Link key={example.slug} href={`/gallery/${example.slug}`} style={{ ...styles.card, textDecoration: "none" }}>
            <img src={example.afterImage} alt={`${example.title} after conversion`} loading="lazy" style={styles.media} />
            <p style={{ ...styles.eyebrow, marginTop: "16px" }}>{example.category}</p>
            <h2 style={{ ...styles.h3, marginTop: 0 }}>{example.title}</h2>
            <p style={styles.text}>{example.description}</p>
          </Link>
        ))}
      </div>
    </SeoShell>
  );
}
