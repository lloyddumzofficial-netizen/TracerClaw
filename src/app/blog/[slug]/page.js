import Link from "next/link";
import { notFound } from "next/navigation";
import SeoShell, { PrimaryCta, styles } from "@/components/seo/SeoShell";
import { blogPosts, getBlogPost } from "@/lib/seo/blogPosts";
import { getRelatedProgrammaticPages } from "@/lib/seo/internalLinks";
import { siteName, siteUrl } from "@/lib/siteMetadata";
import { absoluteUrl, articleJsonLd, breadcrumbJsonLd } from "@/lib/seo/schema";

export const dynamicParams = false;

export function generateStaticParams() {
  return blogPosts.map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const post = getBlogPost(slug);
  if (!post) return {};

  return {
    title: post.title,
    description: post.description,
    alternates: {
      canonical: absoluteUrl(`/blog/${post.slug}`),
    },
    openGraph: {
      type: "article",
      url: absoluteUrl(`/blog/${post.slug}`),
      siteName,
      title: post.title,
      description: post.description,
      publishedTime: post.publishedAt,
      modifiedTime: post.updatedAt,
      tags: post.tags,
      images: [post.image || "/DESAYNCLAW-Image.JPG"],
    },
    twitter: {
      card: "summary_large_image",
      title: post.title,
      description: post.description,
      images: [post.image || "/DESAYNCLAW-Image.JPG"],
    },
  };
}

export default async function BlogPostPage({ params }) {
  const { slug } = await params;
  const post = getBlogPost(slug);
  if (!post) notFound();

  const relatedTools = getRelatedProgrammaticPages(post.relatedSlugs);
  const jsonLd = [
    articleJsonLd(post),
    breadcrumbJsonLd([
      { name: "Home", url: siteUrl },
      { name: "Blog", url: "/blog" },
      { name: post.title, url: `/blog/${post.slug}` },
    ]),
  ];

  return (
    <SeoShell jsonLd={jsonLd} pageType="blog_post" slug={post.slug} title={post.title}>
      <p style={styles.eyebrow}>{post.category.replace("-", " ")}</p>
      <h1 style={styles.h1}>{post.title}</h1>
      <p style={styles.lead}>{post.summary}</p>
      <div style={styles.actions}>
        <PrimaryCta properties={{ page_type: "blog_post", slug: post.slug, cta: "article" }}>
          Try the workflow
        </PrimaryCta>
        <Link href="/blog" style={styles.secondary}>All guides</Link>
      </div>

      <article>
        {post.sections.map((section) => (
          <section key={section.heading}>
            <h2 style={styles.h2}>{section.heading}</h2>
            <p style={styles.text}>{section.body}</p>
          </section>
        ))}
      </article>

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
