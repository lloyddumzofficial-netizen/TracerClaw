import { siteName, siteUrl } from "@/lib/siteMetadata";

export function absoluteUrl(path = "") {
  if (!path) return siteUrl;
  if (/^https?:\/\//.test(path)) return path;
  return `${siteUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

export function breadcrumbJsonLd(items) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.url),
    })),
  };
}

export function faqJsonLd(faqs = []) {
  if (!faqs.length) return null;
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.answer,
      },
    })),
  };
}

export function articleJsonLd(post) {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.description,
    image: post.image ? absoluteUrl(post.image) : absoluteUrl("/DESAYNCLAW-Image.JPG"),
    datePublished: post.publishedAt,
    dateModified: post.updatedAt || post.publishedAt,
    author: {
      "@type": "Organization",
      name: siteName,
      url: siteUrl,
    },
    publisher: {
      "@type": "Organization",
      name: siteName,
      logo: {
        "@type": "ImageObject",
        url: absoluteUrl("/logo.png"),
      },
    },
    mainEntityOfPage: absoluteUrl(`/blog/${post.slug}`),
  };
}

export function imageExampleJsonLd(example) {
  return {
    "@context": "https://schema.org",
    "@type": "ImageObject",
    name: example.title,
    description: example.description,
    contentUrl: absoluteUrl(example.afterImage),
    thumbnailUrl: absoluteUrl(example.beforeImage),
    creator: {
      "@type": "Organization",
      name: siteName,
      url: siteUrl,
    },
  };
}

export function webApplicationJsonLd(page) {
  return {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: page.title,
    url: absoluteUrl(`/${page.slug}`),
    applicationCategory: "DesignApplication",
    operatingSystem: "Web",
    description: page.description,
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "PHP",
      description: "Free credits on sign up. Pay-per-use credit system.",
    },
    featureList: page.features,
    publisher: {
      "@type": "Organization",
      name: siteName,
      url: siteUrl,
      logo: absoluteUrl("/logo.png"),
    },
  };
}
