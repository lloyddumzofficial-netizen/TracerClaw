"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, ChevronDown, ExternalLink, FolderOpen, Loader2, PlugZap, Send, Unplug } from "lucide-react";
import { integrationFetch, saveProjectToGoogleDrive } from "@/lib/integrations/clientApi";
import GoogleDriveMark from "./GoogleDriveMark";
import styles from "./WorkspaceIntegrationsPanel.module.css";

export default function WorkspaceIntegrationsPanel({ project, variant = "inline", onDriveSaved }) {
  const [status, setStatus] = useState(null);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [message, setMessage] = useState("");
  const [driveResult, setDriveResult] = useState(null);
  const [driveAction, setDriveAction] = useState(null);
  const [busy, setBusy] = useState("");
  const [showWebhook, setShowWebhook] = useState(false);

  const projectReady = Boolean(project?.svg_url || project?.upscaled_image_url || project?.generated_image_url || project?.zip_url);
  const nextPath = useMemo(() => {
    if (typeof window === "undefined") return "/";
    return `${window.location.pathname}${window.location.search || ""}`;
  }, []);

  const loadStatus = useCallback(async () => {
    try {
      const data = await integrationFetch("/api/integrations/status", { method: "GET", headers: {} });
      setStatus(data);
      setWebhookUrl(data.webhook?.url || "");
    } catch (error) {
      setMessage(error.message || "Failed to load integrations.");
    }
  }, []);

  useEffect(() => {
    loadStatus();
    const onFocus = () => loadStatus();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [loadStatus]);

  const connectDrive = () => {
    window.location.href = `/api/integrations/google-drive/connect?next=${encodeURIComponent(nextPath)}`;
  };

  const disconnectDrive = async () => {
    setBusy("drive-disconnect");
    setMessage("");
    try {
      await integrationFetch("/api/integrations/google-drive/disconnect", { method: "POST", body: "{}" });
      await loadStatus();
      setMessage("Google Drive disconnected.");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy("");
    }
  };

  const exportToDrive = async () => {
    if (!project?.id) return;
    setBusy("drive-export");
    setMessage("");
    setDriveResult(null);
    setDriveAction(null);
    try {
      const data = await saveProjectToGoogleDrive(project.id);
      setDriveResult({
        folderUrl: data.folderUrl || data.rootFolderUrl || "",
        fileCount: data.files?.length || 0,
      });
      onDriveSaved?.(data);
      setMessage(`Saved ${data.files?.length || 0} file(s) to Google Drive.`);
    } catch (error) {
      if (error.code === "GOOGLE_DRIVE_API_DISABLED") {
        setDriveAction({
          title: "Enable Google Drive API",
          message: "Google Drive is connected, but the Drive API is still disabled in Google Cloud. Enable it once, wait 1–3 minutes, then click Save again.",
          url: error.actionUrl,
        });
        setMessage("");
      } else {
        setMessage(error.message);
      }
    } finally {
      setBusy("");
    }
  };

  const saveWebhook = async () => {
    setBusy("webhook-save");
    setMessage("");
    try {
      const data = await integrationFetch("/api/integrations/webhook", {
        method: "POST",
        body: JSON.stringify({ url: webhookUrl, enabled: true }),
      });
      await loadStatus();
      setMessage(`Webhook saved. Signing secret: ${data.webhook.signingSecret}`);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy("");
    }
  };

  const testWebhook = async () => {
    setBusy("webhook-test");
    setMessage("");
    try {
      await integrationFetch("/api/integrations/webhook", {
        method: "POST",
        body: JSON.stringify({ action: "test" }),
      });
      await loadStatus();
      setMessage("Webhook test delivered.");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy("");
    }
  };

  const disableWebhook = async () => {
    setBusy("webhook-disable");
    setMessage("");
    try {
      await integrationFetch("/api/integrations/webhook", { method: "DELETE", body: "{}" });
      await loadStatus();
      setMessage("Webhook disabled.");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy("");
    }
  };

  const driveConnected = Boolean(status?.googleDrive?.connected);
  const driveConfigured = status?.configured?.googleDrive !== false;
  const webhookConfigured = status?.webhook?.configured !== false;
  const driveFolderUrl = driveResult?.folderUrl || project?.google_drive_folder_url || "";

  const handleDriveButton = () => {
    if (driveFolderUrl) {
      window.open(driveFolderUrl, "_blank", "noopener,noreferrer");
      return;
    }
    exportToDrive();
  };

  return (
    <section className={`${styles.panel} ${variant === "popover" ? styles.popoverPanel : ""}`}>
      <div className={styles.header}>
        <span>Integrations</span>
        <PlugZap size={13} />
      </div>

      <div className={styles.block}>
        <div className={styles.row}>
          <div className={styles.logoBox}>
            <GoogleDriveMark className={styles.driveIcon} size={22} />
          </div>
          <div>
            <strong>Google Drive</strong>
            <small>{driveConnected ? status.googleDrive.email || "Connected" : driveConfigured ? "Save exports to Drive" : "Not configured"}</small>
          </div>
          {driveConnected && <CheckCircle2 size={13} className={styles.ok} />}
        </div>
        <div className={styles.actions}>
          {driveConnected ? (
            <>
              <button type="button" onClick={handleDriveButton} disabled={!driveFolderUrl && (!projectReady || busy === "drive-export")}>
                {busy === "drive-export" ? <Loader2 size={12} className={styles.spin} /> : <ExternalLink size={12} />}
                {busy === "drive-export" ? "Saving..." : driveFolderUrl ? "Open Drive Folder" : "Save to Drive"}
              </button>
              <button type="button" onClick={disconnectDrive} disabled={Boolean(busy)}>
                <Unplug size={12} />
              </button>
            </>
          ) : (
            <button type="button" onClick={connectDrive} disabled={!driveConfigured}>
              Connect Google Drive
            </button>
          )}
        </div>
      </div>

      <button
        type="button"
        className={`${styles.advancedToggle} ${showWebhook ? styles.open : ""}`}
        onClick={() => setShowWebhook(value => !value)}
      >
        <span>
          <Send size={12} />
          Advanced webhook
        </span>
        <ChevronDown size={13} />
      </button>

      {showWebhook && (
        <div className={styles.block}>
          <div className={styles.row}>
            <Send size={14} />
            <div>
              <strong>Webhook</strong>
              <small>{status?.webhook?.enabled ? "Auto-send when SVG is ready" : webhookConfigured ? "HTTPS endpoint + signed payload" : "Not configured"}</small>
            </div>
            {status?.webhook?.enabled && <CheckCircle2 size={13} className={styles.ok} />}
          </div>
          <input
            type="url"
            value={webhookUrl}
            onChange={(event) => setWebhookUrl(event.target.value)}
            placeholder="https://your-site.com/webhook"
            disabled={!webhookConfigured}
          />
          <div className={styles.actions}>
            <button type="button" onClick={saveWebhook} disabled={!webhookConfigured || !webhookUrl || busy === "webhook-save"}>
              {busy === "webhook-save" ? <Loader2 size={12} className={styles.spin} /> : null}
              Save
            </button>
            <button type="button" onClick={testWebhook} disabled={!status?.webhook?.enabled || busy === "webhook-test"}>
              Test
            </button>
            <button type="button" onClick={disableWebhook} disabled={!status?.webhook?.enabled || Boolean(busy)}>
              Off
            </button>
          </div>
        </div>
      )}

      {message && <p className={styles.message}>{message}</p>}
      {driveAction && (
        <div className={styles.fixCard}>
          <strong>{driveAction.title}</strong>
          <p>{driveAction.message}</p>
          {driveAction.url && (
            <a href={driveAction.url} target="_blank" rel="noreferrer">
              <ExternalLink size={12} />
              Open Google Cloud
            </a>
          )}
        </div>
      )}
      {driveFolderUrl && (
        <a
          className={styles.driveFolderLink}
          href={driveFolderUrl}
          target="_blank"
          rel="noreferrer"
        >
          <FolderOpen size={13} />
          Open Google Drive folder
        </a>
      )}
    </section>
  );
}
