"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { ArrowUpRight, Check, X } from "lucide-react";
import { safeJson } from "@/lib/safeJson";
import styles from "./ClawRewardNotice.module.css";

function rewardCopy(notifications, unreadAmount) {
  if (notifications.length > 1) {
    return {
      eyebrow: "Claw balance updated",
      title: `${unreadAmount} Claws added`,
      body: `${notifications.length} verified referral rewards are now available in your balance.`,
    };
  }

  if (notifications[0]?.type === "invitee_trial") {
    return {
      eyebrow: "Referral welcome reward",
      title: "1 trial Claw added",
      body: "Your verified referral signup reward is ready to use.",
    };
  }

  return {
    eyebrow: "Referral completed",
    title: "You earned 1 Claw",
    body: "A referral completed their first verified project and passed the security review.",
  };
}

function formatRewardDate(value) {
  if (!value) return "Available now";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

export default function ClawRewardNotice({
  user,
  supabase,
  blocked = false,
  onBalanceChange,
  onUnreadChange,
  onViewActivity,
}) {
  const [mounted, setMounted] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadAmount, setUnreadAmount] = useState(0);
  const [visible, setVisible] = useState(false);
  const [isAcknowledging, setIsAcknowledging] = useState(false);
  const [error, setError] = useState("");
  const lastLoadAt = useRef(0);
  const callbacksRef = useRef({ onBalanceChange, onUnreadChange, onViewActivity });

  useEffect(() => {
    callbacksRef.current = { onBalanceChange, onUnreadChange, onViewActivity };
  }, [onBalanceChange, onUnreadChange, onViewActivity]);

  useEffect(() => setMounted(true), []);

  const authorizedRequest = useCallback(async (options = {}) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error("Missing authenticated session");
    return fetch("/api/referral-rewards", {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Bearer ${session.access_token}`,
      },
    });
  }, [supabase]);

  const loadNotifications = useCallback(async ({ force = false } = {}) => {
    if (!user?.id) return;
    const now = Date.now();
    if (!force && now - lastLoadAt.current < 20_000) return;
    lastLoadAt.current = now;

    try {
      const response = await authorizedRequest();
      const result = await safeJson(response, "Could not load reward notices");
      if (!response.ok) return;

      const nextNotifications = Array.isArray(result.notifications) ? result.notifications : [];
      setNotifications(nextNotifications);
      setUnreadAmount(Number(result.unreadAmount || 0));
      callbacksRef.current.onBalanceChange?.(Number(result.balance || 0));
      callbacksRef.current.onUnreadChange?.(Number(result.unreadCount || 0));
      setError("");

      if (nextNotifications.length > 0) {
        requestAnimationFrame(() => setVisible(true));
      } else {
        setVisible(false);
      }
    } catch {
      // Reward notices are supplementary. A temporary fetch failure must not
      // interrupt sign-in or any production workflow.
    }
  }, [authorizedRequest, user?.id]);

  useEffect(() => {
    if (!user?.id) {
      setNotifications([]);
      setUnreadAmount(0);
      setVisible(false);
      callbacksRef.current.onUnreadChange?.(0);
      return undefined;
    }

    loadNotifications({ force: true });
    const handleVisible = () => {
      if (document.visibilityState === "visible") loadNotifications();
    };
    document.addEventListener("visibilitychange", handleVisible);
    window.addEventListener("focus", handleVisible);
    return () => {
      document.removeEventListener("visibilitychange", handleVisible);
      window.removeEventListener("focus", handleVisible);
    };
  }, [loadNotifications, user?.id]);

  const acknowledge = async (openActivity = false) => {
    const ids = notifications.map((notification) => notification.id);
    if (ids.length === 0 || isAcknowledging) return;

    setIsAcknowledging(true);
    setError("");
    try {
      const response = await authorizedRequest({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const result = await safeJson(response, "Could not acknowledge reward notices");
      if (!response.ok) throw new Error(result.error || "Could not acknowledge reward notices");

      setVisible(false);
      callbacksRef.current.onUnreadChange?.(0);
      if (openActivity) callbacksRef.current.onViewActivity?.();
      window.setTimeout(() => {
        setNotifications([]);
        setUnreadAmount(0);
      }, 240);
    } catch {
      setError("Could not dismiss this update yet. Please try again.");
    } finally {
      setIsAcknowledging(false);
    }
  };

  if (!mounted || notifications.length === 0) return null;

  const copy = rewardCopy(notifications, unreadAmount);
  const latest = notifications[0];

  return createPortal((
    <aside
      className={styles.notice}
      data-visible={visible && !blocked}
      role="status"
      aria-live="polite"
      aria-label="Referral reward received"
    >
      <button
        className={styles.close}
        type="button"
        onClick={() => acknowledge(false)}
        disabled={isAcknowledging}
        aria-label="Dismiss reward update"
      >
        <X size={16} aria-hidden="true" />
      </button>

      <div className={styles.icon} aria-hidden="true">
        <Image src="/Claws/Claws.webp" alt="" width={42} height={42} />
        <span><Check size={11} strokeWidth={3} /></span>
      </div>

      <div className={styles.content}>
        <span className={styles.eyebrow}>{copy.eyebrow}</span>
        <strong>{copy.title}</strong>
        <p>{copy.body}</p>
        <div className={styles.meta}>
          <span>Verified reward</span>
          <span aria-hidden="true">·</span>
          <time dateTime={latest?.settledAt || undefined}>{formatRewardDate(latest?.settledAt)}</time>
        </div>
        {error && <small className={styles.error}>{error}</small>}
      </div>

      <button
        className={styles.activity}
        type="button"
        onClick={() => acknowledge(true)}
        disabled={isAcknowledging}
      >
        View activity <ArrowUpRight size={14} aria-hidden="true" />
      </button>
    </aside>
  ), document.body);
}
