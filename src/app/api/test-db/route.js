import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  const { data, error } = await supabase.from('projects').select('*').order('created_at', { ascending: false }).limit(1).single();
  if (error) return NextResponse.json({ error: error.message });
  return NextResponse.json({ url: data.original_image_url, svg: data.svg_url });
}
