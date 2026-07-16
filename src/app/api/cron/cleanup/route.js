import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { deleteFromR2, s3Client, bucketName } from '@/lib/cloudflare';
import { ListObjectsV2Command } from '@aws-sdk/client-s3';

// Ensure this route doesn't run at the Edge since it uses AWS SDK heavily
export const runtime = 'nodejs';
export const maxDuration = 60; 

const PROJECT_BATCH_LIMIT = 10;
const MOBILE_SCAN_LIMIT = 250;
const MOBILE_DELETE_LIMIT = 25;
const ZIP_BATCH_LIMIT = 25;

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function GET(request) {
  // Simple cron secret check to prevent random people from triggering it
  const authHeader = request.headers.get('authorization');
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const results = {
    projectsDeleted: 0,
    projectsFailed: 0,
    mobileSyncDeleted: 0,
    zipCacheDeleted: 0,
    projectBatchLimit: PROJECT_BATCH_LIMIT,
    mobileScanLimit: MOBILE_SCAN_LIMIT,
    mobileDeleteLimit: MOBILE_DELETE_LIMIT,
    zipBatchLimit: ZIP_BATCH_LIMIT,
    hasMoreProjects: false,
    hasMoreMobileSync: false,
    hasMoreZipCache: false,
  };

  try {
    // ─── 1. Delete projects older than 3 days ────────────────────────────────
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    
    const { data: oldProjects, error: fetchErr } = await adminSupabase
      .from('projects')
      .select('id, original_image_url, generated_image_url, upscaled_image_url, svg_url, zip_url')
      .lt('created_at', threeDaysAgo.toISOString())
      .order('created_at', { ascending: true })
      .limit(PROJECT_BATCH_LIMIT + 1);

    if (fetchErr) throw fetchErr;
    const projectBatch = (oldProjects || []).slice(0, PROJECT_BATCH_LIMIT);
    results.hasMoreProjects = (oldProjects || []).length > PROJECT_BATCH_LIMIT;

    if (projectBatch.length > 0) {
      console.log(`[Cron] Found ${projectBatch.length} old projects to clean up.`);

      for (const project of projectBatch) {
        try {
          // Delete all associated files from R2 first
          const urls = [
            project.original_image_url,
            project.generated_image_url,
            project.upscaled_image_url,
            project.svg_url,
            project.zip_url,
          ];
          for (const url of urls) {
            if (url && url !== 'REFUNDED') {
              await deleteFromR2(url, { allowedPrefixes: ['users/', `projects/${project.id}/`, 'bg-removed-'] });
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
        Prefix: 'users/',
        MaxKeys: MOBILE_SCAN_LIMIT,
      });
      const listResult = await s3Client.send(listCmd);
      results.hasMoreMobileSync = Boolean(listResult.IsTruncated);

      if (listResult.Contents) {
        for (const obj of listResult.Contents) {
          if (results.mobileSyncDeleted >= MOBILE_DELETE_LIMIT) {
            results.hasMoreMobileSync = true;
            break;
          }
          if (obj.Key?.includes('/mobile_sync/') && obj.LastModified && obj.LastModified.toISOString() < oneDayAgo) {
            await deleteFromR2(`${process.env.CLOUDFLARE_PUBLIC_URL}/${obj.Key}`, { allowedPrefixes: ['users/'] });
            results.mobileSyncDeleted++;
            console.log(`[Cron] Purged orphaned mobile_sync file: ${obj.Key}`);
          }
        }
      }
    } catch (mobileErr) {
      // Non-fatal: log but don't fail the whole cron job
      console.warn('[Cron] Mobile sync cleanup failed (non-fatal):', mobileErr.message);
    }

    // ─── 3. Delete cached ZIP files older than 24 hours ───────────────────────
    try {
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: zipProjects, error: zipFetchErr } = await adminSupabase
        .from('projects')
        .select('id, zip_url')
        .not('zip_url', 'is', null)
        .lt('zip_generated_at', oneDayAgo)
        .order('zip_generated_at', { ascending: true })
        .limit(ZIP_BATCH_LIMIT + 1);

      if (zipFetchErr) throw zipFetchErr;
      const zipBatch = (zipProjects || []).slice(0, ZIP_BATCH_LIMIT);
      results.hasMoreZipCache = (zipProjects || []).length > ZIP_BATCH_LIMIT;

      for (const project of zipBatch) {
        await deleteFromR2(project.zip_url, { allowedPrefixes: [`projects/${project.id}/`] });
        await adminSupabase
          .from('projects')
          .update({ zip_url: null, zip_signature: null, zip_generated_at: null })
          .eq('id', project.id);
        results.zipCacheDeleted++;
      }
    } catch (zipErr) {
      console.warn('[Cron] ZIP cache cleanup failed (non-fatal):', zipErr.message);
    }

    console.log(`[Cron] Done. Projects deleted: ${results.projectsDeleted}, failed: ${results.projectsFailed}, mobile files purged: ${results.mobileSyncDeleted}, ZIP cache purged: ${results.zipCacheDeleted}`);
    return NextResponse.json({ success: true, ...results });

  } catch (error) {
    console.error('[Cron Error]:', error);
    return NextResponse.json({ error: 'Cleanup failed', ...results }, { status: 500 });
  }
}
