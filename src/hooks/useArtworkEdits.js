"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { isCompleteDesignProject } from "@/lib/artworkEdits";
import { safeJson } from "@/lib/safeJson";

export default function useArtworkEdits({ project, supabase, onProject, onCreditsChanged }) {
  const [enabled, setEnabled] = useState(false);
  const [edits, setEdits] = useState([]);
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const submitting = useRef(false);
  const currentProjectId = useRef(project?.id);
  currentProjectId.current = project?.id;
  const endpoint = project ? `/api/projects/${project.id}/artwork-edits` : "";
  const request = useCallback(async (suffix = "", body) => {
    const { data: { session } } = await supabase.auth.getSession();
    const response = await fetch(endpoint + suffix, {
      method: body === undefined ? "GET" : "POST", cache: "no-store",
      headers: { "Content-Type": "application/json", ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await safeJson(response);
    if (!response.ok) {
      const messages = { SOURCE_CHANGED: "The artwork was updated. Review the refreshed image and select your areas before generating. No Claw was charged.", PROJECT_BUSY: "This project is still processing. Try again when it finishes.", INSUFFICIENT_CREDITS: "You need 1 Claw for this edit.", REQUEST_KEY_CONFLICT: "This request was already submitted with different instructions. Reopen the editor." };
      throw Object.assign(new Error(messages[data?.code] || data?.error || "Unable to reach the artwork editor."), { code: data?.code });
    }
    return data;
  }, [endpoint, supabase]);
  const synchronizeProject = useCallback(snapshot => {
    if (!snapshot?.id || snapshot.id !== currentProjectId.current) return;
    onProject(previous => previous?.id === snapshot.id ? { ...previous, ...snapshot } : previous);
  }, [onProject]);
  const reload = useCallback(async ({ synchronize = true } = {}) => {
    const data = await request();
    if (currentProjectId.current !== project?.id) return null;
    setEnabled(data.enabled === true); setEdits(data.edits || []);
    if (synchronize) synchronizeProject(data.project);
    return data;
  }, [request, project?.id, synchronizeProject]);
  const prepareOpen = async () => {
    if (submitting.current) return false;
    submitting.current = true; setWorking(true); setError("");
    try {
      const data = await reload();
      if (!data) return false;
      if (!data.enabled) throw new Error("Artwork editing is temporarily unavailable.");
      if (!data.project?.generated_image_url) throw new Error("Extract the artwork before opening the editor.");
      return true;
    } catch (failure) { setError(failure.message); return false; }
    finally { submitting.current = false; setWorking(false); }
  };
  useEffect(() => {
    if (!project?.id || !isCompleteDesignProject(project)) { setEnabled(false); setEdits([]); return; }
    let current = true;
    request().then(data => { if (current) { setEnabled(data.enabled === true); setEdits(data.edits || []); } }).catch(() => { if (current) setEnabled(false); });
    return () => { current = false; };
  }, [project?.id, project?.trace_type, project?.ai_prompt, request]);
  const pending = edits.find(edit => edit.status === "processing");
  const merge = useCallback(edit => setEdits(rows => [edit, ...rows.filter(row => row.id !== edit.id)]), []);
  useEffect(() => {
    if (!pending?.id) return;
    let disposed = false; let timer;
    const poll = async () => {
      try {
        const { edit } = await request(`/${pending.id}`);
        if (disposed) return;
        merge(edit); setError("");
        if (edit.status !== "processing") { onCreditsChanged?.(); return; }
      } catch (failure) { if (!disposed) setError(failure.message); }
      if (!disposed) timer = setTimeout(poll, 4000);
    };
    timer = setTimeout(poll, 2000);
    return () => { disposed = true; clearTimeout(timer); };
  }, [pending?.id, request, merge, onCreditsChanged]);
  const generate = async (body) => {
    if (submitting.current) return null;
    submitting.current = true; setWorking(true); setError("");
    try {
      // Confirm the exact image/version the user drew on, before any paid POST.
      // Never silently move an old selection onto newly generated artwork.
      const latest = await reload({ synchronize: false });
      if (!latest) return null;
      const sourceUrl = body.sourceUrl || project?.generated_image_url;
      if (!latest.project || latest.project.generated_image_url !== sourceUrl || latest.project.artwork_revision !== body.sourceRevision) {
        synchronizeProject(latest.project);
        throw Object.assign(new Error(latest.project?.generated_image_url === sourceUrl
          ? "The artwork version was updated. Your selections are kept for this image; review them and generate again. No Claw was charged."
          : "The artwork was updated. Select your areas on the refreshed image before generating. Your previous draft is saved. No Claw was charged."), { sourceRefreshed: true });
      }
      const { edit } = await request("", body);
      if (currentProjectId.current !== project?.id) return null;
      merge(edit); onCreditsChanged?.(); return edit;
    }
    catch (failure) { setError(failure.message); if (!failure.sourceRefreshed) await reload().catch(() => {}); return null; }
    finally { submitting.current = false; setWorking(false); }
  };
  const apply = async (editId, restore = false) => {
    if (submitting.current) return false;
    submitting.current = true; setWorking(true); setError("");
    try { const data = await request(`/${editId}/apply`, { restore }); onProject(data.project); await reload(); return true; }
    catch (failure) { setError(failure.message); if (failure.code === "SOURCE_CHANGED") await reload().catch(() => {}); return false; }
    finally { submitting.current = false; setWorking(false); }
  };
  return { enabled, edits, error, setError, busy: working || Boolean(pending), working, generate, apply, reload, prepareOpen };
}
