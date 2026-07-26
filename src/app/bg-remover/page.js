import Link from "next/link";
import SeoShell, { PrimaryCta, styles } from "@/components/seo/SeoShell";
import { getProgrammaticPage } from "@/lib/seo/programmaticPages";
import { siteUrl } from "@/lib/siteMetadata";
import { breadcrumbJsonLd, faqJsonLd, webApplicationJsonLd } from "@/lib/seo/schema";

const page = {
  ...getProgrammaticPage("background-remover"),
  slug: "bg-remover",
};

export default function BgRemoverLandingPage() {
  const jsonLd = [
    webApplicationJsonLd(page),
    breadcrumbJsonLd([
      { name: "Home", url: siteUrl },
      { name: "AI Background Remover", url: "/bg-remover" },
    ]),
    faqJsonLd(page.faqs),
  ].filter(Boolean);

  return (
    <SeoShell jsonLd={jsonLd} pageType="tool_landing" slug="bg-remover" title="AI Background Remover">
      <p style={styles.eyebrow}>Transparent PNG workflow</p>
      <h1 style={styles.h1}>Remove Backgrounds with AI</h1>
      <p style={styles.lead}>{page.description}</p>
      <div style={styles.actions}>
        <PrimaryCta properties={{ page_type: "tool_landing", slug: "bg-remover", cta: "hero" }}>
          Remove a background
        </PrimaryCta>
        <Link href="/background-remover" style={styles.secondary}>Read the workflow</Link>
      </div>
      <section aria-labelledby="background-remover-workflow">
        <h2 id="background-remover-workflow" style={styles.h2}>Production workflow</h2>
        <div style={styles.grid}>
          {page.features.map((feature) => (
            <article key={feature} style={styles.card}>
              <h3 style={styles.h3}>{feature}</h3>
              <p style={styles.text}>Use background removal before SVG tracing, upscaling, product mockups, or transparent PNG handoff.</p>
            </article>
          ))}
        </div>
      </section>
    </SeoShell>
  );
}
