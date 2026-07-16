import { NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase";
import { deleteFromR2 } from "@/lib/cloudflare";

export async function PATCH(request) {
  try {
    // ─── Auth ─────────────────────────────────────────────────────────────────
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const token = authHeader.replace('Bearer ', '').trim();
    const { data: { user }, error: authError } = await adminSupabase.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    // ─────────────────────────────────────────────────────────────────────────

    const { projectId, newName } = await request.json();

    if (!projectId || !newName) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Only allow renaming own projects
    const { error } = await adminSupabase
      .from('projects')
      .update({ name: newName })
      .eq('id', projectId)
      .eq('user_id', user.id); // ownership check built into the WHERE clause

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error renaming project:", error);
    return NextResponse.json({ error: "Failed to rename project" }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    // ─── Auth ─────────────────────────────────────────────────────────────────
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const token = authHeader.replace('Bearer ', '').trim();
    const { data: { user }, error: authError } = await adminSupabase.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    // ─────────────────────────────────────────────────────────────────────────

    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('id');

    if (!projectId) {
      return NextResponse.json({ error: "No project ID provided" }, { status: 400 });
    }

    // 1. Get the project — only if the user owns it
    const { data: project, error: fetchError } = await adminSupabase
      .from('projects')
      .select('original_image_url, generated_image_url, upscaled_image_url, svg_url, zip_url, user_id')
      .eq('id', projectId)
      .eq('user_id', user.id) // ownership check
      .single();

    if (fetchError || !project) {
      return NextResponse.json({ error: "Project not found or access denied" }, { status: 403 });
    }

    // 2. Delete the record from Supabase database
    const { error: deleteError } = await adminSupabase
      .from('projects')
      .delete()
      .eq('id', projectId)
      .eq('user_id', user.id);

    if (deleteError) throw deleteError;

    // 3. Delete files from Cloudflare R2 to save storage costs
    const allowedPrefixes = [`users/${user.id}/`, `projects/${projectId}/`];
    if (project.original_image_url) {
      await deleteFromR2(project.original_image_url, { allowedPrefixes });
    }
    if (project.generated_image_url && project.generated_image_url !== 'REFUNDED') {
      await deleteFromR2(project.generated_image_url, { allowedPrefixes });
    }
    if (project.upscaled_image_url) {
      await deleteFromR2(project.upscaled_image_url, { allowedPrefixes });
    }
    if (project.svg_url) {
      await deleteFromR2(project.svg_url, { allowedPrefixes });
    }
    if (project.zip_url) {
      await deleteFromR2(project.zip_url, { allowedPrefixes });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting project:", error);
    return NextResponse.json({ error: "Failed to delete project" }, { status: 500 });
  }
}
