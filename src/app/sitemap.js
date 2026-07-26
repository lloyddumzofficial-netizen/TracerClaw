import { siteUrl } from "@/lib/siteMetadata";

export default function sitemap() {
  const now = new Date();

  return [
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
  ];
}
