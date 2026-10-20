"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { Check, Clock3, Copy, Gift, Link2, LoaderCircle, ShieldCheck, Users, X } from "lucide-react";
import { safeJson } from "@/lib/safeJson";
import { toast } from "@/components/ui/Toast";
import styles from "./ReferralModal.module.css";

export default function ReferralModal({ show, onClose, supabase }) {
  const [mounted, setMounted] = useState(show);
  const [isVisible, setIsVisible] = useState(false);
  const [summary, setSummary] = useState(null);
  const [status, setStatus] = useState("idle");
  const [isCreating, setIsCreating] = useState(false);
  const [copied, setCopied] = useState(false);
  const closeButtonRef = useRef(null);

  useEffect(() => {
    if (show) {
      setMounted(true);
      const frame = requestAnimationFrame(() => setIsVisible(true));
      return () => cancelAnimationFrame(frame);
    }

    setIsVisible(false);
    const timer = window.setTimeout(() => setMounted(false), 220);
    return () => window.clearTimeout(timer);
  }, [show]);

  const authorizedRequest = useCallback(async (url, options = {}) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error("Your session expired. Please sign in again.");
    return fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Bearer ${session.access_token}`,
      },
    });
  }, [supabase]);

  const loadSummary = useCallback(async () => {
    setStatus("loading");
    try {
      const response = await authorizedRequest("/api/referrals");
      const result = await safeJson(response, "Could not load referral information");
      if (!response.ok) throw new Error(result.error || "Could not load referral information.");
      setSummary(result);
      setStatus("ready");
    } catch (error) {
      setStatus("error");
      toast.error(error.message || "Could not load referral information.");
    }
  }, [authorizedRequest]);

  useEffect(() => {
    if (!show) return undefined;
    loadSummary();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = requestAnimationFrame(() => closeButtonRef.current?.focus());
    const handleKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [show, loadSummary, onClose]);

  const createLink = async () => {
    setIsCreating(true);
    try {
      const response = await authorizedRequest("/api/referrals/code", { method: "POST" });
      const result = await safeJson(response, "Could not create your referral link");
      if (!response.ok) throw new Error(result.error || "Could not create your referral link.");
      setSummary((current) => ({ ...current, code: result.code, link: result.link, codeEnabled: true }));
      toast.success("Your permanent referral link is ready.");
    } catch (error) {
      toast.error(error.message || "Could not create your referral link.");
    } finally {
      setIsCreating(false);
    }
  };

  const copyLink = async () => {
    if (!summary?.link) return;
    try {
      await navigator.clipboard.writeText(summary.link);
      setCopied(true);
      toast.success("Referral link copied.");
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Could not copy the link. Please copy it manually.");
    }
  };

  if (!mounted) return null;

  const cap = summary?.lifetimeCap || 3;
  const ageDays = summary?.eligibility?.accountAgeDays || 0;
  const completedProjects = summary?.eligibility?.completedProjects || 0;
  const referralActivity = summary?.referrals || [];
  const activityCount = referralActivity.length;
  const rewardedCount = referralActivity.filter((referral) => referral.status === "rewarded").length;
  const notEligibleCount = referralActivity.filter((referral) => referral.status === "rejected").length;
  const activeCount = activityCount - rewardedCount - notEligibleCount;

  return createPortal((
    <div className={`${styles.backdrop} ${isVisible ? styles.visible : ""}`} role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="referral-title">
        <header className={styles.header}>
          <div className={styles.topline}>
            <div className={styles.rewardPill}>Earn up to {cap} Claws total</div>
          </div>
          <button ref={closeButtonRef} type="button" className={styles.close} onClick={onClose} aria-label="Close referral program">
            <X size={18} aria-hidden="true" />
          </button>
          <div className={styles.introGrid}>
            <div>
              <h2 id="referral-title">Refer <em>&amp;</em> Earn</h2>
              <p>Invite another creative to DesaynClaw. They receive a trial Claw, and you earn one after their first verified project.</p>
            </div>
            <div className={styles.referralArt}>
              <Image
                src="/Claws/claw-coin-transparent.png"
                alt="DesaynClaw reward Claw"
                width={180}
                height={180}
                priority
              />
            </div>
          </div>
        </header>

        <div className={styles.body}>
          {status === "loading" && (
            <div className={styles.state}><LoaderCircle className={styles.spinner} size={22} /> Loading your referral account…</div>
          )}

          {status === "error" && (
            <div className={styles.state}>
              <span>Referral information could not be loaded.</span>
              <button type="button" onClick={loadSummary}>Try again</button>
            </div>
          )}

          {status === "ready" && summary?.enabled === false && (
            <div className={styles.state}>
              <Clock3 size={22} aria-hidden="true" />
              <strong>Referral access is not enabled yet.</strong>
              <span>The secure database is ready. Enable the referral environment settings to open the program.</span>
            </div>
          )}

          {status === "ready" && summary?.enabled !== false && (
            <>
              <div className={styles.flow} aria-label="How referral rewards work">
                <h3>How it works</h3>
                <div className={styles.flowRow}>
                  <span><Link2 size={15} /></span>
                  <div><strong>Share your invite link</strong><small>Your permanent link securely tracks the referral.</small></div>
                </div>
                <div className={styles.flowRow}>
                  <span><Users size={15} /></span>
                  <div><strong>Your friend receives <b>1 trial Claw</b></strong><small>Available after verified Google sign-in. Email-only accounts are excluded from referral rewards.</small></div>
                </div>
                <div className={styles.flowRow}>
                  <span><Gift size={15} /></span>
                  <div><strong>You receive <b>1 Claw</b></strong><small>Released after their first project and 72-hour security review.</small></div>
                </div>
              </div>

              {!summary?.eligible && !summary?.link && (
                <div className={styles.eligibility}>
                  <div className={styles.sectionLabel}>Unlock your referral link</div>
                  <div className={styles.requirement} data-complete={ageDays >= 7}>
                    <span>{ageDays >= 7 ? <Check size={13} /> : "01"}</span>
                    <div><strong>Account active for 7 days</strong><small>{Math.min(ageDays, 7)} of 7 days</small></div>
                  </div>
                  <div className={styles.requirement} data-complete={completedProjects >= 1}>
                    <span>{completedProjects >= 1 ? <Check size={13} /> : "02"}</span>
                    <div><strong>Complete one successful project</strong><small>{completedProjects >= 1 ? "Completed" : "Not completed yet"}</small></div>
                  </div>
                </div>
              )}

              {summary?.eligible && !summary?.link && (
                <div className={styles.createBox}>
                  <Link2 size={20} aria-hidden="true" />
                  <div><strong>Your account is eligible</strong><span>Create one permanent, secure referral link.</span></div>
                  <button type="button" onClick={createLink} disabled={isCreating}>
                    {isCreating ? <LoaderCircle className={styles.spinner} size={15} /> : null}
                    {isCreating ? "Creating…" : "Create link"}
                  </button>
                </div>
              )}

              {summary?.link && (
                <div className={styles.linkSection}>
                  <div className={styles.sectionHeading}>
                    <div><div><strong>Your invite link</strong><small>Permanent link · protected attribution</small></div></div>
                  </div>
                  <div className={styles.linkField}>
                    <Link2 size={16} aria-hidden="true" />
                    <span>{summary.link}</span>
                    <button type="button" onClick={copyLink} aria-label="Copy referral link">
                      {copied ? <Check size={16} /> : <Copy size={16} />}
                      {copied ? "Copied" : "Copy"}
                    </button>
                  </div>
                </div>
              )}

              {activityCount > 0 && (
                <div className={styles.activity}>
                  <div className={styles.activityHeading}>
                    <div>
                      <strong>Referral activity</strong>
                      <small>{activityCount} tracked {activityCount === 1 ? "invite" : "invites"}</small>
                    </div>
                  </div>
                  <div className={styles.activitySummary} aria-label={`${activityCount} referrals: ${rewardedCount} rewarded, ${activeCount} in progress, ${notEligibleCount} not eligible`}>
                    <span><b>{rewardedCount}</b> rewarded</span>
                    <span><b>{activeCount}</b> in progress</span>
                    <span><b>{notEligibleCount}</b> not eligible</span>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <footer className={styles.footer}>
          <ShieldCheck size={13} aria-hidden="true" />
          <span>Verified sign-in, project validation, and a 72-hour security hold protect every reward.</span>
        </footer>
      </section>
    </div>
  ), document.body);
}
