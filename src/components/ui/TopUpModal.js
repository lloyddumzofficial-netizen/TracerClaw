"use client";

import { memo, useState, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { X, Shirt, CheckCircle, Package, Tag, Mail, Smartphone, Check, ArrowRight, ImageIcon, History, Clock, AlertTriangle } from "lucide-react";
import Image from "next/image";
import { toast } from "./Toast";
import { createClient } from "@/utils/supabase/client";
import { CREDIT_PLANS } from "@/lib/paymentPlans";
import { safeJson } from "@/lib/safeJson";
import { analytics } from "@/lib/analytics";

// Derived from CREDIT_PLANS — single source of truth.
// To change prices, edit src/lib/paymentPlans.js only.
const PLANS_META = {
  tingi:   { icon: '/Claws/6f530a46-652b-4f20-8d6c-2a7c9f587698.webp', desc: 'Small package for quick tests.',                          features: ['2 HD Vector Traces', 'Standard Processing'] },
  basic:   { icon: '/Claws/a15960f4-04ea-43bf-b226-20b9923767a4.webp', desc: 'Great for hobbyists printing occasionally.',               features: ['5 HD Vector Traces', 'Standard Processing'] },
  starter: { icon: '/Claws/f05da7d4-2019-4c80-9c92-cfc2ba752ef5.webp', desc: 'Ideal for small businesses taking their first steps.',     features: ['10 HD Vector Traces', 'Priority Processing', 'Email support'] },
  pro:     { icon: '/Claws/e21d7ba5-f8c9-4e19-8653-f9d7db6eeedb.webp', desc: 'Perfect for print shops & growing design studios.',        best: true, features: ['35 HD Vector Traces', 'Highest Priority Queue', 'Unlimited storage', 'Priority support'] },
};

const PLANS = Object.values(CREDIT_PLANS).map((plan) => ({
  key:      plan.key,
  label:    plan.label,
  traces:   plan.credits,
  price:    plan.price,
  desc:     PLANS_META[plan.key]?.desc || '',
  best:     PLANS_META[plan.key]?.best || false,
  icon:     PLANS_META[plan.key]?.icon || null,
  features: PLANS_META[plan.key]?.features || [],
}));

const PLAN_LABELS = Object.fromEntries(
  Object.values(CREDIT_PLANS).map((p) => [p.key, `${p.label} — ${p.credits} Claws`])
);
const PLAN_PRICES = Object.fromEntries(
  Object.values(CREDIT_PLANS).map((p) => [p.key, p.price])
);
const DODO_ENABLED_PLANS = new Set(
  Object.values(CREDIT_PLANS).filter((p) => p.dodoEnabled).map((p) => p.key)
);

const PAYMENT_LOGOS = {
  gcash: "/Payments-logo/gcash-logo.png",
  qrph: "/Payments-logo/qr-ph-logo_svgstack_com_74171786789082.png",
  dodo: "/Payments-logo/dodo-payments.png",
};

function PaymentLogoTile({ src, alt, wide = false, large = false }) {
  const width = large ? 126 : wide ? 86 : 70;
  const height = large ? 46 : 34;
  return (
    <span
      className="top-up-payment-logo-tile"
      style={{
        width: `${width}px`,
        height: `${height}px`,
        border: '0',
        borderRadius: '0',
        background: 'transparent',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'flex-start',
        padding: '0',
        boxShadow: 'none',
      }}
    >
      <Image
        src={src}
        alt={alt}
        width={width}
        height={height}
        style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
      />
    </span>
  );
}

function formatSubmittedAgo(createdAt) {
  if (!createdAt) return "just now";
  const mins = Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins === 1) return "1 minute ago";
  if (mins < 60) return `${mins} minutes ago`;
  const hrs = Math.floor(mins / 60);
  return hrs === 1 ? "1 hour ago" : `${hrs} hours ago`;
}

function getPlanAnalytics(planKey) {
  const plan = CREDIT_PLANS[planKey];
  return {
    plan: planKey,
    price: plan?.price,
    credits: plan?.credits,
  };
}

function formatCurrencyFromMinor(amount, currency = "PHP") {
  const major = Number(amount || 0) / 100;
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency,
    minimumFractionDigits: major % 1 === 0 ? 0 : 2,
  }).format(major);
}

function isExpiredStorageTokenError(error) {
  return /exp.*claim.*timestamp.*check failed/i.test(error?.message || "");
}

async function getFreshSession(supabase) {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) throw error;

  const expiresAtMs = session?.expires_at ? session.expires_at * 1000 : 0;
  if (session && expiresAtMs > Date.now() + 60_000) return session;

  return refreshCurrentSession(supabase);
}

async function refreshCurrentSession(supabase) {
  const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
  if (refreshError) throw refreshError;
  return refreshData?.session || null;
}

