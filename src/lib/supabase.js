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

// Atomic credit refund using optimistic locking retry loop
export async function safeRefundCredit(userId) {
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
      .update({ credits: profile.credits + 1 })
      .eq('id', userId)
      .eq('credits', profile.credits)
      .select();
      
    if (!updateErr && updatedData && updatedData.length > 0) {
      return true; // Success
    }
    retries--;
  }
  return false;
}
