import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { deleteFromR2 } from "@/lib/cloudflare";

export async function PATCH(request) {
  try {
    const { projectId, newName } = await request.json();
    
    if (!projectId || !newName) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const { error } = await supabase
      .from('projects')
      .update({ name: newName })
      .eq('id', projectId);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error renaming project:", error);
    return NextResponse.json({ error: "Failed to rename project" }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('id');

    if (!projectId) {
      return NextResponse.json({ error: "No project ID provided" }, { status: 400 });
    }

    // 1. Get the project details first so we know what URLs to delete from Cloudflare
    const { data: project, error: fetchError } = await supabase
      .from('projects')
      .select('original_image_url, svg_url')
      .eq('id', projectId)
      .single();

    if (fetchError) throw fetchError;

    // 2. Delete the record from Supabase database
    const { error: deleteError } = await supabase
      .from('projects')
      .delete()
      .eq('id', projectId);

    if (deleteError) throw deleteError;

    // 3. Delete files from Cloudflare R2 to save storage costs
    if (project.original_image_url) {
      await deleteFromR2(project.original_image_url);
    }
    if (project.generated_image_url) {
      await deleteFromR2(project.generated_image_url);
    }
    if (project.svg_url) {
      await deleteFromR2(project.svg_url);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting project:", error);
    return NextResponse.json({ error: "Failed to delete project" }, { status: 500 });
  }
}
