export const IMAGE_UPLOAD_MAX_BYTES = 20 * 1024 * 1024;
export const STANDARD_IMAGE_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

export function formatUploadLimit(bytes) {
  return `${Math.round(bytes / 1024 / 1024)}MB`;
}

export function resolveImageUploadLimit({ purpose } = {}) {
  return purpose === "bg_remover" ? IMAGE_UPLOAD_MAX_BYTES : STANDARD_IMAGE_UPLOAD_MAX_BYTES;
}

export function validateImageUploadRequest({ contentType, fileSize, purpose } = {}) {
  const allowedContentTypes = [
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/avif",
    "image/bmp",
    "image/tiff",
  ];

  const normalizedType = String(contentType || "").toLowerCase();
  if (!allowedContentTypes.includes(normalizedType)) {
    return { ok: false, status: 400, error: "Invalid file type. Only images are allowed." };
  }

  const size = Number(fileSize);
  if (!Number.isFinite(size) || size <= 0) {
    return { ok: false, status: 400, error: "Missing or invalid file size." };
  }

  const maxBytes = resolveImageUploadLimit({ purpose });
  if (size > maxBytes) {
    return {
      ok: false,
      status: 413,
      error: `File is too large. Maximum allowed size is ${formatUploadLimit(maxBytes)}.`,
      maxBytes,
    };
  }

  return { ok: true, maxBytes, fileSize: size, contentType: normalizedType };
}
