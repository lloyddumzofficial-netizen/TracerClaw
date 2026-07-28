import { NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase";

export async function requireUser(request, options = {}) {
  const {
    missingMessage = "Unauthorized",
    invalidMessage = "Unauthorized: invalid session",
  } = options;

  const authHeader = request.headers.get("authorization");
  if (!authHeader) {
    return {
      user: null,
      token: null,
      response: NextResponse.json({ error: missingMessage }, { status: 401 }),
    };
  }

  const token = authHeader.replace("Bearer ", "").trim();
  if (!token || token === "undefined") {
    return {
      user: null,
      token,
      response: NextResponse.json({ error: invalidMessage }, { status: 401 }),
    };
  }

  const { data: { user }, error } = await adminSupabase.auth.getUser(token);
  if (error || !user) {
    return {
      user: null,
      token,
      response: NextResponse.json({ error: invalidMessage }, { status: 401 }),
    };
  }

  return { user, token, response: null };
}

export async function requireAdmin(request, options = {}) {
  const {
    forbiddenMessage = "Forbidden. Admin access required.",
  } = options;

  const auth = await requireUser(request, {
    missingMessage: "Unauthorized",
    invalidMessage: "Forbidden. Admin access required.",
  });
  if (auth.response) return auth;

  const adminEmail = process.env.ADMIN_EMAIL;
  const isAdmin = Boolean(
    adminEmail &&
    auth.user?.email &&
    auth.user.email.toLowerCase() === adminEmail.toLowerCase()
  );

  if (!isAdmin) {
    return {
      ...auth,
      response: NextResponse.json({ error: forbiddenMessage }, { status: 403 }),
    };
  }

  return auth;
}
