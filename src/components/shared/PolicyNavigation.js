import Link from "next/link";

const pages = [
  ["privacy", "Privacy Policy"],
  ["terms", "Terms of Service"],
  ["refunds", "Refund Policy"],
];

export default function PolicyNavigation({ current }) {
  return <nav className="policy-navigation" aria-label="Policies">{pages.map(([slug, label]) => <Link key={slug} href={`/${slug}`} aria-current={current === slug ? "page" : undefined}>{label}</Link>)}</nav>;
}

export function PolicyContents({ items }) {
  return <aside className="policy-contents"><nav aria-label="On this page"><span>On this page</span>{items.map(([id, label], index) => <a href={`#${id}`} key={id}><small>{String(index + 1).padStart(2, "0")}</small>{label}</a>)}</nav></aside>;
}
