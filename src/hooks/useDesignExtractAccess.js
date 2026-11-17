"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";
export default function useDesignExtractAccess(active = true) {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    if (!active) return;
    let live = true;
    const client = createClient();
    const check = async () => {
      const { data: { session } } = await client.auth.getSession();
      if (!session) { if (live) setEnabled(false); return; }
      try {
        const response = await fetch("/api/design-extract", { headers: { Authorization: `Bearer ${session.access_token}` } });
        if (live) setEnabled(response.ok);
      } catch { if (live) setEnabled(false); }
    };
    check();
    const { data: { subscription } } = client.auth.onAuthStateChange(() => { setTimeout(check, 0); });
    return () => { live = false; subscription.unsubscribe(); };
  }, [active]);
  return enabled;
}
