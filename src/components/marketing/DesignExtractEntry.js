"use client";
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
      router.push(`/design-extract/${data.project.id}`);
    } catch (error) { toast.error(error.message); }
    finally { setBusy(false); }
  };
  if (!enabled || !hasResult) return null;
  return <button type="button" className="studio-ghost-btn" disabled={busy} onClick={open}><Layers3 size={16} />{busy ? "Opening design…" : sourceProjectId ? "Extract design elements" : "Design Extract"}</button>;
}
