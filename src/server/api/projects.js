import { NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase";

export async function loadOwnedProject({
  userId,
  projectId,
  columns = "*",
  notFoundMessage = "Project not found or access denied",
  notFoundStatus = 404,
}) {
  if (!userId || !projectId) {
    return {
      project: null,
      error: null,
      response: NextResponse.json({ error: notFoundMessage }, { status: notFoundStatus }),
    };
  }

  const { data: project, error } = await adminSupabase
    .from("projects")
    .select(columns)
    .eq("id", projectId)
    .eq("user_id", userId)
    .single();

  if (error || !project) {
    return {
      project: null,
      error,
      response: NextResponse.json({ error: notFoundMessage }, { status: notFoundStatus }),
    };
  }

  return { project, error: null, response: null };
}
