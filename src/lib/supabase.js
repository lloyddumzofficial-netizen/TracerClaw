import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Singleton Pattern — caches clients on the global object across ALL environments
// (including Vercel production serverless warm instances) to prevent DB connection exhaustion.
const globalForSupabase = globalThis;

export const supabase =
  globalForSupabase._supabaseClient ??
  (globalForSupabase._supabaseClient = createClient(supabaseUrl, supabaseAnonKey));

export const adminSupabase =
  globalForSupabase._adminSupabaseClient ??
  (globalForSupabase._adminSupabaseClient = supabaseServiceKey
    ? createClient(supabaseUrl, supabaseServiceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null);

// Optimistic-lock retries used to re-run instantly, so two concurrent requests
// would simply re-collide and burn the whole retry budget in microseconds.
// Small jittered backoff gives the competing write time to land.
function backoff(attempt) {
  const base = 40 * (attempt + 1);
  return new Promise(resolve => setTimeout(resolve, base + Math.random() * 40));
}

// Atomic credit deduction using optimistic locking retry loop.
// Returns false when the user does not have enough credits or a concurrent
// request wins the update race.
export async function safeDeductCredit(userId, amount = 1) {
  let retries = 3;
  while (retries > 0) {
    const { data: profile } = await adminSupabase
      .from('profiles')
      .select('credits')
      .eq('id', userId)
      .single();

    if (!profile || profile.credits < amount) return false;

    const { error: updateErr, data: updatedData } = await adminSupabase
      .from('profiles')
      .update({ credits: profile.credits - amount })
      .eq('id', userId)
      .eq('credits', profile.credits)
      .select();

    if (!updateErr && updatedData && updatedData.length > 0) {
      return true;
    }
    retries--;
    if (retries > 0) await backoff(3 - retries);
  }
  console.error(`[Billing] safeDeductCredit exhausted retries for user ${userId}`);
  return false;
}

// Atomic credit refund using optimistic locking retry loop
export async function safeRefundCredit(userId, amount = 1) {
  let retries = 3;
  while (retries > 0) {
    const { data: profile } = await adminSupabase
      .from('profiles')
      .select('credits')
      .eq('id', userId)
      .single();
      
    if (!profile) return false;
    
    const { error: updateErr, data: updatedData } = await adminSupabase
      .from('profiles')
      .update({ credits: profile.credits + amount })
      .eq('id', userId)
      .eq('credits', profile.credits)
      .select();
      
    if (!updateErr && updatedData && updatedData.length > 0) {
      return true; // Success
    }
    retries--;
    if (retries > 0) await backoff(3 - retries);
  }
  // Callers MUST check this. Returning false means the credit did not move.
  console.error(`[Billing] safeRefundCredit exhausted retries for user ${userId} — credit NOT restored`);
  return false;
}
