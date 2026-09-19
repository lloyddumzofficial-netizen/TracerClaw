import { adminSupabase } from "@/lib/supabase";

export async function loadOwnedMockupProject(userId, projectId) {
  const { data, error } = await adminSupabase
    .from("mockup_projects")
    .select("*")
    .eq("id", projectId)
    .eq("user_id", userId)
    .single();
  return { project: data, error };
}

export async function loadMockupAssets(userId, projectId) {
  return adminSupabase
    .from("mockup_assets")
    .select("id, role, file_url, mime_type, file_size, width, height, created_at")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
}

export async function loadOwnedMockupJob(userId, jobId) {
  const { data, error } = await adminSupabase
    .from("mockup_jobs")
    .select("*")
    .eq("id", jobId)
    .eq("user_id", userId)
    .single();
  return { job: data, error };
}
