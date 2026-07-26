import { siteUrl } from "@/lib/siteMetadata";

export default function robots() {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/admin', '/api/', '/workspace/', '/mobile', '/sentry-test', '/bg-remover/*'],
    },
    sitemap: `${siteUrl}/sitemap.xml`,
  }
}
