import { siteUrl } from "@/lib/siteMetadata";
import { blogPosts } from "@/lib/seo/blogPosts";
import { galleryExamples } from "@/lib/seo/galleryExamples";
import { programmaticPages } from "@/lib/seo/programmaticPages";

export default function sitemap() {
  const now = new Date();

  const coreRoutes = [
    // ─── Core Tool Pages ──────────────────────────────────────────────────────
    {
      url: siteUrl,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 1.0,
    },
    {
      url: `${siteUrl}/upscale`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.9,
    },
    {
      url: `${siteUrl}/bg-remover`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.9,
    },
    {
      url: `${siteUrl}/blog`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.8,
    },
    {
      url: `${siteUrl}/gallery`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.8,
    },
    // ─── Legal & Policy Pages ────────────────────────────────────────────────
    {
      url: `${siteUrl}/terms`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.4,
    },
    {
      url: `${siteUrl}/privacy`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.4,
    },
    {
      url: `${siteUrl}/refunds`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.3,
    },
    {
      url: `${siteUrl}/copyright`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.3,
    },
    {
      url: `${siteUrl}/acceptable-use`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.3,
    },
    {
      url: `${siteUrl}/copyright-takedown`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.3,
    },
  ];

  const programmaticRoutes = programmaticPages.map((page) => ({
    url: `${siteUrl}/${page.slug}`,
    lastModified: now,
    changeFrequency: 'monthly',
    priority: 0.85,
  }));

  const blogRoutes = blogPosts.map((post) => ({
    url: `${siteUrl}/blog/${post.slug}`,
    lastModified: new Date(post.updatedAt || post.publishedAt),
    changeFrequency: 'monthly',
    priority: 0.7,
  }));

  const galleryRoutes = galleryExamples.map((example) => ({
    url: `${siteUrl}/gallery/${example.slug}`,
    lastModified: now,
    changeFrequency: 'monthly',
    priority: 0.7,
    images: [`${siteUrl}${example.beforeImage}`, `${siteUrl}${example.afterImage}`],
  }));

  return [...coreRoutes, ...programmaticRoutes, ...blogRoutes, ...galleryRoutes];
}
