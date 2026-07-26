import { blogPosts } from "@/lib/seo/blogPosts";
import { galleryExamples } from "@/lib/seo/galleryExamples";
import { getProgrammaticPage, programmaticPages } from "@/lib/seo/programmaticPages";

export function getRelatedProgrammaticPages(slugs = [], limit = 4) {
  return slugs.map(getProgrammaticPage).filter(Boolean).slice(0, limit);
}

export function getRelatedBlogPosts(slugs = [], limit = 3) {
  const related = blogPosts.filter((post) =>
    post.relatedSlugs?.some((slug) => slugs.includes(slug))
  );
  return related.slice(0, limit);
}

export function getRelatedGalleryExamples(slugs = [], limit = 3) {
  const related = galleryExamples.filter((example) =>
    example.relatedSlugs?.some((slug) => slugs.includes(slug))
  );
  return related.slice(0, limit);
}

export function getSeoNavigation() {
  return {
    tools: programmaticPages.slice(0, 8),
    blog: blogPosts.slice(0, 4),
    gallery: galleryExamples.slice(0, 3),
  };
}
