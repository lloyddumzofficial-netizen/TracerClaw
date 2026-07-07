import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: 'd:/Phoostoshop-Tools/auto-tracer/.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  const { data, error } = await supabase.from('projects').select('*').eq('id', '8f085577-22e7-4448-b2ed-fe6d45c50d53').single();
  if (error) console.error(error);
  console.log(data);
}
check();
