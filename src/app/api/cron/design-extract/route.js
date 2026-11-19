import { NextResponse } from 'next/server';
import { maintainDesignWorkflows } from '@/server/designExtract/processing/launcher';
import { recoverDesignBilling } from '@/server/designExtract/billing';
import { recoverLegacyDesignJobs } from '@/server/designExtract/recovery';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const maxDuration = 60;

// A missed initial start must recover without an open browser. Keep this batch
// independent of expensive asset cleanup and unrelated product reconciliation.
export async function GET(request) {
  if (!process.env.CRON_SECRET || request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    await recoverDesignBilling();
    await maintainDesignWorkflows();
    await recoverLegacyDesignJobs();
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (process.env.DESIGN_EXTRACT_ENABLED !== 'true' && ['42P01', 'PGRST205'].includes(error.code)) return NextResponse.json({ enabled: false });
    logger.warn('[Design Extract watchdog] Recovery pending', { code: error.code || null });
    return NextResponse.json({ error: 'Recovery will retry' }, { status: 503 });
  }
}
