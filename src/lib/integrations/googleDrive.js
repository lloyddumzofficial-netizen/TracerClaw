import { adminSupabase } from "@/lib/supabase";
import { createHash, randomUUID } from "node:crypto";
import { decryptSecret, encryptSecret, integrationsCryptoConfigured } from "@/lib/integrations/crypto";
import { buildProjectExportAssets, fetchOwnedProjectAsset, safeExportName } from "@/lib/integrations/files";
import { logger } from "@/lib/logger";

const DRIVE_SCOPE = "openid email https://www.googleapis.com/auth/drive.file";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const USERINFO_ENDPOINT = "https://www.googleapis.com/oauth2/v2/userinfo";
const DRIVE_FILES_ENDPOINT = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD_ENDPOINT = "https://www.googleapis.com/upload/drive/v3/files";
const DRIVE_EXPORT_SIGNATURE_VERSION = "gdrive:v2";

export function googleDriveConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && integrationsCryptoConfigured());
}

function getDriveApiEnableUrl() {
  const projectNumber = process.env.GOOGLE_CLIENT_ID?.split("-")[0];
  const url = new URL("https://console.developers.google.com/apis/api/drive.googleapis.com/overview");
  if (projectNumber) url.searchParams.set("project", projectNumber);
  return url.href;
}

function isLocalOrigin(origin) {
  try {
    const hostname = new URL(origin).hostname;
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}

export function getGoogleRedirectUri(origin) {
  const baseUrl = isLocalOrigin(origin)
    ? origin
    : process.env.GOOGLE_REDIRECT_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || origin;

  return `${baseUrl.replace(/\/+$/, "")}/api/integrations/google-drive/callback`;
}

export function buildGoogleAuthUrl({ state, origin }) {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", process.env.GOOGLE_CLIENT_ID);
  url.searchParams.set("redirect_uri", getGoogleRedirectUri(origin));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", DRIVE_SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  return url;
}

export async function exchangeCodeForTokens({ code, origin }) {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: getGoogleRedirectUri(origin),
      grant_type: "authorization_code",
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error_description || data.error || "Google token exchange failed");
  if (!data.refresh_token) throw new Error("Google did not return a refresh token. Please reconnect and allow Drive access.");
  return data;
}

export async function refreshGoogleAccessToken(refreshToken) {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) throw new Error(data.error_description || data.error || "Google refresh failed");
  return data.access_token;
}

export async function getGoogleUserEmail(accessToken) {
  const response = await fetch(USERINFO_ENDPOINT, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) return null;
  const data = await response.json();
  return data.email || null;
}

async function googleJson(accessToken, url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      ...(init.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data.error?.message || data.error || "Google Drive request failed";
    const reason = data.error?.errors?.[0]?.reason || data.error?.status || "";
    const error = new Error(message);
    if (/accessNotConfigured|SERVICE_DISABLED/i.test(reason) || /has not been used|is disabled/i.test(message)) {
      error.code = "GOOGLE_DRIVE_API_DISABLED";
      error.actionUrl = getDriveApiEnableUrl();
    }
    throw error;
  }
  return data;
}

async function createDriveFolder(accessToken, name, parentId) {
  const metadata = {
    name,
    mimeType: "application/vnd.google-apps.folder",
    ...(parentId ? { parents: [parentId] } : {}),
  };
  const folder = await googleJson(accessToken, `${DRIVE_FILES_ENDPOINT}?fields=id,name,webViewLink`, {
    method: "POST",
    body: JSON.stringify(metadata),
  });
  return folder;
}

