import Link from "next/link";
import { notFound } from "next/navigation";
import SeoShell, { PrimaryCta, styles } from "@/components/seo/SeoShell";
import { galleryExamples, getGalleryExample } from "@/lib/seo/galleryExamples";
import { getRelatedProgrammaticPages } from "@/lib/seo/internalLinks";
import { siteName, siteUrl } from "@/lib/siteMetadata";
import { absoluteUrl, breadcrumbJsonLd, imageExampleJsonLd } from "@/lib/seo/schema";

export const dynamicParams = false;

export function generateStaticParams() {
  return galleryExamples.map((example) => ({ slug: example.slug }));
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const example = getGalleryExample(slug);
  if (!example) return {};

  return {
    title: example.title,
    description: example.description,
    alternates: {
      canonical: absoluteUrl(`/gallery/${example.slug}`),
    },
    openGraph: {
      type: "article",
      url: absoluteUrl(`/gallery/${example.slug}`),
      siteName,
      title: example.title,
      description: example.description,
      images: [
        {
          url: example.afterImage,
          alt: `${example.title} after conversion`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: example.title,
      description: example.description,
      images: [example.afterImage],
    },
  };
}

export default async function GalleryExamplePage({ params }) {
  const { slug } = await params;
  const example = getGalleryExample(slug);
  if (!example) notFound();

  const relatedTools = getRelatedProgrammaticPages(example.relatedSlugs);
  const jsonLd = [
    imageExampleJsonLd(example),
    breadcrumbJsonLd([
      { name: "Home", url: siteUrl },
      { name: "Gallery", url: "/gallery" },
      { name: example.title, url: `/gallery/${example.slug}` },
    ]),
  ];

  return (
    <SeoShell jsonLd={jsonLd} pageType="gallery_example" slug={example.slug} title={example.title}>
      <p style={styles.eyebrow}>{example.category}</p>
      <h1 style={styles.h1}>{example.title}</h1>
      <p style={styles.lead}>{example.description}</p>
      <div style={styles.actions}>
        <PrimaryCta properties={{ page_type: "gallery_example", slug: example.slug, cta: "example" }}>
          Convert your artwork
        </PrimaryCta>
        <Link href="/gallery" style={styles.secondary}>All examples</Link>
      </div>

      <section aria-labelledby="before-after">
        <h2 id="before-after" style={styles.h2}>Before and after</h2>
        <div style={styles.grid}>
          <figure style={styles.card}>
            <img src={example.beforeImage} alt={`${example.title} before conversion`} loading="lazy" style={styles.media} />
            <figcaption style={{ ...styles.text, marginTop: "12px" }}>Before</figcaption>
          </figure>
          <figure style={styles.card}>
            <img src={example.afterImage} alt={`${example.title} after conversion`} loading="lazy" style={styles.media} />
            <figcaption style={{ ...styles.text, marginTop: "12px" }}>After</figcaption>
          </figure>
        </div>
      </section>

      <section aria-labelledby="metadata">
        <h2 id="metadata" style={styles.h2}>Example metadata</h2>
        <div style={styles.grid}>
          <article style={styles.card}>
            <h3 style={styles.h3}>Category</h3>
            <p style={styles.text}>{example.category}</p>
          </article>
          <article style={styles.card}>
            <h3 style={styles.h3}>Tags</h3>
            <p style={styles.text}>{example.tags.join(", ")}</p>
          </article>
        </div>
      </section>

      <section aria-labelledby="related-tools">
        <h2 id="related-tools" style={styles.h2}>Related tools</h2>
        <div style={styles.grid}>
          {relatedTools.map((tool) => (
            <Link key={tool.slug} href={`/${tool.slug}`} style={{ ...styles.card, textDecoration: "none" }}>
              <h3 style={styles.h3}>{tool.title}</h3>
              <p style={styles.text}>{tool.description}</p>
            </Link>
          ))}
        </div>
      </section>
    </SeoShell>
  );
}
