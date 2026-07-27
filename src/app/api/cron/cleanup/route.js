import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { deleteFromR2, s3Client, bucketName, uploadToR2 } from '@/lib/cloudflare';
import { ListObjectsV2Command } from '@aws-sdk/client-s3';
import { safeRefundCredit } from '@/lib/supabase';
import {
  DEFAULT_MAX_UPSCALED_IMAGE_BYTES,
  fetchWithSSRFProtection,
  getAllowedProviderHosts,
} from '@/lib/ssrf';
import { logger } from '@/lib/logger';

// Ensure this route doesn't run at the Edge since it uses AWS SDK heavily
export const runtime = 'nodejs';
export const maxDuration = 60;

const PROJECT_BATCH_LIMIT = 10;
const MOBILE_SCAN_LIMIT = 250;
const MOBILE_DELETE_LIMIT = 25;
const ZIP_BATCH_LIMIT = 25;
const UPSCALE_RECONCILE_LIMIT = 20;
// A queued AuraSR job finishes in seconds to a couple of minutes. Anything
// still unresolved after this long was abandoned by the client and will never
// be reconciled, because nothing but the browser poll ever checks it.
const UPSCALE_STALE_MINUTES = 30;
const UPSCALE_ENDPOINT = 'fal-ai/aura-sr';

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Settle standalone upscales that the client abandoned.
 *
 * /api/upscale deducts a claw, submits to the fal queue and returns
 * immediately; completion is only ever recorded by the browser polling
 * /api/upscale?requestId=... So if the user closes the tab, the claw is spent,
 * generated_image_url stays null, no failure is stamped and no refund path ever
 * fires — the claw is silently lost. Nothing server-side reconciled these.
 *
 * Marking a stale job refunded also makes it terminal: the GET handler treats
 * refunded / 'REFUNDED' as failed, so a late completion cannot also be
 * delivered on top of the refund.
 */
async function reconcileAbandonedUpscales(results) {
  const staleBefore = new Date(Date.now() - UPSCALE_STALE_MINUTES * 60_000).toISOString();

  const { data: stale, error: staleErr } = await adminSupabase
    .from('projects')
    .select('id, user_id, ai_prompt, credit_deducted, refunded')
    .eq('trace_type', 'upscale')
    .is('generated_image_url', null)
    .eq('refunded', false)
    .lt('created_at', staleBefore)
    .order('created_at', { ascending: true })
    .limit(UPSCALE_RECONCILE_LIMIT);

  if (staleErr) throw staleErr;
  if (!stale || stale.length === 0) return;

  if (!process.env.FAL_KEY) {
    console.warn('[Cron] FAL_KEY missing — skipping upscale reconciliation');
    return;
  }
  const { fal } = await import('@fal-ai/client');

  for (const project of stale) {
    const requestId = project.ai_prompt?.startsWith(`fal:aura-sr:`)
      ? project.ai_prompt.slice('fal:aura-sr:'.length)
      : null;
    if (!requestId) continue;

    try {
      let recoveredUrl = null;
      try {
        const status = await fal.queue.status(UPSCALE_ENDPOINT, { requestId });
        if (status.status === 'COMPLETED') {
          const result = await fal.queue.result(UPSCALE_ENDPOINT, { requestId });
          const providerUrl = result?.data?.image?.url;
          if (providerUrl) {
            const { response, buffer } = await fetchWithSSRFProtection(providerUrl, {
              allowedHosts: getAllowedProviderHosts(),
              maxBytes: DEFAULT_MAX_UPSCALED_IMAGE_BYTES,
              allowedContentTypes: ['image/', 'application/octet-stream'],
            });
            if (response.ok) {
              const contentType = response.headers.get('content-type')?.split(';')[0] || 'image/png';
              const ext = contentType === 'image/jpeg' ? 'jpg' : (contentType.split('/')[1] || 'png');
              recoveredUrl = await uploadToR2(
                buffer,
                `projects/${project.id}/upscaled_${Date.now()}.${ext}`,
                contentType
              );
            }
          }
        }
      } catch (statusErr) {
        // Expired or unknown request id — treat as failed and refund below.
        console.warn(`[Cron] Upscale status lookup failed for ${project.id}:`, statusErr.message);
      }

      if (recoveredUrl) {
        await adminSupabase
          .from('projects')
          .update({ generated_image_url: recoveredUrl })
          .eq('id', project.id)
          .is('generated_image_url', null);
        results.upscalesRecovered++;
        logger.info('[Cron] Recovered abandoned upscale', { projectId: project.id });
        continue;
      }

      if (!project.credit_deducted) continue;

      const credited = await safeRefundCredit(project.user_id);
      if (!credited) {
        console.error(`[Cron] safeRefundCredit FAILED for abandoned upscale ${project.id} — left for retry.`);
        continue;
      }

      await adminSupabase
        .from('projects')
        .update({
          generated_image_url: 'REFUNDED',
          refunded: true,
          failed_at: new Date().toISOString(),
          failed_step: 'upscale',
        })
        .eq('id', project.id)
        .eq('refunded', false);

      await adminSupabase.from('credit_logs').insert({
        user_id: project.user_id,
        action: 'Refund (Abandoned Upscale)',
        amount: 1,
      });

      results.upscalesRefunded++;
      logger.info('[Cron] Refunded abandoned upscale', { projectId: project.id });
    } catch (err) {
      console.error(`[Cron] Upscale reconciliation error for ${project.id}:`, err);
    }
  }
}

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
    upscalesRecovered: 0,
    upscalesRefunded: 0,
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
      logger.info("[Cron] Found old projects to clean up", { count: projectBatch.length });

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
          logger.info("[Cron] Deleted project and files", { projectId: project.id });
        } catch (err) {
          results.projectsFailed++;
          console.error(`[Cron] Error deleting project ${project.id}:`, err);
        }
      }
    } else {
      logger.info("[Cron] No old projects found");
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
            logger.info("[Cron] Purged orphaned mobile sync file", { key: obj.Key });
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

    // ─── 4. Settle standalone upscales the client never polled to completion ──
    try {
      await reconcileAbandonedUpscales(results);
    } catch (upscaleErr) {
      console.warn('[Cron] Upscale reconciliation failed (non-fatal):', upscaleErr.message);
    }

    logger.info("[Cron] Done", results);
    return NextResponse.json({ success: true, ...results });

  } catch (error) {
    console.error('[Cron Error]:', error);
    return NextResponse.json({ error: 'Cleanup failed', ...results }, { status: 500 });
  }
}
