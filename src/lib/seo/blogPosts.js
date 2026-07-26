export const blogCategories = [
  { slug: "print-shops", name: "Print Shops" },
  { slug: "sublimation", name: "Sublimation" },
  { slug: "cricut", name: "Cricut" },
  { slug: "embroidery", name: "Embroidery" },
  { slug: "sign-making", name: "Sign Making" },
];

export const blogPosts = [
  {
    slug: "prepare-customer-logo-for-print",
    title: "How to Prepare a Customer Logo for Print Production",
    description: "A practical workflow for cleaning, upscaling, vectorizing, and exporting customer logos before print production.",
    category: "print-shops",
    tags: ["logo cleanup", "vector tracing", "print production"],
    publishedAt: "2026-07-26",
    updatedAt: "2026-07-26",
    image: "/DESAYNCLAW-Image.JPG",
    summary: "Most print jobs start with imperfect artwork. This workflow helps shops decide when to remove backgrounds, upscale, vectorize, and export.",
    sections: [
      { heading: "Start with the cleanest source", body: "Ask for the original PNG, JPG, PDF, or vector file. If the customer only has a screenshot, upscale before tracing so edges are easier to inspect." },
      { heading: "Remove distracting backgrounds", body: "Transparent backgrounds make logo edges easier to evaluate and reduce unwanted shapes during vector tracing." },
      { heading: "Vectorize only after cleanup", body: "Tracing works best when the source has clear contrast and visible edges. Export SVG, then inspect curves and small text before production." },
    ],
    relatedSlugs: ["png-to-svg", "logo-to-svg", "image-upscaler"],
  },
  {
    slug: "png-vs-svg-for-cricut",
    title: "PNG vs SVG for Cricut: Which File Should You Use?",
    description: "Understand when Cricut users should use PNG files and when SVG files are better for cutting, decals, shirts, and stickers.",
    category: "cricut",
    tags: ["cricut", "svg", "cutting files"],
    publishedAt: "2026-07-26",
    updatedAt: "2026-07-26",
    image: "/samples/production-preview/LOGO.png",
    summary: "PNG is useful for printed designs. SVG is usually better when the design needs scalable paths for cutting or editing.",
    sections: [
      { heading: "Use PNG for print-first artwork", body: "PNG keeps raster detail and transparency, which is helpful for stickers, sublimation, and print-then-cut workflows." },
      { heading: "Use SVG for scalable shapes", body: "SVG stores vector paths, which makes it stronger for cutting, resizing, and shape editing." },
      { heading: "Clean the background first", body: "Removing backgrounds before conversion usually creates simpler, more usable SVG paths." },
    ],
    relatedSlugs: ["cricut-svg", "png-to-svg", "background-remover"],
  },
  {
    slug: "sublimation-artwork-checklist",
    title: "Sublimation Artwork Checklist for Print Shops",
    description: "A production checklist for sublimation businesses preparing jersey artwork, logos, and customer-supplied image files.",
    category: "sublimation",
    tags: ["sublimation", "jersey design", "print checklist"],
    publishedAt: "2026-07-26",
    updatedAt: "2026-07-26",
    image: "/cover-page.webp",
    summary: "Sublimation shops need scalable, clean, high-resolution artwork before sending files into production.",
    sections: [
      { heading: "Check resolution before layout", body: "Low-resolution logos and graphics should be enhanced before they are placed into production templates." },
      { heading: "Keep logos scalable", body: "Vectorizing logos helps teams reuse the same artwork across jersey sizes, nameplates, panels, and marketing files." },
      { heading: "Separate cleanup from production", body: "Use a repeatable cleanup workflow before final layout so production files stay predictable." },
    ],
    relatedSlugs: ["sublimation-vector", "basketball-logo-to-svg", "logo-to-svg"],
  },
  {
    slug: "vector-artwork-before-embroidery",
    title: "Why Clean Vector Artwork Helps Before Embroidery Digitizing",
    description: "Learn why embroidery shops and apparel decorators benefit from clean vector references before creating stitch files.",
    category: "embroidery",
    tags: ["embroidery", "digitizing", "logo vector"],
    publishedAt: "2026-07-26",
    updatedAt: "2026-07-26",
    image: "/samples/production-preview/LOGO.png",
    summary: "SVG is not an embroidery stitch file, but it can give digitizers a cleaner reference for logo shapes and proportions.",
    sections: [
      { heading: "Vector is a source, not a stitch file", body: "Embroidery still needs digitizing, but a clean SVG helps clarify the logo before stitch decisions are made." },
      { heading: "Clean edges reduce guesswork", body: "Digitizers can work faster when the source artwork has clear shapes and fewer compression artifacts." },
      { heading: "Keep production handoff clear", body: "Attach the cleaned SVG alongside notes about size, fabric, thread colors, and usage." },
    ],
    relatedSlugs: ["embroidery-vector", "logo-to-svg", "vectorize-logo"],
  },
];

export function getBlogPost(slug) {
  return blogPosts.find((post) => post.slug === slug);
}

export function getBlogCategory(slug) {
  return blogCategories.find((category) => category.slug === slug);
}
