export async function uploadDesignFile({ file, token, allowServerFallback = process.env.NODE_ENV === "development" }) {
  const authorization = { Authorization: `Bearer ${token}` };
  const response = await fetch("/api/upload-url", { signal: AbortSignal.timeout(20000), method: "POST", headers: { ...authorization, "Content-Type": "application/json" }, body: JSON.stringify({ fileName: file.name, contentType: file.type, fileSize: file.size, purpose: "design_extract" }) });
  const uploaded = await response.json();
  if (!response.ok || !uploaded.uploadUrl || !uploaded.publicUrl) throw new Error(uploaded.error || "Could not prepare the upload.");
  try {
    const stored = await fetch(uploaded.uploadUrl, { signal: AbortSignal.timeout(120000), method: "PUT", headers: { "Content-Type": file.type }, body: file });
    if (!stored.ok) throw new Error("Storage upload failed");
    return uploaded.publicUrl;
  } catch {
    // Local Next.js can accept the full 20 MB request. Production must keep
    // large files on R2's direct upload path to avoid serverless body limits.
    if (!allowServerFallback) throw new Error("Direct storage upload was blocked. Check the R2 CORS policy for this site's origin and retry.");
    const form = new FormData(); form.append("file", file); form.append("purpose", "design_extract");
    const fallback = await fetch("/api/upload-direct", { signal: AbortSignal.timeout(65000), method: "POST", headers: authorization, body: form });
    const data = await fallback.json();
    if (!fallback.ok || !data.publicUrl) throw new Error(data.error || "Image upload failed. Please retry.");
    return data.publicUrl;
  }
}
