# DesaynClaw SEO and Growth Architecture

## Audit Summary

### Technical SEO

- Metadata exists at the root and tool layouts, with canonical URLs, Open Graph, Twitter cards, Search Console verification, and index/follow robots metadata.
- Root structured data existed inline and duplicated helper data. It now uses a central JSON-LD graph with SoftwareApplication, WebApplication, Organization, WebSite, and SearchAction.
- `/bg-remover` was listed in the sitemap but had no page. It now has an indexable landing page, while `/bg-remover/[id]` project pages are noindexed.
- `robots.js` blocks `/admin`, `/api`, `/workspace`, `/mobile`, `/sentry-test`, and dynamic background-removal project URLs.
- `sitemap.js` is now generated from route registries for core pages, programmatic SEO pages, blog posts, and gallery examples.
- `manifest.js` was missing and is now generated through the Next.js App Router metadata convention.
- Hreflang should not be expanded beyond English until real localized content exists. Programmatic pages include English and `x-default` alternates.
- Most user-facing images have useful alt text. Decorative images use empty alt where appropriate. Future content pages must treat alt text as required data.
- Indexable SEO pages are static server-rendered routes with minimal client JavaScript.

### Programmatic SEO

The programmatic SEO system is data-driven from `src/lib/seo/programmaticPages.js`. Each page has:

- unique slug
- title and description
- audience
- search intent
- primary use case
- feature list
- FAQ entries
- related page slugs

This prevents duplicate content by requiring each page to declare a distinct audience, intent, and workflow. Route generation is handled by `src/app/(seo)/[slug]/page.js` with `generateStaticParams()` and `dynamicParams = false`.

Initial page clusters cover:

- PNG/JPG to SVG
- logo vectorization
- AI vector tracing
- background removal
- image upscaling
- basketball and sublimation workflows
- Cricut, embroidery, DTF, screen printing, laser engraving, and sign making

### Blog System

The blog foundation lives in `src/lib/seo/blogPosts.js` and supports:

- categories
- tags
- related tool links
- Article structured data
- canonical metadata
- static generation

Target audiences:

- designers
- print shops
- sublimation businesses
- Cricut users
- embroidery shops
- sign makers

### Before / After Gallery

The gallery foundation lives in `src/lib/seo/galleryExamples.js` and supports:

- before image
- after image
- searchable title
- description
- tags
- category
- related SEO pages
- ImageObject structured data
- image sitemap entries

### AI Search Optimization

Pages are structured for AI answer engines by using:

- concise H1 and summary content
- explicit audience and use-case blocks
- FAQ schema and visible Q&A content
- related internal resources
- stable canonical URLs
- schema.org entities that map the product, website, organization, articles, and examples

For future content, keep paragraphs short, answer the query directly in the opening section, and include concrete workflows, limitations, and format definitions.

### Internal Linking

Internal links are generated from related slug arrays, connecting:

- tool landing pages to related tools
- blog posts to tool pages
- gallery examples to tool pages
- blog and gallery index pages to detail pages

Future expansion should add contextual keyword matching only after the editorial registry is large enough to avoid repetitive anchor text.

### Performance

Implemented SEO pages are static and lightweight. Monitoring remains lazy and consent-gated. The main performance recommendations are:

- keep SEO pages server-rendered by default
- avoid new global client providers for SEO content
- use optimized image dimensions for future gallery assets
- add blur placeholders only when asset generation is automated
- split sitemaps when indexable URLs approach 50,000
- keep blog/gallery data fetches cached or build-time generated

### Conversion SEO

High-value conversion pages now supported or prepared:

- print shops: `/dtf-printing-vector`, `/screen-printing-vector`
- logo designers: `/logo-to-svg`, `/vectorize-logo`
- sublimation: `/sublimation-vector`, `/basketball-logo-to-svg`
- Cricut: `/cricut-svg`
- embroidery: `/embroidery-vector`
- laser engraving: `/laser-engraving-vector`
- sign making: `/sign-making-vector`

### Analytics Measurement

Recommended GA4/PostHog event names are now available from `src/lib/analytics.js`:

- `seo_landing_page_view`
- `seo_cta_click`
- `upload_funnel_started`
- `tracing_funnel_step`
- `download_funnel_completed`
- existing signup, login, trace, download, checkout, purchase, referral, and error events

Recommended event properties:

- `page_type`
- `slug`
- `cta`
- `source`
- `funnel_step`
- `file_type`
- `conversion_goal`
- `credits_required`
- `credits_balance`

## Prioritized Roadmap

### High Impact

- Keep programmatic pages data-driven and require unique intent fields before publishing.
- Expand gallery examples with real before/after production assets and image dimensions.
- Add editorial review for every generated landing page before it enters the sitemap.
- Monitor GA4/PostHog conversion rate by landing slug.

### Medium Impact

- Add category pages for blog and gallery once each category has enough unique content.
- Add generated OG images per landing page.
- Add sitemap splitting when URL count grows.
- Add glossary pages for SVG, vector tracing, sublimation, DTF, and Cricut terminology.

### Low Impact

- Add localized hreflang only when translated pages are available.
- Add richer author profiles if the blog becomes a major acquisition channel.
- Add automated broken-link checks in CI.

## Verification Checklist

- `npm run build` passes.
- `/sitemap.xml` contains core, programmatic, blog, and gallery URLs.
- `/robots.txt` blocks private, API, mobile, test, and dynamic project routes.
- `/manifest.webmanifest` or `/manifest.json` is served by Next.js metadata routing.
- `/bg-remover` returns an indexable landing page.
- `/bg-remover/[id]`, `/workspace/[id]`, `/mobile`, and `/sentry-test` are noindexed.
- Programmatic pages include canonical, Open Graph, Twitter cards, FAQ schema, Breadcrumb schema, and WebApplication schema.
- Blog posts include canonical, Open Graph, Twitter cards, Article schema, and Breadcrumb schema.
- Gallery examples include canonical, Open Graph, Twitter cards, ImageObject schema, Breadcrumb schema, and image sitemap entries.
- SEO CTA clicks and SEO page views fire only after analytics consent, preserving the monitoring consent model.
