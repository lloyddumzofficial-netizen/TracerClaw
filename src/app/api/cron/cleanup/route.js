import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { deleteFromR2 } from '@/lib/cloudflare';

// Ensure this route doesn't run at the Edge since it uses AWS SDK heavily
export const runtime = 'nodejs';
export const maxDuration = 60; 

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function GET(request) {
  // Simple cron secret check to prevent random people from triggering it
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // 1. Fetch projects older than 3 days
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    
    const { data: oldProjects, error: fetchErr } = await adminSupabase
      .from('projects')
      .select('*')
      .lt('created_at', threeDaysAgo.toISOString());

    if (fetchErr) throw fetchErr;

    if (!oldProjects || oldProjects.length === 0) {
      return NextResponse.json({ message: 'No old projects found to delete.' });
    }

    console.log(`[Cron] Found ${oldProjects.length} old projects to clean up.`);

    // 2. Loop through and delete files from R2
    let deletedCount = 0;
    for (const project of oldProjects) {
      try {
        if (project.original_image_url) await deleteFromR2(project.original_image_url);
        if (project.generated_image_url) await deleteFromR2(project.generated_image_url);
        if (project.upscaled_image_url) await deleteFromR2(project.upscaled_image_url);
        if (project.svg_url) await deleteFromR2(project.svg_url);

        // 3. Delete from DB
        await adminSupabase.from('projects').delete().eq('id', project.id);
        deletedCount++;
        console.log(`[Cron] Deleted project ${project.id} and its files.`);
      } catch (err) {
        console.error(`[Cron] Error deleting project ${project.id}:`, err);
      }
    }

    return NextResponse.json({ success: true, deleted: deletedCount });

  } catch (error) {
    console.error('[Cron Error]:', error);
    return NextResponse.json({ error: 'Cleanup failed' }, { status: 500 });
  }
}
