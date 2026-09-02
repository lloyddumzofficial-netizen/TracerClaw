"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Archive, Boxes, CheckCircle2, Download, Loader2, Sparkles } from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { analytics } from "@/lib/analytics";
import { safeJson } from "@/lib/safeJson";
import { formatSavedAgo } from "@/lib/formatSavedAgo";
import DesktopRequiredNotice from "@/components/shared/DesktopRequiredNotice";
import LogoLoader from "@/components/ui/LogoLoader";
import StudioShell from "@/components/shared/StudioShell";
import { useIsMobileDevice } from "@/hooks/useIsMobileDevice";
import styles from "./ElementPackWorkspace.module.css";

const supabase = createClient();

function pickPreviewUrl(project) {
  return (
    (project?.upscaled_image_url && project.upscaled_image_url !== "REFUNDED" && project.upscaled_image_url) ||
    (project?.generated_image_url && project.generated_image_url !== "REFUNDED" && project.generated_image_url) ||
    project?.original_image_url
  );
}

function downloadFile(url, filename) {
  const link = document.createElement("a");
  const downloadUrl = new URL(`/api/proxy?url=${encodeURIComponent(url)}`, window.location.origin);
  downloadUrl.searchParams.set("download", filename);
  link.href = downloadUrl.toString();
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export default function ElementPackWorkspace() {
  const router = useRouter();
  const params = useParams();
  const projectId = params.id;
  const isMobileDevice = useIsMobileDevice();

  const [project, setProject] = useState(null);
  const [userCredits, setUserCredits] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [warningMsg, setWarningMsg] = useState("");

  useEffect(() => {
    if (isMobileDevice !== false || !projectId) return;

    let mounted = true;
    async function fetchData() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) {
          router.push("/");
          return;
        }

        analytics.authSession(session.user, { source: "element_pack" });

        const [{ data: projData, error: projError }, { data: profile }] = await Promise.all([
          supabase.from("projects").select("*").eq("id", projectId).eq("user_id", session.user.id).single(),
          supabase.from("profiles").select("credits").eq("id", session.user.id).single(),
        ]);

        if (projError || !projData) {
          router.push("/");
          return;
        }

        if (mounted) {
          setProject(projData);
          if (profile) setUserCredits(profile.credits);
        }
      } catch (err) {
        console.error("[Element Pack] Fetch failed", err);
        analytics.error(err, { area: "element_pack_fetch", project_id: projectId });
        if (mounted) setErrorMsg("Could not load this project.");
      }
    }

    fetchData();
    return () => {
      mounted = false;
    };
  }, [isMobileDevice, projectId, router]);

  const handleCreatePack = useCallback(async () => {
    if (!project?.id || isProcessing) return;
    setIsProcessing(true);
    setErrorMsg("");
    setWarningMsg("");

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Please sign in again before creating an element pack.");

      const res = await fetch("/api/element-pack", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ projectId: project.id }),
      });

      const data = await safeJson(res, "Failed to create element pack");
      if (!res.ok) throw new Error(data.error || "Failed to create element pack");

      setProject((prev) => prev ? ({
        ...prev,
        element_pack_url: data.zipUrl,
        element_pack_count: data.elementCount,
        element_pack_generated_at: new Date().toISOString(),
      }) : prev);
      if (data.warning) setWarningMsg(data.warning);
      analytics.trackEvent?.("element_pack_created", { project_id: project.id, cached: !!data.cached, element_count: data.elementCount });
    } catch (err) {
      console.error("[Element Pack] Create failed", err);
      analytics.error(err, { area: "element_pack_create", project_id: project?.id });
      setErrorMsg(err.message || "Failed to create element pack.");
    } finally {
      setIsProcessing(false);
    }
  }, [isProcessing, project]);

  const handleDownload = useCallback(async () => {
    if (!project?.element_pack_url || isDownloading) return;
    setIsDownloading(true);
    try {
      downloadFile(project.element_pack_url, `DesaynClaw_${project.name || "Untitled_Design"}_ElementPack.zip`);
      analytics.trackEvent?.("element_pack_download", { project_id: project.id });
    } finally {
      setIsDownloading(false);
    }
  }, [isDownloading, project]);

  if (isMobileDevice !== false) return <DesktopRequiredNotice />;

  if (!project) {
    return (
      <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0a0a0a" }}>
        <LogoLoader size={72} color="#FFD700" />
      </div>
    );
  }

  const previewUrl = pickPreviewUrl(project);
  const packReady = !!project.element_pack_url;
  const elementCount = Number(project.element_pack_count || 0);

  return (
    <StudioShell
      title="ELEMENT PACK"
      projectName={project.name}
      savedAgo={formatSavedAgo(project.updated_at)}
      credits={userCredits}
      onHome={() => router.push("/")}
      commandBar={(
        <div className="workspace-command-bar">
          <div className="workspace-command-group">
            <span className="workspace-command-label">Process</span>
            <button
              className="workspace-command-btn is-primary"
              onClick={handleCreatePack}
              disabled={isProcessing}
              title="Extract image elements into a ZIP pack"
            >
              {isProcessing ? <Loader2 size={14} className="animate-spin" /> : <Boxes size={14} />}
              {packReady ? "Rebuild Pack" : "Extract Elements"}
            </button>
          </div>
          <div className="workspace-command-spacer" />
          <div className="workspace-command-group">
            <span className="workspace-command-label">Export</span>
            <button
              className="workspace-command-btn is-primary"
              onClick={handleDownload}
              disabled={!packReady || isDownloading}
              title="Download transparent PNG element pack"
            >
              {isDownloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              ZIP Pack
            </button>
          </div>
        </div>
      )}
      statusLeft={packReady ? (
        <>
          <CheckCircle2 size={12} color="#4ade80" />
          <span style={{ color: "#4ade80" }}>Element pack ready</span>
          <small>{elementCount || "Multiple"} transparent PNG layer files available.</small>
        </>
      ) : (
        <>
          <Sparkles size={12} color="#FFD700" />
          <span>{isProcessing ? "Extracting elements..." : "Ready for element extraction"}</span>
        </>
      )}
    >
      <main className={styles.workspace}>
        <section className={styles.canvas}>
          <div className={styles.previewFrame}>
            {previewUrl ? (
              <img className={styles.previewImage} src={previewUrl} alt={project.name || "Project preview"} draggable={false} />
            ) : (
              <p className={styles.copy}>No source image available.</p>
            )}
          </div>
        </section>

        <aside className={styles.panel}>
          <div className={styles.panelHeader}>
            <span><Boxes size={14} /> Element Pack Settings</span>
          </div>

          <section className={styles.section}>
            <p className={styles.eyebrow}>Photoshop-ready</p>
            <h2 className={styles.title}>Pattern to elements</h2>
            <p className={styles.copy}>
              Extract visible design parts into separated transparent PNG files. Best for complex AI designs that need manual arranging in Photoshop.
            </p>

            <div className={styles.metricGrid}>
              <div className={styles.metric}>
                <strong>{packReady ? elementCount || "Ready" : "0"}</strong>
                <span>Elements</span>
              </div>
              <div className={styles.metric}>
                <strong>₱0</strong>
                <span>AI Cost</span>
              </div>
            </div>
          </section>

          <section className={styles.section}>
            <button className={styles.actionButton} onClick={handleCreatePack} disabled={isProcessing || !previewUrl}>
              {isProcessing ? <Loader2 size={14} className="animate-spin" /> : <Boxes size={14} />}
              {isProcessing ? "Extracting..." : packReady ? "Rebuild Element Pack" : "Extract Elements"}
            </button>
            <button className={styles.secondaryButton} onClick={handleDownload} disabled={!packReady || isDownloading}>
              {isDownloading ? <Loader2 size={14} className="animate-spin" /> : <Archive size={14} />}
              Download Layer Pack
            </button>

            {packReady && (
              <div className={styles.success}>
                Saved as a ZIP with transparent PNG elements, reference image, and manifest.
              </div>
            )}
            {warningMsg && <div className={styles.note}>{warningMsg}</div>}
            {errorMsg && <div className={styles.error}>{errorMsg}</div>}
            <div className={styles.note}>
              Rate limit: {10} packs per user per hour. This keeps the server and storage cost predictable without blocking normal use.
            </div>
          </section>

          <section className={styles.section}>
            <p className={styles.eyebrow}>Best results</p>
            <p className={styles.copy}>
              Use a clean extracted design or transparent PNG. If an image is one flattened connected object, Photoshop will still receive it as fewer larger elements.
            </p>
          </section>
        </aside>
      </main>
    </StudioShell>
  );
}
