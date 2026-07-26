import Link from "next/link";
import SeoShell, { styles } from "@/components/seo/SeoShell";
import { blogCategories, blogPosts } from "@/lib/seo/blogPosts";
import { siteName, siteUrl } from "@/lib/siteMetadata";
import { absoluteUrl, breadcrumbJsonLd } from "@/lib/seo/schema";

export const metadata = {
  title: "Design and Print Shop SEO Blog",
  description: "Production guides for designers, print shops, sublimation businesses, Cricut users, embroidery shops, and sign makers.",
  alternates: {
    canonical: absoluteUrl("/blog"),
  },
  openGraph: {
    type: "website",
    url: absoluteUrl("/blog"),
    siteName,
    title: "Design and Print Shop SEO Blog | DesaynClaw",
    description: "Production guides for designers, print shops, sublimation businesses, Cricut users, embroidery shops, and sign makers.",
    images: ["/DESAYNCLAW-Image.JPG"],
  },
};

export default function BlogIndexPage() {
  return (
    <SeoShell
      jsonLd={[breadcrumbJsonLd([{ name: "Home", url: siteUrl }, { name: "Blog", url: "/blog" }])]}
      pageType="blog_index"
      slug="blog"
      title="Design and Print Shop SEO Blog"
    >
      <p style={styles.eyebrow}>Production guides</p>
      <h1 style={styles.h1}>Design and print shop workflows</h1>
      <p style={styles.lead}>
        Practical articles for designers, print shops, sublimation businesses, Cricut users,
        embroidery teams, and sign makers preparing artwork for production.
      </p>

      <section aria-labelledby="categories">
        <h2 id="categories" style={styles.h2}>Categories</h2>
        <div style={styles.actions}>
          {blogCategories.map((category) => (
            <span key={category.slug} style={styles.secondary}>{category.name}</span>
          ))}
        </div>
      </section>

      <section aria-labelledby="posts">
        <h2 id="posts" style={styles.h2}>Latest guides</h2>
        <div style={styles.grid}>
          {blogPosts.map((post) => (
            <Link key={post.slug} href={`/blog/${post.slug}`} style={{ ...styles.card, textDecoration: "none" }}>
              <p style={styles.eyebrow}>{post.category.replace("-", " ")}</p>
              <h3 style={styles.h3}>{post.title}</h3>
              <p style={styles.text}>{post.description}</p>
            </Link>
          ))}
        </div>
      </section>
    </SeoShell>
  );
}
