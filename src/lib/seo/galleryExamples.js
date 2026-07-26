export const galleryExamples = [
  {
    slug: "basketball-jersey-logo-vector",
    title: "Basketball Jersey Logo Vector Conversion",
    description: "A sports jersey logo converted from raster artwork into a cleaner SVG-ready production asset.",
    beforeImage: "/samples/production-preview/LOGO.png",
    afterImage: "/samples/production-preview/LOGO-1.png",
    category: "Sports Jersey",
    tags: ["basketball", "logo", "sublimation", "svg"],
    relatedSlugs: ["basketball-logo-to-svg", "sublimation-vector", "logo-to-svg"],
  },
  {
    slug: "low-resolution-logo-enhancement",
    title: "Low-Resolution Logo Enhancement",
    description: "A compressed customer logo improved before SVG tracing and print production.",
    beforeImage: "/samples/production-preview/Hue_Saturation.png",
    afterImage: "/samples/production-preview/SUBJECT.png",
    category: "Logo Cleanup",
    tags: ["logo", "upscale", "print shops"],
    relatedSlugs: ["image-upscaler", "vectorize-logo", "logo-to-svg"],
  },
  {
    slug: "transparent-background-product-art",
    title: "Transparent Background Product Artwork",
    description: "Artwork isolated from its background to create a cleaner transparent production file.",
    beforeImage: "/samples/production-preview/IMAGE.png",
    afterImage: "/samples/production-preview/Image-1.png",
    category: "Background Removal",
    tags: ["background remover", "transparent png", "product art"],
    relatedSlugs: ["background-remover", "png-to-svg", "cricut-svg"],
  },
];

export function getGalleryExample(slug) {
  return galleryExamples.find((example) => example.slug === slug);
}
