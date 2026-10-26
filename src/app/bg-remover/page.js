import BgRemoverEntry from "@/components/bg-remover/BgRemoverEntry";
import JsonLd from "@/components/seo/JsonLd";
import { SeoPageTracker } from "@/components/seo/SeoPageTracker";
import { getProgrammaticPage } from "@/lib/seo/programmaticPages";
import { siteUrl } from "@/lib/siteMetadata";
import { breadcrumbJsonLd, faqJsonLd, webApplicationJsonLd } from "@/lib/seo/schema";

export default function BgRemoverLandingPage() {
  const page = { ...getProgrammaticPage("background-remover"), slug: "bg-remover" };
  const schemas = [
    webApplicationJsonLd(page),
    breadcrumbJsonLd([{ name: "Home", url: siteUrl }, { name: "AI Background Remover", url: "/bg-remover" }]),
    faqJsonLd(page.faqs),
  ].filter(Boolean);

  return (
    <>
      <SeoPageTracker pageType="tool_landing" slug="bg-remover" title="AI Background Remover" />
      {schemas.map((schema, index) => <JsonLd key={index} data={schema} />)}
      <BgRemoverEntry />
    </>
  );
}