function escapeDriveQueryString(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function findDriveFolder(accessToken, name, parentId) {
  const clauses = [
    "mimeType = 'application/vnd.google-apps.folder'",
    `name = '${escapeDriveQueryString(name)}'`,
    "trashed = false",
  ];
  if (parentId) clauses.push(`'${escapeDriveQueryString(parentId)}' in parents`);

  const url = new URL(DRIVE_FILES_ENDPOINT);
  url.searchParams.set("q", clauses.join(" and "));
  url.searchParams.set("spaces", "drive");
  url.searchParams.set("fields", "files(id,name,webViewLink)");
  url.searchParams.set("pageSize", "1");

  const data = await googleJson(accessToken, url.href, { method: "GET" });
  return data.files?.[0] || null;
}

async function getDriveFolderById(accessToken, folderId) {
  if (!folderId) return null;
  try {
    return await googleJson(accessToken, `${DRIVE_FILES_ENDPOINT}/${encodeURIComponent(folderId)}?fields=id,name,webViewLink,trashed`, {
      method: "GET",
    });
  } catch {
    return null;
  }
}

async function getOrCreateDriveFolder(accessToken, name, parentId) {
  return await findDriveFolder(accessToken, name, parentId) || await createDriveFolder(accessToken, name, parentId);
}

function getDriveFolderUrl(folder) {
  if (!folder?.id) return null;
  return folder.webViewLink || `https://drive.google.com/drive/folders/${folder.id}`;
}

function getProjectFolderSuffix(project) {
  const stableId = String(project?.id || randomUUID()).replace(/[^\w-]+/g, "").slice(0, 8);
  const rawDate = project?.created_at || project?.updated_at || new Date().toISOString();
  const date = Number.isNaN(Date.parse(rawDate))
    ? new Date().toISOString().slice(0, 10)
    : new Date(rawDate).toISOString().slice(0, 10);

  return `${date} - ${stableId}`;
}

function getDriveProjectFolderName(project) {
  const baseName = safeExportName(project?.name);
  return `${baseName} - ${getProjectFolderSuffix(project)}`;
}

function isLegacySharedProjectFolder(folder, project) {
  return folder?.name === safeExportName(project?.name);
}

export function createDriveExportSignature(project) {
  const assets = buildProjectExportAssets(project).map(({ name, url }) => ({ name, url }));
  const digest = createHash("sha256")
    .update(JSON.stringify({
      version: DRIVE_EXPORT_SIGNATURE_VERSION,
      projectFolderName: getDriveProjectFolderName(project),
      assets,
    }))
    .digest("hex");
  return `${DRIVE_EXPORT_SIGNATURE_VERSION}:${digest}`;
}

export function projectDriveExportIsCurrent(project) {
  return Boolean(
    project?.google_drive_folder_url &&
    project?.google_drive_export_signature &&
    project.google_drive_export_signature === createDriveExportSignature(project)
  );
}

async function uploadMultipartFile(accessToken, { name, parentId, buffer, contentType }) {
  const boundary = `desaynclaw_${randomUUID()}`;
  const metadata = {
    name,
    ...(parentId ? { parents: [parentId] } : {}),
  };
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`),
    Buffer.from(`--${boundary}\r\ncontent-type: ${contentType || "application/octet-stream"}\r\n\r\n`),
    buffer,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);

  const response = await fetch(`${DRIVE_UPLOAD_ENDPOINT}?uploadType=multipart&fields=id,name,webViewLink`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": `multipart/related; boundary=${boundary}`,
      "content-length": String(body.length),
    },
    body,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || data.error || "Google Drive upload failed");
  return data;
}

export async function saveGoogleDriveConnection(userId, { refreshToken, accessToken, email }) {
  const { error } = await adminSupabase
    .from("user_integrations")
    .upsert({
      user_id: userId,
      google_drive_refresh_token_enc: encryptSecret(refreshToken),
      google_drive_email: email || await getGoogleUserEmail(accessToken),
      google_drive_connected_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
  if (error) throw error;
}

export async function disconnectGoogleDrive(userId) {
  const { error } = await adminSupabase
    .from("user_integrations")
    .update({
      google_drive_refresh_token_enc: null,
      google_drive_email: null,
      google_drive_folder_id: null,
      google_drive_connected_at: null,
    })
    .eq("user_id", userId);
  if (error) throw error;
}

function isMissingDriveColumnError(error) {
  const message = `${error?.code || ""} ${error?.message || ""} ${error?.details || ""}`;
  return /google_drive_|schema cache|column/i.test(message);
}

export async function exportProjectToGoogleDrive({ userId, project, persistProjectExport = true }) {
  if (!googleDriveConfigured()) {
    throw new Error("Google Drive integration is not configured.");
  }

  const exportSignature = createDriveExportSignature(project);
  if (projectDriveExportIsCurrent(project)) {
    return {
      alreadySaved: true,
      folderId: project.google_drive_folder_id || null,
      folderUrl: project.google_drive_folder_url,
      exportSignature,
      files: [],
    };
  }

  const { data: settings, error } = await adminSupabase
    .from("user_integrations")
    .select("google_drive_refresh_token_enc, google_drive_folder_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!settings?.google_drive_refresh_token_enc) {
    throw new Error("Google Drive is not connected.");
  }

  const accessToken = await refreshGoogleAccessToken(decryptSecret(settings.google_drive_refresh_token_enc));
  let rootFolder = settings.google_drive_folder_id
    ? await getDriveFolderById(accessToken, settings.google_drive_folder_id)
    : null;

  if (!rootFolder?.id || rootFolder.trashed) {
    rootFolder = await getOrCreateDriveFolder(accessToken, "DesaynClaw Exports");
    await adminSupabase
      .from("user_integrations")
      .update({ google_drive_folder_id: rootFolder.id })
      .eq("user_id", userId);
  }

  let projectFolder = project.google_drive_folder_id
    ? await getDriveFolderById(accessToken, project.google_drive_folder_id)
    : null;

  if (!projectFolder?.id || projectFolder.trashed || isLegacySharedProjectFolder(projectFolder, project)) {
    projectFolder = await getOrCreateDriveFolder(accessToken, getDriveProjectFolderName(project), rootFolder.id);
  }

  const assets = buildProjectExportAssets(project);
  if (!assets.length) throw new Error("No project files are ready to export.");

  logger.info("[Google Drive] Export started", {
    userId,
    projectId: project.id,
    assetCount: assets.length,
    projectFolderId: projectFolder.id,
  });

  const files = [];
  for (const asset of assets) {
    const fetched = await fetchOwnedProjectAsset(asset, { userId, projectId: project.id });
    files.push(await uploadMultipartFile(accessToken, {
      name: asset.name,
      parentId: projectFolder.id,
      buffer: fetched.buffer,
      contentType: fetched.contentType,
    }));
  }

  logger.info("[Google Drive] Export completed", {
    userId,
    projectId: project.id,
    fileCount: files.length,
    projectFolderId: projectFolder.id,
  });

  const result = {
    folderId: projectFolder.id,
    folderUrl: getDriveFolderUrl(projectFolder),
    rootFolderId: rootFolder.id,
    rootFolderUrl: getDriveFolderUrl(rootFolder),
    exportSignature,
    files,
  };

  if (persistProjectExport) {
    const { error: updateError } = await adminSupabase
      .from("projects")
      .update({
        google_drive_folder_id: result.folderId,
        google_drive_folder_url: result.folderUrl,
        google_drive_exported_at: new Date().toISOString(),
        google_drive_export_signature: exportSignature,
      })
      .eq("id", project.id)
      .eq("user_id", userId);
    if (updateError) {
      if (!isMissingDriveColumnError(updateError)) throw updateError;
      logger.warn("[Google Drive] Export succeeded but project persistence columns are missing", {
        userId,
        projectId: project.id,
        error: updateError,
      });
      result.persistenceSaved = false;
      result.persistenceWarning = "Google Drive export saved, but the database migration must be applied to remember this folder after refresh.";
    } else {
      result.persistenceSaved = true;
    }
  } else {
    result.persistenceSaved = false;
    result.persistenceWarning = "Google Drive export saved, but the database migration must be applied to remember this folder after refresh.";
  }

  return result;
}
