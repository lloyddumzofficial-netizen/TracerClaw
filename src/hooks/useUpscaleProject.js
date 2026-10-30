"use client";

import { useEffect, useState } from "react";

export default function useUpscaleProject(supabase, userId, projectId) {
  const [result, setResult] = useState({ key: null, project: null, error: null });
  const key = userId && projectId ? `${userId}:${projectId}` : null;
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    (async () => {
      try {
        const result = await supabase.from("projects")
          .select("id, name, created_at, original_image_url, generated_image_url, ai_prompt, client_request_id, refunded")
          .eq("id", projectId).eq("user_id", userId).eq("trace_type", "upscale").maybeSingle();
        if (cancelled) return;
        if (result.error) throw result.error;
        setResult({ key, project: result.data?.original_image_url ? result.data : null,
          error: result.data?.original_image_url ? null : "This upscale is unavailable or has expired. Choose another image or return to your projects." });
      } catch {
        if (!cancelled) setResult({ key, project: null, error: "We could not open this upscale. Check your connection and try opening it again from Recent Projects." });
      }
    })();
    return () => { cancelled = true; };
  }, [supabase, userId, projectId, key]);
  return result.key === key ? result : { project: null, error: null };
}
