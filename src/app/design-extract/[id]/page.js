import DesignExtract from "@/features/design-extract/DesignExtract";
import "../../workspace/[id]/garment-workspace.css";
export const metadata = { title: "Design Extract — DesaynClaw", robots: { index: false, follow: false } };
export default async function Page({ params }) { const { id } = await params; return <DesignExtract key={id} projectId={id} />; }
