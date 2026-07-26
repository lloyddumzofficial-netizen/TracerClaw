import Link from "next/link";
import { notFound } from "next/navigation";
import SeoShell, { PrimaryCta, styles } from "@/components/seo/SeoShell";
import { siteName, siteUrl } from "@/lib/siteMetadata";
import { getRelatedBlogPosts, getRelatedGalleryExamples, getRelatedProgrammaticPages } from "@/lib/seo/internalLinks";
import { getProgrammaticPage, programmaticPages } from "@/lib/seo/programmaticPages";
import { absoluteUrl, breadcrumbJsonLd, faqJsonLd, webApplicationJsonLd } from "@/lib/seo/schema";

export const dynamicParams = false;

export function generateStaticParams() {
  return programmaticPages.map((page) => ({ slug: page.slug }));
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const page = getProgrammaticPage(slug);
  if (!page) return {};

  const url = absoluteUrl(`/${page.slug}`);
  return {
    title: page.title,
    description: page.description,
    alternates: {
      canonical: url,
      languages: {
        "en": url,
        "x-default": url,
      },
    },
    openGraph: {
      type: "website",
      url,
      siteName,
      title: `${page.title} | ${siteName}`,
      description: page.description,
      images: [
        {
          url: "/DESAYNCLAW-Image.JPG",
          width: 1230,
          height: 807,
          alt: `${page.title} by ${siteName}`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: `${page.title} | ${siteName}`,
      description: page.description,
      images: ["/DESAYNCLAW-Image.JPG"],
    },
  };
}

export default async function ProgrammaticSeoPage({ params }) {
  const { slug } = await params;
  const page = getProgrammaticPage(slug);
  if (!page) notFound();

  const relatedTools = getRelatedProgrammaticPages(page.relatedSlugs);
  const relatedPosts = getRelatedBlogPosts(page.relatedSlugs);
  const relatedExamples = getRelatedGalleryExamples(page.relatedSlugs);
  const jsonLd = [
    webApplicationJsonLd(page),
    breadcrumbJsonLd([
      { name: "Home", url: siteUrl },
      { name: page.title, url: `/${page.slug}` },
    ]),
    faqJsonLd(page.faqs),
  ].filter(Boolean);

  return (
    <SeoShell jsonLd={jsonLd} pageType="programmatic_landing" slug={page.slug} title={page.title}>
      <p style={styles.eyebrow}>AI production tool</p>
      <h1 style={styles.h1}>{page.title}</h1>
      <p style={styles.lead}>{page.description}</p>
      <div style={styles.actions}>
        <PrimaryCta properties={{ page_type: "programmatic_landing", slug: page.slug, cta: "hero" }}>
          Start free
        </PrimaryCta>
        <Link href="/gallery" style={styles.secondary}>View examples</Link>
      </div>

      <section aria-labelledby="use-case">
        <h2 id="use-case" style={styles.h2}>Built for real production work</h2>
        <div style={styles.grid}>
          <article style={styles.card}>
            <h3 style={styles.h3}>Best for</h3>
            <p style={styles.text}>{page.audience}.</p>
          </article>
          <article style={styles.card}>
            <h3 style={styles.h3}>Search intent</h3>
            <p style={styles.text}>{page.intent}</p>
          </article>
          <article style={styles.card}>
            <h3 style={styles.h3}>Primary workflow</h3>
            <p style={styles.text}>{page.primaryUseCase}</p>
          </article>
        </div>
      </section>

      <section aria-labelledby="features">
        <h2 id="features" style={styles.h2}>What the workflow supports</h2>
        <ul style={styles.list}>
          {page.features.map((feature) => (
            <li key={feature}>{feature}</li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="faq">
        <h2 id="faq" style={styles.h2}>Common questions</h2>
        <div style={styles.grid}>
          {page.faqs.map((faq) => (
            <article key={faq.question} style={styles.card}>
              <h3 style={styles.h3}>{faq.question}</h3>
              <p style={styles.text}>{faq.answer}</p>
            </article>
          ))}
        </div>
      </section>

      <section aria-labelledby="related">
        <h2 id="related" style={styles.h2}>Related resources</h2>
        <div style={styles.grid}>
          {relatedTools.map((related) => (
            <Link key={related.slug} href={`/${related.slug}`} style={{ ...styles.card, textDecoration: "none" }}>
              <h3 style={styles.h3}>{related.title}</h3>
              <p style={styles.text}>{related.description}</p>
            </Link>
          ))}
          {relatedPosts.map((post) => (
            <Link key={post.slug} href={`/blog/${post.slug}`} style={{ ...styles.card, textDecoration: "none" }}>
              <h3 style={styles.h3}>{post.title}</h3>
              <p style={styles.text}>{post.description}</p>
            </Link>
          ))}
          {relatedExamples.map((example) => (
            <Link key={example.slug} href={`/gallery/${example.slug}`} style={{ ...styles.card, textDecoration: "none" }}>
              <h3 style={styles.h3}>{example.title}</h3>
              <p style={styles.text}>{example.description}</p>
            </Link>
          ))}
        </div>
      </section>
    </SeoShell>
  );
}
