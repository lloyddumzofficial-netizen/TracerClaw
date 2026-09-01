"use client";

import { createClient } from "@/utils/supabase/client";

const supabase = createClient();

async function getAccessToken() {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || "";
}

export async function integrationFetch(url, options = {}) {
  const token = await getAccessToken();
  if (!token) throw new Error("Please sign in again.");

  const response = await fetch(url, {
    ...options,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "Request failed");
    error.code = data.code || null;
    error.actionUrl = data.actionUrl || null;
    throw error;
  }
  return data;
}

export function saveProjectToGoogleDrive(projectId) {
  return integrationFetch("/api/integrations/google-drive/export", {
    method: "POST",
    body: JSON.stringify({ projectId }),
  });
}
