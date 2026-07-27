import Link from "next/link";

/**
 * Rendered by notFound() — called from the programmatic SEO, blog and gallery
 * routes — and for any unmatched path. Without it those routes fall through to
 * the framework default.
 */
export const metadata = {
  title: "Page not found",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <main style={{ minHeight: "100vh", background: "#0a0a0a", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", padding: "48px", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ maxWidth: "520px", textAlign: "center" }}>
        <h1 style={{ margin: "0 0 12px", fontSize: "28px", color: "#FFD700" }}>Page not found</h1>
        <p style={{ color: "#aaa", lineHeight: 1.6, margin: "0 0 24px" }}>
          The page you are looking for does not exist or has been moved.
        </p>
        <Link
          href="/"
          style={{ display: "inline-block", padding: "12px 24px", border: "none", borderRadius: "6px", background: "#FFD700", color: "#000", fontWeight: 700, fontSize: "15px", textDecoration: "none" }}
        >
          Back to home
        </Link>
      </div>
    </main>
  );
}
