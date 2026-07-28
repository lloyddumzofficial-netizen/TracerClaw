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
