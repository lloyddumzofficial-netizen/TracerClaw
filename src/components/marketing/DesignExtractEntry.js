"use client";
import { seedDesignPreview, cacheDesignProject } from "@/features/design-extract/projectClient";

import { Layers3 } from "lucide-react";
import { useRouter } from "next/navigation";
import useDesignExtractAccess from "@/hooks/useDesignExtractAccess";
import { useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { toast } from "@/components/ui/Toast";
export default function DesignExtractEntry({ sourceProjectId, hasResult = true }) {
  const enabled = useDesignExtractAccess();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const open = async () => {
    if (!sourceProjectId) { router.push("/#start"); return; }
    setBusy(true);
    try {
      const { data: { session } } = await createClient().auth.getSession();
      if (!session) throw new Error("Sign in to use this design");
      const response = await fetch("/api/design-extract", { method: "POST", headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ sourceProjectId }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not create project");
      seedDesignPreview(session.user.id, { id: data.project.id, trace_type: "design_extract", original_image_url: data.project.source_url, width: data.project.manifest?.width, height: data.project.manifest?.height });
      cacheDesignProject({ project: data.project, job: null });
      router.push(`/design-extract/${data.project.id}`);
    } catch (error) { toast.error(error.message); }
    finally { setBusy(false); }
  };
  if (!enabled || !hasResult) return null;
  return <button type="button" className="studio-ghost-btn design-extract-entry" disabled={busy} aria-busy={busy} onClick={open}><Layers3 size={16} />{busy ? "Opening design…" : sourceProjectId ? "Extract design elements" : "Design Extract"}</button>;
}
