export default function robots() {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/admin', '/api/', '/workspace/', '/mobile'],
    },
    sitemap: 'https://desaynclaw.com/sitemap.xml',
  }
}
