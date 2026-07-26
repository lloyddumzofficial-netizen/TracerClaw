import { siteUrl } from "@/lib/siteMetadata";

export default function robots() {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/admin', '/api/', '/workspace/'],
    },
    sitemap: `${siteUrl}/sitemap.xml`,
  }
}
