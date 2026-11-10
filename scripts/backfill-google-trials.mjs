// Explicit operator action only; never run as part of build or deployment.
// node --env-file=.env.local scripts/backfill-google-trials.mjs --write
import { createClient } from '@supabase/supabase-js';
import { canonicalTrialEmail, trialFingerprint } from '../src/lib/welcomeTrialIdentity.mjs';

if (!process.argv.includes('--write')) throw new Error('Explicit --write is required. See docs/google-welcome-trial.md.');
const secret = process.env.REFERRAL_SECURITY_SECRET;
const secretCheck = trialFingerprint('config', 'v1', secret);
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
function checked(result) {
  if (result.error) throw new Error('Trial backfill database operation failed; campaign remains disabled.');
  return result.data;
}
const campaign = checked(await db.from('welcome_trial_campaign').select('*').eq('id', true).single());
if (campaign.enabled || campaign.launched_at) throw new Error('Backfill is only allowed before first launch.');
if (campaign.secret_check && campaign.secret_check !== secretCheck) throw new Error('Signing secret changed. Restore the original secret.');
// Bind the hash namespace before writing the first batch, including interrupted runs.
checked(await db.from('welcome_trial_campaign').update({ secret_check: secretCheck, backfill_completed_at: null }).eq('id', true));
let users = 0;
let legacyReferrals = 0;
async function block(rows) {
  const unique = [...new Map(rows.map(row => [`${row.kind}:${row.fingerprint}`, row])).values()];
  if (unique.length) checked(await db.from('welcome_trial_identity_blocks').upsert(unique, { onConflict: 'kind,fingerprint', ignoreDuplicates: true }));
}
for (let page = 1; ; page++) {
  const { users: batch } = checked(await db.auth.admin.listUsers({ page, perPage: 1000 }));
  const rows = [];
  for (const user of batch) {
    const email = canonicalTrialEmail(user.email);
    if (email) rows.push({ kind: 'email', fingerprint: trialFingerprint('email', email, secret) });
    for (const identity of user.identities || []) {
      const subject = identity.provider_id || identity.id;
      if (identity.provider === 'google' && subject) {
        rows.push({ kind: 'google', fingerprint: trialFingerprint('google', subject, secret) });
      }
    }
  }
  await block(rows);
  users += batch.length;
  if (batch.length < 1000) break;
}
for (let offset = 0; ; offset += 1000) {
  const batch = checked(await db.from('referrals').select('id,invitee_email').not('trial_granted_at', 'is', null)
    .order('id').range(offset, offset + 999));
  await block(batch.map(row => ({ kind: 'email', fingerprint: trialFingerprint('email', canonicalTrialEmail(row.invitee_email), secret) })));
  legacyReferrals += batch.length;
  if (batch.length < 1000) break;
}
checked(await db.from('welcome_trial_campaign').update({ backfill_completed_at: new Date().toISOString() })
  .eq('id', true).eq('enabled', false).is('launched_at', null).select('id').single());
checked(await db.rpc('cleanup_welcome_trial_intents'));
console.log(`Backfill complete: ${users} accounts and ${legacyReferrals} historical trials. No balances changed. Campaign is still disabled.`);
