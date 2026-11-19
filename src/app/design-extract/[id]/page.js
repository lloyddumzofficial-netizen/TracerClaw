import DesignExtract from "@/features/design-extract/DesignExtract";
import { notFound } from "next/navigation";
import "../../workspace/[id]/garment-workspace.css";
export const metadata = { title: "Design Extract — DesaynClaw", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";
export default async function Page({ params }) {
  if (process.env.DESIGN_EXTRACT_ENABLED !== "true") notFound();
  const { id } = await params;
  return <DesignExtract key={id} projectId={id} />;
}
