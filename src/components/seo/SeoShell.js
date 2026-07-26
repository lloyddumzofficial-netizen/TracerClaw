import Link from "next/link";
import JsonLd from "@/components/seo/JsonLd";
import { TrackedSeoLink, SeoPageTracker } from "@/components/seo/SeoPageTracker";

const styles = {
  page: {
    minHeight: "100vh",
    background: "#050505",
    color: "#f5f5f5",
    padding: "32px 20px 72px",
  },
  shell: {
    width: "100%",
    maxWidth: "1120px",
    margin: "0 auto",
  },
  nav: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "16px",
    marginBottom: "56px",
  },
  brand: {
    color: "#FFD700",
    fontWeight: 800,
    textDecoration: "none",
    letterSpacing: "0",
  },
  navLinks: {
    display: "flex",
    alignItems: "center",
    gap: "18px",
    flexWrap: "wrap",
  },
  navLink: {
    color: "#bdbdbd",
    fontSize: "14px",
    textDecoration: "none",
  },
  eyebrow: {
    color: "#FFD700",
    fontSize: "13px",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0",
    margin: "0 0 14px",
  },
  h1: {
    color: "#fff",
    fontSize: "clamp(40px, 7vw, 76px)",
    lineHeight: 1,
    margin: "0 0 22px",
    letterSpacing: "0",
  },
  lead: {
    color: "#d6d6d6",
    fontSize: "20px",
    lineHeight: 1.55,
    maxWidth: "780px",
    margin: "0 0 28px",
  },
  actions: {
    display: "flex",
    gap: "12px",
    flexWrap: "wrap",
    marginBottom: "56px",
  },
  primary: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "44px",
    padding: "0 18px",
    background: "#FFD700",
    color: "#050505",
    border: "1px solid #FFD700",
    borderRadius: "6px",
    fontWeight: 800,
    textDecoration: "none",
  },
  secondary: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "44px",
    padding: "0 18px",
    color: "#fff",
    border: "1px solid #2e2e2e",
    borderRadius: "6px",
    fontWeight: 700,
    textDecoration: "none",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
    gap: "16px",
    margin: "32px 0",
  },
  card: {
    border: "1px solid #262626",
    borderRadius: "8px",
    padding: "20px",
    background: "#0d0d0d",
  },
  h2: {
    color: "#fff",
    fontSize: "28px",
    margin: "56px 0 18px",
    letterSpacing: "0",
  },
  h3: {
    color: "#fff",
    fontSize: "18px",
    margin: "0 0 10px",
    letterSpacing: "0",
  },
  text: {
    color: "#cfcfcf",
    lineHeight: 1.65,
    margin: 0,
  },
  list: {
    color: "#d7d7d7",
    lineHeight: 1.7,
    paddingLeft: "20px",
  },
  media: {
    width: "100%",
    height: "auto",
    border: "1px solid #262626",
    borderRadius: "8px",
    background: "#111",
  },
  footer: {
    display: "flex",
    flexWrap: "wrap",
    gap: "14px",
    paddingTop: "48px",
    marginTop: "64px",
    borderTop: "1px solid #202020",
  },
};

export { styles };

export default function SeoShell({ children, jsonLd = [], pageType, slug, title }) {
  return (
    <main style={styles.page}>
      <SeoPageTracker pageType={pageType} slug={slug} title={title} />
      {jsonLd.map((item, index) => (
        <JsonLd key={index} data={item} />
      ))}
      <div style={styles.shell}>
        <nav style={styles.nav} aria-label="SEO navigation">
          <Link href="/" style={styles.brand}>DesaynClaw</Link>
          <div style={styles.navLinks}>
            <Link href="/blog" style={styles.navLink}>Blog</Link>
            <Link href="/gallery" style={styles.navLink}>Gallery</Link>
            <Link href="/bg-remover" style={styles.navLink}>BG Remover</Link>
            <Link href="/upscale" style={styles.navLink}>Upscaler</Link>
          </div>
        </nav>
        {children}
        <footer style={styles.footer} aria-label="SEO footer links">
          <Link href="/screen-printing-vector" style={styles.navLink}>Screen Printing Vector Prep</Link>
          <Link href="/copyright" style={styles.navLink}>Copyright</Link>
          <Link href="/acceptable-use" style={styles.navLink}>Acceptable Use</Link>
          <Link href="/copyright-takedown" style={styles.navLink}>Copyright Takedown</Link>
          <Link href="/privacy" style={styles.navLink}>Privacy</Link>
          <Link href="/terms" style={styles.navLink}>Terms</Link>
        </footer>
      </div>
    </main>
  );
}

export function PrimaryCta({ href = "/", children = "Start free", properties = {} }) {
  return (
    <TrackedSeoLink href={href} style={styles.primary} properties={properties}>
      {children}
    </TrackedSeoLink>
  );
}
