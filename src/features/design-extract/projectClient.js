"use client";
import { createClient } from "@/utils/supabase/client";

const TTL = 60_000;
const snapshots = new Map(), previews = new Map(), pending = new Map();
let activeUser = null, watching = false, generation = 0;
export function clearDesignProjects() { snapshots.clear(); previews.clear(); pending.clear(); activeUser = null; generation++; }
function userScope(userId) { if (activeUser !== userId) { clearDesignProjects(); activeUser = userId; } }
function watch() {
  if (watching) return;
  watching = true;
  createClient().auth.onAuthStateChange((event, session) => { if (event === "SIGNED_OUT" || activeUser && session?.user?.id !== activeUser) clearDesignProjects(); });
}
function live(entry) { return entry && entry.until > Date.now() && (!entry.data.project?.expires_at || Date.parse(entry.data.project.expires_at) > Date.now()); }
function bound(map) { while (map.size > 20) map.delete(map.keys().next().value); }
export function seedDesignPreview(userId, card) {
  if (!userId || card.trace_type !== "design_extract") return;
  watch(); userScope(userId);
  previews.set(card.id, { until: Date.now() + TTL, data: { thumbnailUrl: card.original_image_url ? card.original_image_url : null, project: { id: card.id, source_url: card.original_image_url, manifest: { name: card.name, workspaceMode: card.workspaceMode, width: card.width || 240, height: card.height || 320, layers: [] } }, preview: true } }); bound(previews);
}
export function editorSeed(id) {
  if (!activeUser) return null;
  for (const map of [snapshots, previews]) { const entry = map.get(id); if (live(entry)) return { ...entry.data, thumbnailUrl: entry.data.thumbnailUrl || (live(previews.get(id)) ? previews.get(id).data.thumbnailUrl : null) }; map.delete(id); }
  return null;
}
export function cacheDesignProject(data) {
  if (!activeUser || !data?.project?.id || !Array.isArray(data.project.manifest?.layers)) return;
  // A mutation response may have a newer revision without the editor's capabilities.
  if (typeof data.guidedCutouts !== "boolean" || !data.billing) {
    snapshots.delete(data.project.id);
    return;
  }
  snapshots.set(data.project.id, { until: Date.now() + TTL, data }); bound(snapshots);
}
export function forgetDesignProject(id) { snapshots.delete(id); previews.delete(id); }
export async function designRequest(path, { responseType, ...options } = {}) {
  watch();
  const { data: { session } } = await createClient().auth.getSession();
  if (!session) { clearDesignProjects(); throw Object.assign(new Error("Sign in to open this document."), { status: 401 }); }
  userScope(session.user.id);
  const requestGeneration = generation;
  let response;
  try {
    response = await fetch(`/api/design-extract${path}`, { ...options, signal: options.signal || AbortSignal.timeout(options.method && options.method !== "GET" ? 65000 : 20000), headers: { Authorization: `Bearer ${session.access_token}`, ...(options.body && !(options.body instanceof FormData) ? { "Content-Type": "application/json" } : {}), ...options.headers } });
  } catch (error) {
    if (error.name === "TimeoutError") throw Object.assign(new Error("The connection timed out. Retry to check the saved document or existing request."), { status: 408 });
    throw error;
  }
  const data = response.ok && responseType === "blob" ? await response.blob() : await response.json().catch(() => null);
  if (requestGeneration !== generation) throw Object.assign(new Error("Your session changed. Reopen the document."), { status: 401 });
  if (!response.ok) {
    if ([401, 403].includes(response.status)) clearDesignProjects();
    const retryHeader = response.headers?.get("retry-after");
    const retryAfterMs = retryHeader && /^\d+$/.test(retryHeader) ? Number(retryHeader) * 1000 : Date.parse(retryHeader) - Date.now();
    throw Object.assign(new Error(data?.error || "Could not load the document. Please retry."), { status: response.status, retryAfterMs, code: data?.code });
  }
  if (!data) throw Object.assign(new Error("The server returned an incomplete response."), { status: 502 });
  return data;
}
export async function fetchDesignProject(id, force = false) {
  const { data: { session } } = await createClient().auth.getSession();
  if (!session) { clearDesignProjects(); throw Object.assign(new Error("Sign in to open this document."), { status: 401 }); }
  userScope(session.user.id); watch();
  const cached = snapshots.get(id);
  if (!force && live(cached)) return cached.data;
  const key = `${session.user.id}:${id}`;
  if (pending.has(key)) return pending.get(key);
  const scope = generation;
  const request = designRequest(`/${encodeURIComponent(id)}`).then(data => { if (scope === generation) cacheDesignProject(data); return data; }).catch(error => { if (scope === generation && [404, 410].includes(error.status)) forgetDesignProject(id); throw error; }).finally(() => { if (pending.get(key) === request) pending.delete(key); });
  pending.set(key, request); return request;
}
export function prefetchDesignProject(userId, card) {
  seedDesignPreview(userId, card);
  return fetchDesignProject(card.id).catch(() => null);
}
