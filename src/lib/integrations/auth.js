import { NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase";

export async function requireBearerUser(request) {
  if (!adminSupabase) {
    return {
      error: NextResponse.json({ error: "Server database client is not configured" }, { status: 503 }),
    };
  }

  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const { data: { user }, error } = await adminSupabase.auth.getUser(token);
  if (error || !user) {
    return { error: NextResponse.json({ error: "Unauthorized: invalid session" }, { status: 401 }) };
  }

  return { user };
}
