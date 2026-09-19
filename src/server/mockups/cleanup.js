import { adminSupabase } from "@/lib/supabase";
import { deleteR2Prefix } from "@/lib/cloudflare";
import { logger } from "@/lib/logger";

export async function cleanupExpiredMockupProjects({ limit = 10, userId } = {}) {
  let query = adminSupabase.from("mockup_projects")
    .select("id,user_id")
    .lt("expires_at", new Date().toISOString())
    .order("expires_at", { ascending: true });
  if (userId) query = query.eq("user_id", userId);
  const { data: projects, error } = await query.limit(limit + 1);
  if (error?.code === "42P01" || error?.code === "PGRST205") {
    return { deleted: 0, failed: 0, objectsDeleted: 0, hasMore: false, unavailable: true };
  }
  if (error) throw error;

  const batch = (projects || []).slice(0, limit);
  const result = { deleted: 0, failed: 0, objectsDeleted: 0, hasMore: (projects || []).length > limit };
  for (let start = 0; start < batch.length; start += 5) {
    const outcomes = await Promise.all(batch.slice(start, start + 5).map(async project => {
      const prefix = `users/${project.user_id}/mockups/${project.id}/`;
      try {
        const objectsDeleted = await deleteR2Prefix(prefix, {
          allowedPrefixes: [`users/${project.user_id}/mockups/${project.id}/`],
        });
        const { error: deleteError } = await adminSupabase.from("mockup_projects").delete()
          .eq("id", project.id).eq("user_id", project.user_id);
        if (deleteError) throw deleteError;
        return { deleted: 1, failed: 0, objectsDeleted };
      } catch (caught) {
        logger.error("[Mockup cleanup] Project cleanup failed", { projectId: project.id, message: caught?.message });
        return { deleted: 0, failed: 1, objectsDeleted: 0 };
      }
    }));
    for (const outcome of outcomes) {
      result.deleted += outcome.deleted;
      result.failed += outcome.failed;
      result.objectsDeleted += outcome.objectsDeleted;
    }
  }
  return result;
}
