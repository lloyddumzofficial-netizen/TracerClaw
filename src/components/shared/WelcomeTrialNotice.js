"use client";

import { useEffect, useState } from "react";
import { toast } from "@/components/ui/Toast";
import styles from "./WelcomeTrialNotice.module.css";

export default function WelcomeTrialNotice({ user, supabase, onBalanceChange, onGoogleSignIn, blocked }) {
  const [trial, setTrial] = useState(null);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    if (!user?.id) { setTrial(null); setDismissed(false); return undefined; }
    let cancelled = false;
    async function load() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) return;
        const response = await fetch('/api/welcome-trial', {
          headers: { Authorization: `Bearer ${session.access_token}` }, cache: 'no-store',
        });
        const result = await response.json();
        if (cancelled || !response.ok || !result.enabled) return;
        setTrial(result);
        if (Number.isFinite(result.balance)) onBalanceChange?.(result.balance);
        const key = `dc:welcome-trial:${user.id}`;
        if (result.status === 'ineligible' && ['browser_trial_used', 'identity_already_used'].includes(result.reason)
          && !sessionStorage.getItem(`${key}:ineligible`)) {
          sessionStorage.setItem(`${key}:ineligible`, 'shown');
          toast.info('A welcome trial cannot be added to this account. You can continue with purchased Claws.');
        }
        if (result.status === 'granted' && result.source === 'welcome'
          && Date.now() - Date.parse(result.granted_at) < 5 * 60_000
          && !sessionStorage.getItem(key)) {
          sessionStorage.setItem(key, 'shown');
          toast.success('1 free Claw added. Your Google welcome trial is ready.');
        }
      } catch { /* Trial messaging must not interfere with paid tools. */ }
    }
    load();
    return () => { cancelled = true; };
  }, [user?.id, supabase, onBalanceChange]);

  if (blocked || dismissed || !trial || !['pending_allocation', 'temporarily_unavailable'].includes(trial.status)) return null;
  const pending = trial.status === 'pending_allocation';
  const retryTime = trial.retry_at ? new Date(trial.retry_at) : null;
  return (
    <aside className={styles.notice} aria-label="Google welcome trial" role="status">
      <button type="button" className={styles.close} aria-label="Dismiss trial notice" onClick={() => setDismissed(true)}>×</button>
      <strong>{pending ? 'Today’s trial allocation is full' : 'Check your Google welcome trial'}</strong>
      <p>{pending
        ? `You can check again ${retryTime ? `after ${retryTime.toLocaleString()}` : 'tomorrow'}. Your account and purchased Claws are ready to use.`
        : 'Sign in with Google again to verify trial eligibility. Your account remains available.'}</p>
      <button type="button" className={styles.retry} onClick={onGoogleSignIn}>Continue with Google</button>
    </aside>
  );
}
