import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { deleteFromR2, s3Client, bucketName } from '@/lib/cloudflare';
import { ListObjectsV2Command } from '@aws-sdk/client-s3';

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

  const results = { projectsDeleted: 0, projectsFailed: 0, mobileSyncDeleted: 0 };

  try {
    // ─── 1. Delete projects older than 3 days ────────────────────────────────
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    
    const { data: oldProjects, error: fetchErr } = await adminSupabase
      .from('projects')
      .select('id, original_image_url, generated_image_url, upscaled_image_url, svg_url')
      .lt('created_at', threeDaysAgo.toISOString());

    if (fetchErr) throw fetchErr;

    if (oldProjects && oldProjects.length > 0) {
      console.log(`[Cron] Found ${oldProjects.length} old projects to clean up.`);

      for (const project of oldProjects) {
        try {
          // Delete all associated files from R2 first
          const urls = [
            project.original_image_url,
            project.generated_image_url,
            project.upscaled_image_url,
            project.svg_url,
          ];
          for (const url of urls) {
            if (url && url !== 'REFUNDED') {
              await deleteFromR2(url);
            }
          }

          // Then delete the DB record
          await adminSupabase.from('projects').delete().eq('id', project.id);
          results.projectsDeleted++;
          console.log(`[Cron] Deleted project ${project.id} and its files.`);
        } catch (err) {
          results.projectsFailed++;
          console.error(`[Cron] Error deleting project ${project.id}:`, err);
        }
      }
    } else {
      console.log('[Cron] No old projects found.');
    }

    // ─── 2. Delete orphaned mobile_sync uploads (older than 24 hours) ────────
    // These are temporary files uploaded from mobile that may never get attached to a project.
    try {
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const listCmd = new ListObjectsV2Command({
        Bucket: bucketName,
        Prefix: 'users/mobile_sync/',
      });
      const listResult = await s3Client.send(listCmd);

      if (listResult.Contents) {
        for (const obj of listResult.Contents) {
          if (obj.LastModified && obj.LastModified.toISOString() < oneDayAgo) {
            await deleteFromR2(`${process.env.CLOUDFLARE_PUBLIC_URL}/${obj.Key}`);
            results.mobileSyncDeleted++;
            console.log(`[Cron] Purged orphaned mobile_sync file: ${obj.Key}`);
          }
        }
      }
    } catch (mobileErr) {
      // Non-fatal: log but don't fail the whole cron job
      console.warn('[Cron] Mobile sync cleanup failed (non-fatal):', mobileErr.message);
    }

    console.log(`[Cron] Done. Projects deleted: ${results.projectsDeleted}, failed: ${results.projectsFailed}, mobile files purged: ${results.mobileSyncDeleted}`);
    return NextResponse.json({ success: true, ...results });

  } catch (error) {
    console.error('[Cron Error]:', error);
    return NextResponse.json({ error: 'Cleanup failed', ...results }, { status: 500 });
  }
}
