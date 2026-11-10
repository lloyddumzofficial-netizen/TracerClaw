import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { canonicalTrialEmail, trialFingerprint } from '../../src/lib/welcomeTrialIdentity.mjs';

// Optional local Postgres/WASM engine. No connection to Supabase or production.
const enginePath = new URL('../../.tmp/trial-sql/node_modules/@electric-sql/pglite/dist/index.cjs', import.meta.url);
const sqlSuite = existsSync(enginePath) ? describe : describe.skip;
const secret = 'local-test-signing-secret-with-more-than-32-characters';
const hash = (kind, value) => trialFingerprint(kind, value, secret);
let db;
let historicalSnapshot;

sqlSuite('Google trial migration against disposable PostgreSQL', () => {
  beforeAll(async () => {
    const { PGlite } = createRequire(import.meta.url)(enginePath.pathname.replace(/^\/([A-Za-z]:)/, '$1'));
    db = new PGlite();
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE SCHEMA auth;
      CREATE TABLE auth.users(id uuid PRIMARY KEY, email text, created_at timestamptz DEFAULT now(), raw_app_meta_data jsonb);
      CREATE TABLE auth.identities(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES auth.users ON DELETE CASCADE,
        provider_id text, provider text, identity_data jsonb);
      CREATE TABLE public.profiles(id uuid PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE, email text, credits integer DEFAULT 0, created_at timestamptz DEFAULT now());
      CREATE TABLE public.credit_logs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, action text, amount integer);
    `);
    const old = readFileSync(new URL('../../database/migrations/030_secure_referrals.sql', import.meta.url), 'utf8');
    await db.exec(old.slice(0, old.indexOf('-- Seed durable project history')));
    const hardened = readFileSync(new URL('../../database/migrations/031_harden_referral_identity_and_qualification.sql', import.meta.url), 'utf8');
    await db.exec(hardened.slice(hardened.indexOf('CREATE OR REPLACE FUNCTION public.canonical_referral_email'), hardened.indexOf('CREATE OR REPLACE FUNCTION public.bind_referral')));
    const guard = readFileSync(new URL('../../database/migrations/033_require_google_for_referral_rewards.sql', import.meta.url), 'utf8');
    await db.exec(guard.slice(guard.indexOf('CREATE OR REPLACE FUNCTION'), guard.indexOf('-- Existing email-only')));
    const historicUser = randomUUID(); const owner = randomUUID(); const code = randomUUID(); const referral = randomUUID(); const credit = randomUUID();
    await db.query("INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES($1,'historic@gmail.com','{\"provider\":\"google\"}')", [historicUser]);
    await db.query("INSERT INTO public.profiles(id,email,credits) VALUES($1,'historic@gmail.com',7)", [historicUser]);
    await db.query("INSERT INTO public.referral_codes(id,owner_user_id,code_hash,code_prefix) VALUES($1,$2,'historic','DCHIST')", [code, owner]);
    await db.query(`INSERT INTO public.referrals(id,referral_code_id,referrer_user_id,referrer_email,invitee_user_id,invitee_email,
      invitee_email_domain,auth_provider,status,referral_issued_at,trial_granted_at,device_hash)
      VALUES($1,$2,$3,'owner@gmail.com',$4,'historic@gmail.com','gmail.com','google','trial_granted',now(),now(),'old-device')`, [referral, code, owner, historicUser]);
    await db.query("INSERT INTO public.referral_rewards(referral_id,recipient_user_id,reward_type,status,credit_log_reference) VALUES($1,$2,'invitee_trial','rewarded',$3)", [referral, historicUser, credit]);
    await db.query("INSERT INTO public.credit_logs(user_id,action,amount,reference_id) VALUES($1,'Referral trial Claw',1,$2)", [historicUser, credit]);
    await db.exec(readFileSync(new URL('../../database/migrations/037_google_welcome_trial.sql', import.meta.url), 'utf8'));
    historicalSnapshot = (await db.query(`SELECT p.credits,r.source,r.device_hash,r.credit_reference,
      (SELECT count(*)::integer FROM public.credit_logs) AS log_count,
      (SELECT enabled FROM public.welcome_trial_campaign) AS enabled
      FROM public.profiles p JOIN public.welcome_trial_receipts r ON r.user_id=p.id`)).rows[0];
  }, 30000);
  beforeEach(async () => {
    await db.exec(`TRUNCATE public.welcome_trial_claims, public.welcome_trial_intents, public.welcome_trial_daily,
      public.welcome_trial_receipts, public.welcome_trial_identity_blocks, public.credit_logs, auth.users,
      public.referral_codes, public.referrals, public.referral_rewards, public.referral_risk_signals, public.successful_project_events CASCADE;
      UPDATE public.welcome_trial_campaign SET enabled=true, launched_at=now()-interval '1 second', backfill_completed_at=now(),
        secret_check='${hash('config', 'v1')}', daily_limit=25;`);
  });
  afterAll(async () => { await db?.close(); });

  async function user({ email, provider = 'google', old = false, device = randomUUID(), subject = randomUUID() } = {}) {
    const id = randomUUID();
    email ||= `${id}@gmail.com`;
    await db.query(`INSERT INTO auth.users(id,email,created_at,raw_app_meta_data)
      VALUES($1,$2,now()-$3::interval,$4::jsonb)`, [id, email, old ? '2 days' : '0 seconds', JSON.stringify({ provider })]);
    await db.query('INSERT INTO public.profiles(id,email) VALUES($1,$2)', [id, email]);
    await db.query("INSERT INTO auth.identities(user_id,provider,provider_id,identity_data) VALUES($1,'google',$2,$3)", [id, subject, JSON.stringify({ email })]);
    return { id, subject, google: hash('google', subject), email: hash('email', canonicalTrialEmail(email)), device };
  }
  async function proof(u, { expired = false } = {}) {
    const nonce = randomUUID();
    await db.query('INSERT INTO public.welcome_trial_intents(nonce,device_hash,expires_at) VALUES($1,$2,now()+$3::interval)', [nonce, u.device, expired ? '-1 minute' : '20 minutes']);
    return nonce;
  }
  async function grant(u, nonce, override = {}) {
    const args = { ...u, ...override };
    const result = await db.query('SELECT * FROM public.grant_google_welcome_trial($1,$2,$3,$4,$5,$6,$7)',
      [args.id, args.subject, args.google, args.email, args.device, nonce || await proof(u), hash('config', 'v1')]);
    return result.rows[0];
  }
  async function count(table) { return Number((await db.query(`SELECT count(*) FROM public.${table}`)).rows[0].count); }
  async function bind(u, owner) {
    const code = hash('code', owner.id);
    await db.query('INSERT INTO public.referral_codes(owner_user_id,code_hash,code_prefix) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [owner.id, code, 'DC123']);
    return (await db.query('SELECT * FROM public.bind_referral_and_grant_trial($1,$2,$3,$4,$5,$6,$7,now(),false)',
      [code, u.id, `${u.id}@gmail.com`, 'gmail.com', 'google', u.device, 'shared-network'])).rows[0];
  }

  it('backfills historical referrals without changing existing credits and starts disabled', () => {
    expect(historicalSnapshot).toMatchObject({ credits: 7, source: 'legacy_referral', device_hash: 'old-device', log_count: 1, enabled: false });
    expect(historicalSnapshot.credit_reference).toBeTruthy();
  });

  it('awards one Claw, one log, one receipt and one quota slot', async () => {
    const u = await user();
    expect(await grant(u)).toMatchObject({ status: 'granted', reason: 'awarded', balance: 1 });
    expect(await grant(u)).toMatchObject({ status: 'granted', reason: 'already_granted', balance: 1 });
    expect(await count('credit_logs')).toBe(1);
    expect(await count('welcome_trial_receipts')).toBe(1);
    expect((await db.query('SELECT grants FROM public.welcome_trial_daily')).rows[0].grants).toBe(1);
    expect((await db.query('SELECT * FROM public.get_google_trial_status($1)', [u.id])).rows[0]).toMatchObject({ status: 'granted', balance: 1, source: 'welcome' });
  });
  it('does not accept replayed, expired or mismatched browser proof', async () => {
    const u = await user(); const nonce = await proof(u);
    await grant(u, nonce);
    expect((await grant(u, nonce)).reason).toBe('invalid_proof');
    expect((await grant(await user(), await proof(u))).reason).toBe('invalid_proof');
    const other = await user();
    expect((await grant(other, await proof(other, { expired: true }))).reason).toBe('invalid_proof');
  });
  it.each([{ provider: 'email' }, { old: true }, { email: 'person@example.com' }])('rejects ineligible account %j', async config => {
    expect((await grant(await user(config))).status).toBe('ineligible');
    expect(await count('credit_logs')).toBe(0);
  });
  it('blocks identity aliases, historical blocks and deleted-account recreation', async () => {
    const u = await user({ email: 'some.one@gmail.com' });
    await grant(u);
    await db.query('DELETE FROM auth.users WHERE id=$1', [u.id]);
    expect((await grant(await user({ subject: u.subject }))).reason).toBe('identity_already_used');
    expect((await grant(await user({ email: 'someone+tag@gmail.com' }))).reason).toBe('identity_already_used');
    const old = await user();
    await db.query("INSERT INTO public.welcome_trial_identity_blocks VALUES('google',$1)", [old.google]);
    expect((await grant(old)).reason).toBe('identity_already_used');
  });
  it('enforces 90-day browser limit without blocking a different browser on shared network', async () => {
    const u = await user(); await grant(u);
    expect((await grant(await user({ device: u.device }))).reason).toBe('browser_trial_used');
    expect((await grant(await user())).status).toBe('granted');
    await db.exec("UPDATE public.welcome_trial_receipts SET granted_at=now()-interval '91 days'");
    expect((await grant(await user({ device: u.device }))).status).toBe('granted');
  });
  it('awards exactly 25 of 30 competing requests; supports a next-day retry', async () => {
    const people = await Promise.all(Array.from({ length: 30 }, () => user()));
    const results = await Promise.all(people.map(u => grant(u)));
    expect(results.filter(r => r.reason === 'awarded')).toHaveLength(25);
    expect(results.filter(r => r.status === 'pending_allocation')).toHaveLength(5);
    const pending = people[results.findIndex(r => r.status === 'pending_allocation')];
    expect((await db.query('SELECT grants FROM public.welcome_trial_daily')).rows[0].grants).toBe(25);
    expect(new Date(results.find(r => r.retry_at).retry_at).getUTCHours()).toBe(0);
    // Move the exhausted bucket into the prior day without changing claim age.
    await db.exec("UPDATE public.welcome_trial_daily SET grant_date=grant_date-1");
    expect((await grant(pending)).reason).toBe('awarded');
  });
  it('uses one receipt for welcome and referral; preserves deferred attribution', async () => {
    const owner = await user({ old: true }); const u = await user();
    expect((await bind(u, owner)).status).toBe('bound');
    await db.exec('UPDATE public.welcome_trial_campaign SET daily_limit=1');
    await grant(await user());
    expect((await grant(u)).status).toBe('pending_allocation');
    await db.exec('UPDATE public.welcome_trial_campaign SET daily_limit=25');
    expect((await grant(u)).balance).toBe(1);
    expect((await bind(u, owner)).status).toBe('trial_granted');
    expect(await count('referral_rewards')).toBe(1);
    expect((await db.query('SELECT status FROM public.referrals')).rows[0].status).toBe('trial_granted');
    const later = await user(); await grant(later); await bind(later, owner);
    expect((await grant(later)).balance).toBe(1);
    expect(await count('referral_rewards')).toBe(2);
  });
  it('does not create a self-referral and still assesses welcome independently', async () => {
    const u = await user();
    expect((await bind(u, u)).status).toBe('rejected');
    expect(await count('referrals')).toBe(0);
    expect((await grant(u)).balance).toBe(1);
  });
  it('keeps a completed paid project eligible after quota deferral, with the full security hold', async () => {
    const owner = await user({ old: true }); const u = await user(); await bind(u, owner);
    await db.query("INSERT INTO public.successful_project_events(project_id,user_id,completion_kind) VALUES($1,$2,'svg')", [randomUUID(), u.id]);
    await grant(u);
    const referral = (await db.query('SELECT status, review_after FROM public.referrals')).rows[0];
    expect(referral.status).toBe('pending_review');
    expect(new Date(referral.review_after).getTime() - Date.now()).toBeGreaterThan(71 * 3600000);
    expect((await db.query("SELECT status FROM public.referral_rewards WHERE reward_type='referrer_completion'")).rows[0].status).toBe('pending');
    expect((await db.query('SELECT credits FROM public.profiles WHERE id=$1', [owner.id])).rows[0].credits).toBe(0);
  });
  it('rolls back the complete operation if the credit log fails', async () => {
    const u = await user(); const nonce = await proof(u);
    await db.exec(`CREATE FUNCTION public.reject_test_credit() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'test failure'; END; $$ LANGUAGE plpgsql;
      CREATE TRIGGER test_credit_failure BEFORE INSERT ON public.credit_logs FOR EACH ROW EXECUTE FUNCTION public.reject_test_credit();`);
    await expect(grant(u, nonce)).rejects.toThrow('test failure');
    expect(await count('welcome_trial_receipts')).toBe(0);
    expect((await db.query('SELECT credits FROM public.profiles WHERE id=$1', [u.id])).rows[0].credits).toBe(0);
    expect((await db.query('SELECT consumed_at FROM public.welcome_trial_intents WHERE nonce=$1', [nonce])).rows[0].consumed_at).toBeNull();
    await db.exec('DROP TRIGGER test_credit_failure ON public.credit_logs; DROP FUNCTION public.reject_test_credit()');
    expect((await grant(u, nonce)).balance).toBe(1);
  });
  it('keeps ledger tables and RPCs unavailable to browser roles', async () => {
    const result = await db.query("SELECT has_function_privilege('authenticated','public.grant_google_welcome_trial(uuid,text,text,text,text,uuid,text)','EXECUTE') AS allowed");
    expect(result.rows[0].allowed).toBe(false);
    await db.exec('SET ROLE anon');
    await expect(db.query('SELECT * FROM public.welcome_trial_receipts')).rejects.toThrow(/permission denied/);
    await db.exec('RESET ROLE');
  });
  it('fails closed when campaign is disabled or the signing secret drifts', async () => {
    await db.exec('UPDATE public.welcome_trial_campaign SET enabled=false');
    expect((await grant(await user())).status).toBe('temporarily_unavailable');
    await db.exec("UPDATE public.welcome_trial_campaign SET enabled=true, secret_check='changed'");
    expect((await grant(await user())).status).toBe('temporarily_unavailable');
    expect(await count('credit_logs')).toBe(0);
  });
});