const TopUpModal = memo(function TopUpModal({ show = true, user, supabase: supabaseProp, onClose, onLoginRequired }) {
  const [fallbackSupabase] = useState(() => createClient());
  const supabase = supabaseProp || fallbackSupabase;
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({ plan: "pro", txnRef: "", screenshotName: "", screenshotFile: null });
  const [submitted, setSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isStartingDodo, setIsStartingDodo] = useState(false);
  const [isStartingPayMongo, setIsStartingPayMongo] = useState(false);
  const [qrphPayment, setQrphPayment] = useState(null);
  const [activeTab, setActiveTab] = useState("plans");
  const [logs, setLogs] = useState([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const [mounted, setMounted] = useState(false);
  // A submitted GCash payment waits on manual admin approval. The confirmation
  // screen after submitting was local state, so closing the modal erased every
  // trace of it — reopening showed a fresh plan picker, as though the payment
  // had never happened. Session replay showed a user idle for ~13 minutes after
  // paying. Reading the request back on open makes the wait visible.
  const [pendingRequest, setPendingRequest] = useState(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!show || !user) return;
    let cancelled = false;
    supabase
      .from("payment_requests")
      .select("id, plan, status, reference_number, created_at")
      .eq("user_id", user.id)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(1)
      .then(({ data, error }) => {
        if (!cancelled && !error) setPendingRequest(data?.[0] || null);
      });
    return () => { cancelled = true; };
  }, [show, user, supabase, submitted]);

  useEffect(() => {
    if (activeTab === "history" && user) {
      setIsLoadingLogs(true);
      supabase
        .from("credit_logs")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(50)
        .then(({ data, error }) => {
          if (!error && data) setLogs(data);
          setIsLoadingLogs(false);
        });
    }
  }, [activeTab, user, supabase]);

  useEffect(() => {
    if (!show || !user || step !== "qrph" || !qrphPayment?.localPaymentId || qrphPayment.status !== "pending") return;

    let cancelled = false;
    const checkStatus = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) return;

        const response = await fetch(`/api/payments/paymongo/status?paymentId=${encodeURIComponent(qrphPayment.localPaymentId)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await safeJson(response, "Failed to check QRPh status");
        if (!response.ok || cancelled) return;

        if (data.status === "paid") {
          setQrphPayment((current) => current ? { ...current, status: "paid", creditedAt: data.creditedAt, credits: data.credits } : current);
          toast.success("QRPh payment confirmed. Your claws were added.");
        } else if (data.status === "failed") {
          setQrphPayment((current) => current ? { ...current, status: "failed" } : current);
        }
      } catch {
        // Keep the QR visible; webhook delivery can still complete the payment.
      }
    };

    const interval = window.setInterval(checkStatus, 4000);
    checkStatus();
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [qrphPayment?.localPaymentId, qrphPayment?.status, show, step, supabase, user]);

  const handleClose = useCallback(() => {
    onClose();
    setStep(1);
    setSubmitted(false);
    setIsStartingDodo(false);
    setIsStartingPayMongo(false);
    setQrphPayment(null);
    setActiveTab("plans");
    setForm({ plan: "pro", txnRef: "", screenshotName: "", screenshotFile: null });
  }, [onClose]);

  const handleStartDodoCheckout = useCallback(async () => {
    if (!user) {
      onLoginRequired?.();
      return;
    }
    if (!DODO_ENABLED_PLANS.has(form.plan)) {
      toast.error("Mini is available via GCash only. Please choose Basic, Starter, or Pro for card payments.");
      return;
    }

    setIsStartingDodo(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Please log in again before checkout.");

      const response = await fetch("/api/payments/dodo/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ plan: form.plan }),
      });

      const data = await safeJson(response, "Failed to start Dodo checkout");
      if (!response.ok) throw new Error(data.error || "Failed to start Dodo checkout");
      if (!data.checkoutUrl) throw new Error("Dodo checkout URL is missing");

      analytics.checkoutStarted({ ...getPlanAnalytics(form.plan), provider: "dodo" });
      window.location.href = data.checkoutUrl;
    } catch (err) {
      analytics.error(err, { area: "dodo_checkout", plan: form.plan, provider: "dodo" });
      toast.error(err.message || "Failed to start Dodo checkout");
    } finally {
      setIsStartingDodo(false);
    }
  }, [form.plan, onLoginRequired, supabase, user]);

  const handleStartPayMongoCheckout = useCallback(async () => {
    if (!user) {
      onLoginRequired?.();
      return;
    }

    setIsStartingPayMongo(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Please log in again before QRPh checkout.");

      const response = await fetch("/api/payments/paymongo/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ plan: form.plan }),
      });

      const data = await safeJson(response, "Failed to start QRPh payment");
      if (!response.ok) throw new Error(data.error || "Failed to start QRPh payment");
      if (!data.qrImageUrl || !data.localPaymentId) throw new Error("QRPh code is missing");

      analytics.checkoutStarted({ ...getPlanAnalytics(form.plan), provider: "paymongo_qrph" });
      setQrphPayment({
        localPaymentId: data.localPaymentId,
        qrImageUrl: data.qrImageUrl,
        amount: data.amount,
        currency: data.currency,
        expiresAt: data.expiresAt,
        status: "pending",
      });
      setStep("qrph");
    } catch (err) {
      analytics.error(err, { area: "paymongo_checkout", plan: form.plan, provider: "paymongo_qrph" });
      toast.error(err.message || "Failed to start QRPh payment");
    } finally {
      setIsStartingPayMongo(false);
    }
  }, [form.plan, onLoginRequired, supabase, user]);

  const handleSubmit = useCallback(async () => {
    if (!form.txnRef.trim() || !form.screenshotFile) {
      toast.error("Please enter your GCash number and upload proof of payment.");
      return;
    }
    if (!user) {
      toast.error("You must be logged in.");
      return;
    }

    setIsSubmitting(true);
    try {
      const session = await getFreshSession(supabase);
      let token = session?.access_token;
      if (!token) throw new Error("Please log in again before submitting payment proof.");

      const fileExt = form.screenshotFile.name.split(".").pop();
      const fileName = `proof_${user.id}_${Date.now()}.${fileExt}`;

      let { error: uploadError } = await supabase.storage
        .from("payment_proofs")
        .upload(fileName, form.screenshotFile);
      if (isExpiredStorageTokenError(uploadError)) {
        const refreshedSession = await refreshCurrentSession(supabase);
        token = refreshedSession?.access_token || token;
        ({ error: uploadError } = await supabase.storage
          .from("payment_proofs")
          .upload(fileName, form.screenshotFile));
      }
      if (uploadError) throw uploadError;

      const { data: publicData } = supabase.storage.from("payment_proofs").getPublicUrl(fileName);

      const response = await fetch("/api/payments/gcash/submit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          plan: form.plan,
          referenceNumber: form.txnRef,
          proofUrl: publicData.publicUrl,
        }),
      });

      const data = await safeJson(response, "Failed to submit payment request.");

      // If this reference was already approved, credits are already in their account.
      // Treat this as success/info — not an error — so users aren't confused.
      if (data.alreadyApproved) {
        toast.success("✅ Your claws were already added! Please check your balance.");
        analytics.creditsPurchased({
          ...getPlanAnalytics(form.plan),
          provider: "gcash",
          status: "already_approved",
        });
        setSubmitted(true);
        return;
      }

      if (!response.ok) throw new Error(data.error || "Failed to submit payment request.");

      analytics.creditsPurchased({
        ...getPlanAnalytics(form.plan),
        provider: "gcash",
        status: "payment_request_submitted",
      });
      setSubmitted(true);
    } catch (err) {
      analytics.error(err, { area: "credits_purchase", plan: form.plan, provider: "gcash" });
      toast.error(`Error submitting request: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  }, [form, user, supabase]);

  if (!show || !mounted) return null;

  return createPortal(
    <div
      className="modal-overlay"
      onClick={handleClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2147483000,
        padding: '24px',
        background: 'rgba(0, 0, 0, 0.94)',
        backdropFilter: 'blur(10px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div className="modal-content top-up-modal" style={{ maxWidth: '960px', width: '100%', maxHeight: 'calc(100vh - 48px)', padding: '0', overflow: 'hidden', borderRadius: '0', border: '1px solid #444', background: '#262626', display: 'flex', flexDirection: 'column', position: 'relative', zIndex: 1, boxShadow: '0 30px 90px rgba(0,0,0,0.85)' }} onClick={(e) => e.stopPropagation()}>
        
        {/* Modal Header */}
        <div className="top-up-modal-header" style={{ background: 'linear-gradient(180deg, #171717, #121212)', borderBottom: '1px solid rgba(255,255,255,0.09)', padding: '18px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '11px' }}>
            <Shirt size={17} color="#d8d8d8" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              <span style={{ fontWeight: '650', fontSize: '14px', color: '#f3f3f3' }}>Get More Traces</span>
              <span style={{ fontWeight: '500', fontSize: '11px', color: '#7d7d7d' }}>Top up claws for production work</span>
            </div>
          </div>
          {!submitted && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#777', fontSize: '11px', fontWeight: '700', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              <span style={{ color: activeTab === 'plans' ? '#d8d8d8' : '#777' }}>Plans</span>
              <span style={{ width: '18px', height: '1px', background: 'rgba(255,255,255,0.16)' }} />
              <span style={{ color: step === 2 || step === 3 || step === "qrph" ? '#d8d8d8' : '#777' }}>Payment</span>
            </div>
          )}
          <button onClick={handleClose} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', padding: '4px' }}><X size={16} /></button>
        </div>

        {/* Tab Navigation */}
        <div className="top-up-modal-tabs" style={{ display: 'flex', background: '#141414', borderBottom: '1px solid rgba(255,255,255,0.08)', padding: '0 24px', flexShrink: 0 }}>
          <button 
            onClick={() => { setActiveTab('plans'); setStep(1); setQrphPayment(null); }} 
            className="top-up-tab-button"
            style={{ padding: '16px 20px', background: 'none', border: 'none', borderBottom: activeTab === 'plans' ? '2px solid #FFD700' : '2px solid transparent', color: activeTab === 'plans' ? '#FFD700' : '#888', fontWeight: '600', fontSize: '14px', cursor: 'pointer', transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            <Package size={16} /> Top-Up Plans
          </button>
          <button 
            onClick={() => { setActiveTab('history'); setStep(1); setQrphPayment(null); }} 
            className="top-up-tab-button"
            style={{ padding: '16px 20px', background: 'none', border: 'none', borderBottom: activeTab === 'history' ? '2px solid #FFD700' : '2px solid transparent', color: activeTab === 'history' ? '#FFD700' : '#888', fontWeight: '600', fontSize: '14px', cursor: 'pointer', transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            <History size={16} /> Claw Logs
          </button>
        </div>

        <div className="top-up-modal-body" style={{ background: '#262626', padding: '24px', overflowY: 'auto', minHeight: 0 }}>
          {/* Persistent status for a GCash payment awaiting manual approval.
              Shown on every open until an admin approves, so the wait is never
              silent. Non-blocking: Dodo checkout stays available underneath. */}
          {pendingRequest && !submitted && (
            <div style={{ background: 'rgba(255,215,0,0.06)', border: '1px solid rgba(255,215,0,0.35)', borderRadius: '8px', padding: '16px', marginBottom: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <Clock size={15} color="#FFD700" />
                <strong style={{ color: '#FFD700', fontSize: '13px' }}>GCash payment under review</strong>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '12px' }}>
                {[
                  { label: 'Submitted', done: true },
                  { label: 'Under review', done: true, current: true },
                  { label: 'Claws added', done: false },
                ].map((s, i) => (
                  <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: i === 2 ? '0 0 auto' : 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: s.done ? '#FFD700' : '#444', flexShrink: 0 }} />
                      <span style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.5px', color: s.current ? '#FFD700' : s.done ? '#aaa' : '#666', fontWeight: s.current ? 700 : 500, whiteSpace: 'nowrap' }}>{s.label}</span>
                    </div>
                    {i < 2 && <div style={{ height: '1px', background: '#444', flex: 1, minWidth: '10px' }} />}
                  </div>
                ))}
              </div>

              <p style={{ margin: 0, fontSize: '11px', color: '#aaa', lineHeight: 1.5 }}>
                {PLAN_LABELS[pendingRequest.plan] || pendingRequest.plan} · Ref {pendingRequest.reference_number || '—'} · submitted {formatSubmittedAgo(pendingRequest.created_at)}.
                <br />
                Claws are usually added within <strong style={{ color: '#FFD700' }}>10–30 minutes</strong>. You do not need to pay again — reopen this window any time to check.
              </p>
            </div>
          )}

          {activeTab === 'history' ? (
            <div style={{ minHeight: '300px' }}>
              <div style={{ marginBottom: '24px' }}>
                <h2 style={{ margin: '0 0 8px', fontSize: '24px', fontWeight: '700', color: '#fff' }}>Claw History</h2>
                <p style={{ margin: 0, color: '#aaa', fontSize: '14px' }}>View your recent claw transactions and usage. Logs are automatically deleted after 3 days.</p>
              </div>
              
              {!user ? (
                <div style={{ textAlign: 'center', padding: '40px 20px', color: '#888' }}>Please log in to view your claw history.</div>
              ) : isLoadingLogs ? (
                <div style={{ textAlign: 'center', padding: '40px 20px', color: '#888' }}>Loading logs...</div>
              ) : logs.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 20px', background: '#2a2a2a', border: '1px dashed #444', borderRadius: '8px' }}>
                  <Clock size={32} color="#555" style={{ marginBottom: '12px' }} />
                  <div style={{ color: '#aaa', fontSize: '14px' }}>No transactions found in the last 3 days.</div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {logs.map((log) => (
                    <div key={log.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#2a2a2a', padding: '16px', borderRadius: '8px', border: '1px solid #333' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <span style={{ color: '#fff', fontSize: '14px', fontWeight: '500' }}>{log.action}</span>
                        <span style={{ color: '#666', fontSize: '12px' }}>{new Date(log.created_at).toLocaleString()}</span>
                      </div>
                      <div style={{ fontSize: '16px', fontWeight: '700', color: log.amount > 0 ? '#4ade80' : '#ef4444' }}>
                        {log.amount > 0 ? '+' : ''}{log.amount}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : submitted ? (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <div style={{ marginBottom: '16px', display: 'flex', justifyContent: 'center' }}>
                <CheckCircle size={48} color="#FFD700" strokeWidth={1.5} />
              </div>
              <h3 style={{ margin: '0 0 8px', color: '#fff', fontWeight: '700', fontSize: '20px' }}>Request Submitted</h3>
              <p style={{ color: '#aaa', fontSize: '14px', margin: '0 0 8px' }}>We have received your payment request.</p>
              <div style={{ background: '#111', border: '1px solid #333', borderRadius: '8px', padding: '16px', margin: '24px 0', textAlign: 'left' }}>
                <p style={{ margin: '0 0 10px', color: '#888', fontSize: '13px', display: 'flex', alignItems: 'center' }}><Package size={14} style={{ marginRight: '8px', color: '#555' }} /> Package: <strong style={{ color: '#fff', marginLeft: '6px' }}>{PLAN_LABELS[form.plan]}</strong></p>
                <p style={{ margin: '0 0 10px', color: '#888', fontSize: '13px', display: 'flex', alignItems: 'center' }}><Tag size={14} style={{ marginRight: '8px', color: '#555' }} /> Ref No: <strong style={{ color: '#fff', marginLeft: '6px' }}>{form.txnRef || '—'}</strong></p>
                <p style={{ margin: 0, color: '#888', fontSize: '13px', display: 'flex', alignItems: 'center' }}><Mail size={14} style={{ marginRight: '8px', color: '#555' }} /> Account: <strong style={{ color: '#fff', marginLeft: '6px' }}>{user?.email}</strong></p>
              </div>
              <p style={{ color: '#666', fontSize: '12px', margin: '0 0 24px' }}>Claws are usually added within <strong style={{ color: '#FFD700' }}>10-30 minutes</strong>. Thank you.</p>
              <button onClick={handleClose} style={{ width: '100%', padding: '14px', background: 'transparent', color: '#fff', border: '1px solid #444', borderRadius: '4px', cursor: 'pointer', fontWeight: '600', fontSize: '14px', transition: 'all 0.2s' }} onMouseEnter={e => { e.currentTarget.style.background = '#333'; e.currentTarget.style.borderColor = '#777'; }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = '#444'; }}>Close</button>
            </div>
          ) : step === 1 ? (
            <>
              <div className="top-up-pricing-hero" style={{ textAlign: 'center', marginBottom: '32px' }}>
                {!user && (
                  <div style={{ background: 'rgba(255,215,0,0.1)', border: '1px solid #FFD700', color: '#FFD700', padding: '12px', borderRadius: '8px', marginBottom: '24px', fontSize: '14px', fontWeight: '500' }}>
                    Welcome. You need claws to trace images. Please select a plan and log in.
                  </div>
                )}
                <div className="top-up-pricing-kicker" style={{ fontSize: '11px', fontWeight: '650', color: '#8f8f8f', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: '14px' }}>Simple, scalable pricing</div>
                <div className="top-up-pricing-title-row">
                  <h2 style={{ margin: '0 0 8px', fontSize: '28px', fontWeight: '700', color: '#fff' }}>
                    Plans that fit your <span>production needs</span>
                  </h2>
                  <p style={{ margin: 0, color: '#aaa', fontSize: '14px', maxWidth: '500px', marginLeft: 'auto', marginRight: 'auto' }}>Simple claw packages for vector tracing, background removal, image upscale, and print-ready handoff.</p>
                </div>
              </div>

              <div className="top-up-plans-grid top-up-pricing-table" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '24px' }}>
                {PLANS.map(p => (
                  <div key={p.key} className={`top-up-plan-card${p.best ? ' top-up-plan-card-featured' : ''}`} style={{ background: p.best ? '#333' : '#2a2a2a', border: `1px solid ${p.best ? '#FFD700' : '#444'}`, padding: '32px 24px', display: 'flex', flexDirection: 'column', position: 'relative', borderRadius: '6px' }}>
                    <div className="top-up-plan-head" style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', marginBottom: '16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {p.icon && <Image src={p.icon} alt={p.label} width={32} height={32} style={{ objectFit: 'contain' }} />}
                        <div style={{ fontSize: '16px', fontWeight: '500', color: '#fff' }}>{p.label}</div>
                      </div>
                      {p.best && <div className="top-up-plan-badge" style={{ background: '#FFD700', color: '#000', fontSize: '11px', fontWeight: '800', padding: '4px 8px', display: 'flex', alignItems: 'center', gap: '4px', borderRadius: '4px', whiteSpace: 'nowrap' }}><CheckCircle size={12} /> Most popular</div>}
                    </div>

                    <div className="top-up-plan-price" style={{ marginBottom: '16px', display: 'flex', alignItems: 'baseline', gap: '4px' }}>
                      <span style={{ fontSize: '36px', fontWeight: '700', color: '#fff', letterSpacing: '-1px' }}>{p.price}</span>
                      <span style={{ fontSize: '12px', color: '#888' }}>/ {p.traces} claws</span>
                    </div>
                    
                    <p className="top-up-plan-desc" style={{ color: '#aaa', fontSize: '13px', lineHeight: '1.5', margin: '0 0 24px', minHeight: '40px' }}>{p.desc}</p>

                    <button 
                      onClick={() => { 
                        if (!user) {
                          onLoginRequired?.();
                          return;
                        }
                        setForm(f => ({ ...f, plan: p.key })); 
                        analytics.checkoutStarted({ ...getPlanAnalytics(p.key), provider: "gcash" });
                        setStep(2); 
                      }}
                      className={`top-up-plan-button${p.best ? ' top-up-plan-button-featured' : ''}`}
                      style={{ width: '100%', padding: '12px 8px', background: p.best ? '#FFD700' : 'transparent', color: p.best ? '#000' : '#d5d5d5', border: p.best ? 'none' : '1px solid #555', fontWeight: '600', fontSize: '13px', cursor: 'pointer', transition: 'all 0.2s', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '6px', marginBottom: '32px', borderRadius: '4px', whiteSpace: 'nowrap' }} 
                      onMouseOver={e => { e.target.style.opacity = '0.9'; if (!p.best) { e.target.style.background = '#3a3a3a'; e.target.style.borderColor = '#777'; } }} 
                      onMouseOut={e => { e.target.style.opacity = '1'; if (!p.best) { e.target.style.background = 'transparent'; e.target.style.borderColor = '#555'; } }}
                    >
                      {user ? 'Select Plan' : 'Log in to Purchase'} <ArrowRight size={14} />
                    </button>

                    <div className="top-up-plan-divider" style={{ borderTop: '1px solid #444', margin: '0 -24px 24px' }}></div>

                    <div className="top-up-plan-included-title" style={{ fontSize: '12px', fontWeight: '600', color: '#888', marginBottom: '16px' }}>What's Included:</div>
                    <div className="top-up-plan-features" style={{ display: 'flex', flexDirection: 'column', gap: '12px', flex: 1 }}>
                      {p.features.map((feat, i) => (
                        <div className="top-up-plan-feature" key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#d5d5d5', fontSize: '13px' }}>
                          <Check size={14} color={p.best ? "#FFD700" : "#888"} strokeWidth={3} />
                          {feat}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : step === 2 ? (
            <>
              <div className="top-up-payment-hero" style={{ textAlign: 'center', marginBottom: '28px' }}>
                <div className="top-up-pricing-kicker" style={{ fontSize: '11px', fontWeight: '650', color: '#8f8f8f', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: '14px' }}>Payment method</div>
                <h2 style={{ margin: '0 0 8px', fontSize: '30px', fontWeight: '650', color: '#fff', letterSpacing: '-0.02em' }}>Choose how to pay</h2>
                <p style={{ margin: 0, color: '#aaa', fontSize: '14px' }}>
                  Selected: <strong style={{ color: '#f4f4f4' }}>{PLAN_LABELS[form.plan]}</strong> · <strong style={{ color: '#f4f4f4' }}>{PLAN_PRICES[form.plan]}</strong>
                </p>
                {form.plan === 'tingi' && (
                  <p style={{ margin: '10px 0 0', color: '#a9a9a9', fontSize: '13px', fontWeight: '500' }}>
                    Mini supports GCash Manual and QRPh. Card / International starts at Basic.
                  </p>
                )}
              </div>

              <div className="top-up-payment-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '14px', marginBottom: '24px' }}>
                <button
                  type="button"
                  className="top-up-payment-option"
                  onClick={() => setStep(3)}
                  style={{ background: 'linear-gradient(180deg, rgba(28,28,28,0.98), rgba(15,15,15,0.98))', border: '1px solid rgba(255,255,255,0.11)', color: '#fff', padding: '26px 24px', textAlign: 'left', cursor: 'pointer', borderRadius: '5px', display: 'flex', flexDirection: 'column', gap: '13px', minHeight: '210px' }}
                >
                  <PaymentLogoTile src={PAYMENT_LOGOS.gcash} alt="GCash" wide />
                  <span className="top-up-payment-title" style={{ fontSize: '18px', fontWeight: '650', color: '#f4f4f4' }}>GCash Manual</span>
                  <span className="top-up-payment-desc" style={{ color: '#adadad', fontSize: '13px', lineHeight: 1.5, fontWeight: '450' }}>Scan the QR code, upload payment proof, then wait for admin approval. Best for Philippine GCash users.</span>
                  <span className="top-up-payment-status" style={{ color: '#8e8e8e', fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 'auto' }}>Manual approval</span>
                </button>

                <button
                  type="button"
                  className="top-up-payment-option top-up-payment-option-featured"
                  onClick={handleStartPayMongoCheckout}
                  disabled={isStartingPayMongo}
                  style={{ background: 'linear-gradient(180deg, rgba(31,31,31,0.98), rgba(14,14,14,0.98))', border: '1px solid rgba(255, 215, 0, 0.24)', color: '#fff', padding: '26px 24px', textAlign: 'left', cursor: isStartingPayMongo ? 'not-allowed' : 'pointer', borderRadius: '5px', display: 'flex', flexDirection: 'column', gap: '13px', minHeight: '210px', opacity: isStartingPayMongo ? 0.65 : 1, boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)' }}
                >
                  <PaymentLogoTile src={PAYMENT_LOGOS.qrph} alt="QRPh" large />
                  <span className="top-up-payment-title" style={{ fontSize: '18px', fontWeight: '650', color: '#f4f4f4' }}>QRPh Scan to Pay</span>
                  <span className="top-up-payment-desc" style={{ color: '#adadad', fontSize: '13px', lineHeight: 1.5, fontWeight: '450' }}>
                    Generate a secure PayMongo QR inside this window. Claws are added automatically after payment confirmation.
                  </span>
                  <span className="top-up-payment-status" style={{ color: '#8e8e8e', fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 'auto' }}>
                    {isStartingPayMongo ? 'Generating QR...' : 'In-app QR payment'}
                  </span>
                </button>

                <button
                  type="button"
                  className="top-up-payment-option"
                  onClick={handleStartDodoCheckout}
                  disabled={isStartingDodo || isStartingPayMongo || form.plan === 'tingi'}
                  style={{ background: 'linear-gradient(180deg, rgba(28,28,28,0.86), rgba(15,15,15,0.9))', border: '1px solid rgba(255,255,255,0.09)', color: '#fff', padding: '26px 24px', textAlign: 'left', cursor: (isStartingDodo || isStartingPayMongo || form.plan === 'tingi') ? 'not-allowed' : 'pointer', borderRadius: '5px', display: 'flex', flexDirection: 'column', gap: '13px', minHeight: '210px', opacity: (isStartingDodo || isStartingPayMongo || form.plan === 'tingi') ? 0.58 : 1 }}
                >
                  <PaymentLogoTile src={PAYMENT_LOGOS.dodo} alt="Dodo Payments" wide />
                  <span className="top-up-payment-title" style={{ fontSize: '18px', fontWeight: '650', color: '#f4f4f4' }}>Card / International</span>
                  <span className="top-up-payment-desc" style={{ color: '#adadad', fontSize: '13px', lineHeight: 1.5, fontWeight: '450' }}>
                    {form.plan === 'tingi'
                      ? 'Not available for Mini because card fees are too high for micro-payments.'
                      : 'Pay through Dodo Payments hosted checkout. Claws are added automatically after payment confirmation.'}
                  </span>
                  <span className="top-up-payment-status" style={{ color: form.plan === 'tingi' ? '#777' : '#8e8e8e', fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 'auto' }}>
                    {form.plan === 'tingi' ? 'Choose Basic or higher' : isStartingDodo ? 'Starting checkout...' : 'Automated checkout'}
                  </span>
                </button>
              </div>

              <button className="top-up-secondary-button" onClick={() => setStep(1)} disabled={isStartingDodo || isStartingPayMongo} style={{ padding: '12px 24px', background: 'transparent', color: '#d5d5d5', border: '1px solid #555', borderRadius: '6px', cursor: (isStartingDodo || isStartingPayMongo) ? 'not-allowed' : 'pointer', fontSize: '14px', fontWeight: '500' }}>Back</button>
            </>
          ) : step === "qrph" ? (
            <div style={{ maxWidth: '740px', margin: '0 auto', padding: '4px 0 8px' }}>
              <div style={{ textAlign: 'center', marginBottom: '24px' }}>
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '8px' }}>
                  <PaymentLogoTile src={PAYMENT_LOGOS.qrph} alt="QRPh" large />
                </div>
                <h2 style={{ margin: '0 0 8px', fontSize: '30px', lineHeight: 1.08, fontWeight: '650', color: '#fff', letterSpacing: '-0.02em' }}>Scan to pay with QRPh</h2>
                <p style={{ margin: 0, color: '#aaa', fontSize: '14px', lineHeight: 1.5 }}>
                  {PLAN_LABELS[form.plan]} · {qrphPayment?.amount ? formatCurrencyFromMinor(qrphPayment.amount, qrphPayment.currency) : PLAN_PRICES[form.plan]}
                </p>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 0.78fr) minmax(240px, 1fr)', gap: '22px', alignItems: 'stretch' }}>
                <div style={{ background: 'linear-gradient(180deg, rgba(245,245,245,1), rgba(226,226,226,1))', border: '1px solid rgba(255,255,255,0.16)', borderRadius: '6px', padding: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '310px' }}>
                  {qrphPayment?.qrImageUrl ? (
                    <img
                      src={qrphPayment.qrImageUrl}
                      alt="QRPh payment code"
                      style={{ width: '100%', maxWidth: '286px', height: 'auto', display: 'block' }}
                    />
                  ) : (
                    <div style={{ color: '#111', fontSize: '13px', fontWeight: '600' }}>Preparing QR...</div>
                  )}
                </div>

                <div style={{ background: 'linear-gradient(180deg, rgba(28,28,28,0.98), rgba(14,14,14,0.98))', border: '1px solid rgba(255,255,255,0.11)', borderRadius: '6px', padding: '24px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: '18px' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '18px' }}>
                      <span style={{ color: '#8f8f8f', fontSize: '11px', fontWeight: '700', letterSpacing: '0.12em', textTransform: 'uppercase' }}>PayMongo QRPh</span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '7px', color: qrphPayment?.status === 'paid' ? '#9be7b0' : qrphPayment?.status === 'failed' ? '#ff9a9a' : '#cfcfcf', fontSize: '10px', fontWeight: '700', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                        <span style={{ width: '7px', height: '7px', borderRadius: '999px', background: qrphPayment?.status === 'paid' ? '#55d678' : qrphPayment?.status === 'failed' ? '#ff6f6f' : '#a7a7a7' }} />
                        {qrphPayment?.status === 'paid' ? 'Paid' : qrphPayment?.status === 'failed' ? 'Failed' : 'Waiting'}
                      </span>
                    </div>

                    <div style={{ marginBottom: '18px' }}>
                      <div style={{ color: '#777', fontSize: '12px', marginBottom: '5px' }}>Amount due</div>
                      <div style={{ color: '#fff', fontSize: '34px', lineHeight: 1, fontWeight: '650', letterSpacing: '-0.02em' }}>
                        {qrphPayment?.amount ? formatCurrencyFromMinor(qrphPayment.amount, qrphPayment.currency) : PLAN_PRICES[form.plan]}
                      </div>
                    </div>

                    <div style={{ display: 'grid', gap: '12px', color: '#b6b6b6', fontSize: '13px', lineHeight: 1.45 }}>
                      {[
                        'Open your banking or e-wallet app and scan the QR code.',
                        'Keep this window open while PayMongo confirms the payment.',
                        'Your claws are added automatically after confirmation.',
                      ].map((item, index) => (
                        <div key={item} style={{ display: 'grid', gridTemplateColumns: '18px 1fr', gap: '10px', alignItems: 'start' }}>
                          <span style={{ color: '#777', fontSize: '11px', fontWeight: '700', paddingTop: '2px' }}>{index + 1}</span>
                          <span>{item}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div style={{ borderTop: '1px solid rgba(255,255,255,0.09)', paddingTop: '16px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      onClick={() => setStep(2)}
                      style={{ flex: '1 1 120px', padding: '12px 14px', background: 'transparent', color: '#d5d5d5', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '5px', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      onClick={handleClose}
                      style={{ flex: '1 1 150px', padding: '12px 14px', background: '#f4f4f4', color: '#080808', border: '1px solid #f4f4f4', borderRadius: '5px', cursor: 'pointer', fontSize: '13px', fontWeight: '700' }}
                    >
                      {qrphPayment?.status === 'paid' ? 'Done' : 'Close'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* Header */}
              <div className="top-up-checkout-summary" style={{ background: '#1f1f1f', borderRadius: '8px', padding: '16px 20px', marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: '#aaa', fontSize: '14px' }}>Selected: <strong style={{ color: '#fff' }}>{PLAN_LABELS[form.plan]}</strong> · GCash Manual</span>
                <span style={{ color: '#FFD700', fontWeight: '700', fontSize: '16px' }}>{PLAN_PRICES[form.plan]}</span>
              </div>
              
              {/* Warning Alert */}
              <div className="top-up-manual-alert" style={{ background: 'rgba(255, 215, 0, 0.05)', borderLeft: '3px solid #FFD700', borderRadius: '4px', padding: '16px', marginBottom: '32px', display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                <AlertTriangle size={20} color="#FFD700" style={{ flexShrink: 0, marginTop: '2px' }} />
                <div style={{ color: '#ccc', fontSize: '13px', lineHeight: 1.6 }}>
                  <strong style={{ color: '#FFD700' }}>Manual GCash is not automated.</strong> Submit only once after paying. Duplicate or repeated proof submissions after claws are already added may be blocked for 7 days. Use the same email/account you want credited.
                </div>
              </div>

              {/* Two Column Layout */}
              <div className="top-up-checkout-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '32px', marginBottom: '32px', alignItems: 'start' }}>
                
                {/* Left: QR Code */}
                <div className="top-up-qr-panel" style={{ textAlign: 'center', background: '#1a1a1a', border: '1px solid #333', borderRadius: '12px', padding: '32px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div className="top-up-qr-frame" style={{ background: '#fff', borderRadius: '12px', padding: '12px', display: 'inline-block', marginBottom: '20px', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}>
                    <img src="/gcash_qr.png" alt="GCash QR" style={{ width: '100%', maxWidth: '220px', height: 'auto', objectFit: 'contain', display: 'block', borderRadius: '4px' }} />
                  </div>
                  <p style={{ color: '#fff', fontSize: '15px', fontWeight: '600', margin: '0 0 6px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Smartphone size={18} color="#FFD700" style={{ marginRight: '8px' }} /> Scan with GCash</p>
                  <p style={{ color: '#888', fontSize: '13px', margin: 0, letterSpacing: '0.5px' }}>LL**D D. · +63 948 562 ••••</p>
                </div>

                {/* Right: Form */}
                <div className="top-up-checkout-form" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  <div className="top-up-form-field">
                    <label style={{ display: 'block', color: '#888', fontSize: '12px', fontWeight: '600', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>GCash Number *</label>
                    <input type="text" placeholder="e.g. 09123456789" value={form.txnRef} onChange={e => setForm(f => ({ ...f, txnRef: e.target.value }))} style={{ width: '100%', background: '#1a1a1a', border: '1px solid #333', borderRadius: '8px', padding: '14px 16px', color: '#fff', fontSize: '15px', outline: 'none', boxSizing: 'border-box', transition: 'border-color 0.2s' }} onFocus={e => e.target.style.borderColor = '#FFD700'} onBlur={e => e.target.style.borderColor = '#333'} />
                  </div>
                  <div className="top-up-form-field">
                    <label style={{ display: 'block', color: '#888', fontSize: '12px', fontWeight: '600', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Upload Proof of Payment *</label>
                    <input type="file" accept="image/*" onChange={e => { if (e.target.files[0]) setForm(f => ({ ...f, screenshotName: e.target.files[0].name, screenshotFile: e.target.files[0] })) }} style={{ display: 'none' }} id="proof-upload" />
                    <label className="top-up-proof-upload" htmlFor="proof-upload" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', background: '#1a1a1a', border: form.screenshotName ? '1px solid #FFD700' : '1px dashed #444', borderRadius: '8px', padding: '12px 16px', color: form.screenshotName ? '#FFD700' : '#666', fontSize: '14px', cursor: 'pointer', boxSizing: 'border-box', transition: 'all 0.2s' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><ImageIcon size={18} /> {form.screenshotName || 'Select screenshot...'}</span>
                      <span style={{ fontSize: '12px', fontWeight: '600', background: form.screenshotName ? '#FFD700' : '#333', color: form.screenshotName ? '#000' : '#fff', padding: '6px 12px', borderRadius: '4px', transition: 'all 0.2s' }}>Browse</span>
                    </label>
                  </div>
                  <div className="top-up-form-field">
                    <label style={{ display: 'block', color: '#666', fontSize: '12px', fontWeight: '600', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Your Email (Auto-filled)</label>
                    <input type="text" value={user?.email || ''} readOnly style={{ width: '100%', background: 'transparent', border: '1px solid #222', borderRadius: '8px', padding: '14px 16px', color: '#555', fontSize: '15px', outline: 'none', boxSizing: 'border-box', cursor: 'not-allowed' }} />
                  </div>
                  <p style={{ margin: '4px 0 0', color: '#888', fontSize: '13px', lineHeight: 1.6 }}>After paying, fill in the number, attach screenshot and submit. Claws arrive within <strong style={{ color: '#FFD700' }}>10–30 minutes</strong>.</p>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="top-up-checkout-actions" style={{ display: 'flex', gap: '12px', borderTop: '1px solid #2a2a2a', paddingTop: '24px' }}>
                <button className="top-up-secondary-button" onClick={() => setStep(2)} disabled={isSubmitting} style={{ padding: '14px 28px', background: 'transparent', color: '#aaa', border: '1px solid #444', borderRadius: '8px', cursor: isSubmitting ? 'not-allowed' : 'pointer', fontSize: '15px', fontWeight: '600', transition: 'all 0.2s' }} onMouseOver={e => { if(!isSubmitting){ e.currentTarget.style.color = '#fff'; e.currentTarget.style.borderColor = '#666'; } }} onMouseOut={e => { if(!isSubmitting){ e.currentTarget.style.color = '#aaa'; e.currentTarget.style.borderColor = '#444'; } }}>Back</button>
                <button 
                  className="top-up-submit-button"
                  onClick={handleSubmit} 
                  disabled={isSubmitting} 
                  style={{ flex: 1, padding: '14px', background: '#FFD700', color: '#000', border: 'none', borderRadius: '8px', cursor: isSubmitting ? 'not-allowed' : 'pointer', fontSize: '15px', fontWeight: '700', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'opacity 0.2s', opacity: isSubmitting ? 0.7 : 1 }}
                  onMouseOver={e => { if(!isSubmitting) e.currentTarget.style.opacity = '0.9'; }}
                  onMouseOut={e => { if(!isSubmitting) e.currentTarget.style.opacity = '1'; }}
                >
                  {isSubmitting ? 'Submitting...' : 'Submit Payment'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
});

export default TopUpModal;
