"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";
export default function useDesignExtractAccess(active = true, details = false) {
  const [access, setAccess] = useState(null);
  useEffect(() => {
    if (!active) return;
    let live = true;
    const client = createClient();
    const check = async () => {
      const { data: { session } } = await client.auth.getSession();
      if (!session) { if (live) setAccess(null); return; }
      try {
        const response = await fetch("/api/design-extract?scope=access", { headers: { Authorization: `Bearer ${session.access_token}` } });
        const result = response.ok ? await response.json() : null;
        if (live) setAccess(result);
      } catch { if (live) setAccess(null); }
    };
    check();
    const { data: { subscription } } = client.auth.onAuthStateChange(() => { setTimeout(check, 0); });
    return () => { live = false; subscription.unsubscribe(); };
  }, [active]);
  return details ? access : Boolean(access?.enabled);
}
