"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import ImageToolEntryScreen from "@/components/image-tools/ImageToolEntryScreen";
import { BG_REMOVER_TOOL } from "@/components/image-tools/toolPresets";
import styles from "@/components/image-tools/image-tool.module.css";
import StudioShell from "@/components/shared/StudioShell";
import DesktopRequiredNotice from "@/components/shared/DesktopRequiredNotice";
import { useIsMobileDevice } from "@/hooks/useIsMobileDevice";
import { useAppRouter } from "@/hooks/useAppRouter";
import useBgRemoverUpload from "@/hooks/useBgRemoverUpload";
import { createClient } from "@/utils/supabase/client";
import "@/components/image-tools/image-tool-workspace.css";

const LoginModal = dynamic(() => import("@/components/marketing/LoginModal"), { ssr: false });
const TopUpModal = dynamic(() => import("@/components/ui/TopUpModal"), { ssr: false });
const supabase = createClient();

export default function BgRemoverEntry() {
  const router = useAppRouter();
  const isMobileDevice = useIsMobileDevice();
  const [comparePosition, setComparePosition] = useState(50);
  const [credits, setCredits] = useState(null);
  const [user, setUser] = useState(null);
  const [showLogin, setShowLogin] = useState(false);
  const [showTopUp, setShowTopUp] = useState(false);
  const requireLogin = useCallback(() => setShowLogin(true), []);
  const { retryPendingUpload, ...upload } = useBgRemoverUpload({ onRequireLogin: requireLogin });

  useEffect(() => {
    if (isMobileDevice !== false) return;
    let active = true;
    async function refreshUser(session) {
      if (!active) return;
      setUser(session?.user || null);
      if (session?.user) {
        const { data } = await supabase.from("profiles").select("credits").eq("id", session.user.id).single();
        if (active) setCredits(data?.credits ?? null);
      } else setCredits(null);
    }
    void supabase.auth.getSession().then(({ data }) => refreshUser(data.session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      // Leave the auth callback before querying Supabase or retrying an upload.
      setTimeout(() => {
        if (!active) return;
        void refreshUser(session);
        if (session) { setShowLogin(false); retryPendingUpload(); }
      }, 0);
    });
    return () => { active = false; subscription.unsubscribe(); };
  }, [isMobileDevice, retryPendingUpload]);

  if (isMobileDevice !== false) return <DesktopRequiredNotice />;

  return (
    <>
      <StudioShell
        className={`image-tool-workspace-ui ${styles.toolShell}`}
        title="BG REMOVER"
        credits={credits}
        onHome={() => router.push("/")}
        onCreditsClick={() => user ? setShowTopUp(true) : setShowLogin(true)}
        statusLeft={<span>{upload.isUploading ? "Uploading source image…" : "Waiting for image"}</span>}
      >
        <input {...upload.inputProps} />
        <main className={styles.entryViewport} aria-label="Choose artwork for background removal" {...upload.dropProps}>
          <ImageToolEntryScreen
            tool={BG_REMOVER_TOOL}
            comparePosition={comparePosition}
            onCompareChange={(event) => setComparePosition(Number(event.currentTarget.value))}
            onChooseFile={upload.chooseFile}
            isUploading={upload.isUploading}
          />
        </main>
      </StudioShell>
      <LoginModal show={showLogin} onClose={() => setShowLogin(false)} supabase={supabase} />
      {showTopUp && <TopUpModal user={user} onClose={() => setShowTopUp(false)} />}
    </>
  );
}
