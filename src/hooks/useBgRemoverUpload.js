"use client";

import { useCallback, useRef, useState } from "react";
import { useAppRouter } from "@/hooks/useAppRouter";
import { createClient } from "@/utils/supabase/client";
import { compressImageClientSide } from "@/utils/imageUtils";
import { formatUploadLimit, resolveImageUploadLimit } from "@/lib/uploadLimits";
import { safeJson } from "@/lib/safeJson";
import { analytics } from "@/lib/analytics";
import { toast } from "@/components/ui/Toast";

const supabase = createClient();
const PURPOSE = "bg_remover";

async function uploadSource(token, file) {
  const response = await fetch("/api/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ fileName: file.name, contentType: file.type, fileSize: file.size, purpose: PURPOSE }),
  });
  const data = await safeJson(response, "Failed to get upload URL");
  if (!response.ok || !data.uploadUrl || !data.publicUrl) throw new Error(data.error || "Failed to get upload URL");

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const uploaded = await fetch(data.uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
      if (uploaded.ok) return data.publicUrl;
      if (![408, 429].includes(uploaded.status) && uploaded.status < 500) break;
    } catch { /* Use the existing server-upload fallback after direct upload retries. */ }
    if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 700));
  }

  const form = new FormData();
  form.append("file", file);
  form.append("purpose", PURPOSE);
  const fallback = await fetch("/api/upload-direct", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
  const fallbackData = await safeJson(fallback, "Fallback upload failed");
  if (!fallback.ok || !fallbackData.publicUrl) throw new Error(fallbackData.error || "Fallback upload failed");
  return fallbackData.publicUrl;
}

export default function useBgRemoverUpload({ onRequireLogin } = {}) {
  const router = useAppRouter();
  const inputRef = useRef(null);
  const busyRef = useRef(false);
  const pendingFileRef = useRef(null);
  const [isUploading, setIsUploading] = useState(false);

  const uploadFile = useCallback(async (file) => {
    if (!file || busyRef.current) return;
    if (!file.type.startsWith("image/")) { toast.error("Please choose an image file."); return; }
    const limit = resolveImageUploadLimit({ purpose: PURPOSE });
    if (file.size > limit) { toast.error(`Maximum file size is ${formatUploadLimit(limit)}.`); return; }
    busyRef.current = true;
    setIsUploading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        pendingFileRef.current = file;
        onRequireLogin?.();
        return;
      }
      let source = file;
      try { source = await compressImageClientSide(file, 2048, 0.85); } catch { /* Keep the original, as on the homepage. */ }
      if (source.size > limit) throw new Error(`Maximum file size is ${formatUploadLimit(limit)}.`);
      const imageUrl = await uploadSource(session.access_token, source);
      const response = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ imageUrl, projectName: source.name.replace(/\.[^/.]+$/, ""), traceType: PURPOSE }),
      });
      const data = await safeJson(response, "Project creation failed");
      if (!response.ok || !data.projectId) throw new Error(data.details || data.error || "Project creation failed");
      pendingFileRef.current = null;
      router.push(`/bg-remover/${data.projectId}`);
    } catch (error) {
      analytics.error(error, { area: "bg_remover_upload" });
      toast.error(error.message || "Failed to upload image.");
    } finally {
      busyRef.current = false;
      setIsUploading(false);
    }
  }, [onRequireLogin, router]);

  const retryPendingUpload = useCallback(() => {
    if (pendingFileRef.current) void uploadFile(pendingFileRef.current);
  }, [uploadFile]);

  return {
    isUploading,
    chooseFile: () => inputRef.current?.click(),
    retryPendingUpload,
    inputProps: {
      ref: inputRef, type: "file", accept: "image/png,image/jpeg,image/webp", hidden: true,
      onChange: (event) => { void uploadFile(event.target.files?.[0]); event.target.value = ""; },
    },
    dropProps: {
      onDragOver: (event) => event.preventDefault(),
      onDrop: (event) => { event.preventDefault(); void uploadFile(event.dataTransfer.files?.[0]); },
    },
  };
}
