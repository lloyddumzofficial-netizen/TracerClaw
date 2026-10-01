"use client";

import { memo, useState, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { X, Shirt, Package, Check, ArrowRight, History, Clock } from "lucide-react";
import Image from "next/image";
import { toast } from "./Toast";
import { createClient } from "@/utils/supabase/client";
import { CREDIT_PLANS } from "@/lib/paymentPlans";
import { safeJson } from "@/lib/safeJson";
import { analytics } from "@/lib/analytics";
import "./TopUpModal.css";

// Derived from CREDIT_PLANS — single source of truth.
// To change prices, edit src/lib/paymentPlans.js only.
const PLANS_META = {
  tingi:   { eyebrow: 'Quick test', desc: 'For a small file or a fast production check.', features: ['2 standard traces', '1 precision trace', 'QR Ph checkout'] },
  basic:   { eyebrow: 'Occasional work', desc: 'A practical pack for one-off client jobs.', features: ['Up to 5 standard traces', 'Up to 2 precision traces', 'QR Ph or card'] },
  starter: { eyebrow: 'Regular production', desc: 'Built for a steady flow of artwork each week.', features: ['Up to 10 standard traces', 'Up to 5 precision traces', 'QR Ph or card'] },
  pro:     { eyebrow: 'Best value', desc: 'The lowest cost per Claw for active production teams.', best: true, features: ['Up to 35 standard traces', 'Up to 17 precision traces', 'QR Ph or card'] },
};

const PLANS = Object.values(CREDIT_PLANS).map((plan) => ({
  key:      plan.key,
  label:    plan.label,
  traces:   plan.credits,
  price:    plan.price,
  eyebrow: PLANS_META[plan.key]?.eyebrow || '',
  desc:     PLANS_META[plan.key]?.desc || '',
  best:     PLANS_META[plan.key]?.best || false,
  features: PLANS_META[plan.key]?.features || [],
  pricePerClaw: Math.round(plan.amount / 100 / plan.credits),
}));

const PLAN_PRICES = Object.fromEntries(
  Object.values(CREDIT_PLANS).map((p) => [p.key, p.price])
);
const DODO_ENABLED_PLANS = new Set(
  Object.values(CREDIT_PLANS).filter((p) => p.dodoEnabled).map((p) => p.key)
);
const PAYMENT_LOGOS = {
  qrph: "/Payments-logo/qr-ph-logo_svgstack_com_74171786789082.png",
  gcash: "/Payments-logo/gcash-logo.png",
  maya: "/Payments-logo/Maya_logo.svg.webp",
  dodo: "/Payments-logo/dodo-payments.png",
};

function PaymentLogoTile({ src, alt, wide = false, large = false }) {
  const width = large ? 220 : wide ? 180 : 160;
  const height = large ? 80 : 70;
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

function PaymentBrandStrip({ light = false }) {
  return (
    <span className={`top-up-payment-brand-strip${light ? " top-up-payment-brand-strip-light" : ""}`}>
      <Image className="top-up-payment-brand-logo top-up-payment-brand-logo-qrph" src={PAYMENT_LOGOS.qrph} alt="QR Ph" width={94} height={42} />
      <span className="top-up-payment-brand-divider" aria-hidden="true" />
      <Image className="top-up-payment-brand-logo top-up-payment-brand-logo-gcash" src={PAYMENT_LOGOS.gcash} alt="GCash" width={94} height={42} />
      <Image className="top-up-payment-brand-logo top-up-payment-brand-logo-maya" src={PAYMENT_LOGOS.maya} alt="Maya" width={82} height={42} />
    </span>
  );
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

const TopUpModal = memo(function TopUpModal({ show = true, user, supabase: supabaseProp, onClose, onLoginRequired }) {
  const [fallbackSupabase] = useState(() => createClient());
  const supabase = supabaseProp || fallbackSupabase;
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({ plan: "pro" });
  const [isStartingDodo, setIsStartingDodo] = useState(false);
  const [isStartingPayMongo, setIsStartingPayMongo] = useState(false);
  const [qrphPayment, setQrphPayment] = useState(null);
  const [activeTab, setActiveTab] = useState("plans");
  const [logs, setLogs] = useState([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

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
    setIsStartingDodo(false);
    setIsStartingPayMongo(false);
    setQrphPayment(null);
    setActiveTab("plans");
    setForm({ plan: "pro" });
  }, [onClose]);

  const handleStartDodoCheckout = useCallback(async () => {
    if (!user) {
      onLoginRequired?.();
      return;
    }
    if (!DODO_ENABLED_PLANS.has(form.plan)) {
      toast.error("Mini is available through QR Ph only. Choose Basic, Starter, or Professional for card payments.");
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
          <div className="top-up-modal-brand" style={{ display: 'flex', alignItems: 'center', gap: '11px' }}>
            <Shirt size={17} color="#d8d8d8" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              <span style={{ fontWeight: '650', fontSize: '14px', color: '#f3f3f3' }}>Get More Traces</span>
              <span style={{ fontWeight: '500', fontSize: '11px', color: '#7d7d7d' }}>Top up claws for production work</span>
            </div>
          </div>
          <div className="top-up-modal-tabs" role="tablist" aria-label="Claw account navigation" style={{ display: 'flex', background: '#141414', borderBottom: '1px solid rgba(255,255,255,0.08)', padding: '0 24px', flexShrink: 0 }}>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'plans'}
              onClick={() => { setActiveTab('plans'); setStep(1); setQrphPayment(null); }}
              className="top-up-tab-button"
              style={{ padding: '16px 20px', background: 'none', border: 'none', borderBottom: activeTab === 'plans' ? '2px solid #FFD700' : '2px solid transparent', color: activeTab === 'plans' ? '#FFD700' : '#888', fontWeight: '600', fontSize: '14px', cursor: 'pointer', transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: '8px' }}
            >
              <Package size={15} /> Plans
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'history'}
              onClick={() => { setActiveTab('history'); setStep(1); setQrphPayment(null); }}
              className="top-up-tab-button"
              style={{ padding: '16px 20px', background: 'none', border: 'none', borderBottom: activeTab === 'history' ? '2px solid #FFD700' : '2px solid transparent', color: activeTab === 'history' ? '#FFD700' : '#888', fontWeight: '600', fontSize: '14px', cursor: 'pointer', transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: '8px' }}
            >
              <History size={15} /> Activity
            </button>
          </div>
          <button className="top-up-modal-close" aria-label="Close top-up plans" onClick={handleClose} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', padding: '4px' }}><X size={16} /></button>
        </div>

        <div className={`top-up-modal-body${activeTab === 'plans' && step === 1 ? ' top-up-modal-body-plans' : ''}`} style={{ background: '#262626', padding: '24px', overflowY: 'auto', minHeight: 0 }}>
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
          ) : step === 1 ? (
            <>
              <div className="top-up-pricing-hero">
                {!user && (
                  <div className="top-up-login-note">
                    Welcome. You need claws to trace images. Please select a plan and log in.
                  </div>
                )}
                <div className="top-up-pricing-kicker">Pay as you go</div>
                <div className="top-up-pricing-title-row">
                  <h2>Production pricing.<br /><span>No subscription.</span></h2>
                  <p>Buy only the Claws you need. Use them across DesaynClaw production tools without a monthly commitment.</p>
                </div>
              </div>

              <div className="top-up-plans-grid top-up-pricing-table">
                {PLANS.map((p, index) => (
                  <article key={p.key} className={`top-up-plan-card${p.best ? ' top-up-plan-card-featured' : ''}`}>
                    <div className="top-up-plan-topline">
                      <span>{String(index + 1).padStart(2, '0')}</span>
                      <small>{p.eyebrow}</small>
                    </div>

                    <div className="top-up-plan-name">
                      <h3>{p.label}</h3>
                      {p.best && <span>Most efficient</span>}
                    </div>

                    <div className="top-up-plan-price">
                      <strong>{p.price}</strong>
                      <span>one-time</span>
                    </div>

                    <div className="top-up-plan-claws">
                      <strong>{p.traces}</strong>
                      <span>Claws</span>
                      <small>₱{p.pricePerClaw} each</small>
                    </div>

                    <p className="top-up-plan-desc">{p.desc}</p>

                    <ul className="top-up-plan-features">
                      {p.features.map((feat) => (
                        <li className="top-up-plan-feature" key={feat}><Check size={14} aria-hidden="true" /> {feat}</li>
                      ))}
                    </ul>

                    <button 
                      onClick={() => { 
                        if (!user) {
                          onLoginRequired?.();
                          return;
                        }
                        setForm(f => ({ ...f, plan: p.key })); 
                        setStep(2); 
                      }}
                      className={`top-up-plan-button${p.best ? ' top-up-plan-button-featured' : ''}`}
                    >
                      {user ? 'Select Plan' : 'Log in to Purchase'} <ArrowRight size={14} />
                    </button>
                  </article>
                ))}
              </div>
            </>
          ) : step === 2 ? (
            <>
              <div className="top-up-payment-hero" style={{ textAlign: 'center', marginBottom: '28px' }}>
                <div className="top-up-payment-eyebrow">Checkout · Step 2 of 2</div>
                <h2>How would you like to pay?</h2>
                <p>Pay once and your Claws are credited automatically after confirmation.</p>
                <div className="top-up-payment-plan-summary">
                  <span className="top-up-payment-plan-name">Selected · {CREDIT_PLANS[form.plan]?.label}</span>
                  <span className="top-up-payment-plan-values">
                    <strong className="top-up-payment-plan-value">{CREDIT_PLANS[form.plan]?.credits} Claws</strong>
                    <span className="top-up-payment-plan-dot" aria-hidden="true">·</span>
                    <strong className="top-up-payment-plan-value">{PLAN_PRICES[form.plan]} total</strong>
                  </span>
                </div>
              </div>

              <div className="top-up-payment-grid">
                <button
                  type="button"
                  className="top-up-payment-option top-up-payment-option-featured"
                  onClick={handleStartPayMongoCheckout}
                  disabled={isStartingPayMongo || isStartingDodo}
                  style={{ cursor: (isStartingPayMongo || isStartingDodo) ? 'not-allowed' : 'pointer', opacity: (isStartingPayMongo || isStartingDodo) ? 0.65 : 1 }}
                >
                  <span className="top-up-payment-option-head">
                    <PaymentBrandStrip />
                    <span className="top-up-payment-option-tag">Recommended</span>
                  </span>
                  <span className="top-up-payment-copy">
                    <span className="top-up-payment-option-index">01 · Local e-wallet</span>
                    <span className="top-up-payment-title">Pay with QR Ph</span>
                    <span className="top-up-payment-desc">
                      Generate a secure QR code, then scan it using GCash, Maya, or any QR Ph-enabled app.
                    </span>
                  </span>
                  <span className="top-up-payment-option-foot">
                    <span>No screenshot or manual approval</span>
                    <span className="top-up-payment-status">
                      {isStartingPayMongo ? 'Generating QR…' : <>Continue <ArrowRight size={14} /></>}
                    </span>
                  </span>
                </button>

                <button
                  type="button"
                  className="top-up-payment-option"
                  onClick={handleStartDodoCheckout}
                  disabled={isStartingDodo || isStartingPayMongo || form.plan === 'tingi'}
                  style={{ cursor: (isStartingDodo || isStartingPayMongo || form.plan === 'tingi') ? 'not-allowed' : 'pointer', opacity: (isStartingDodo || isStartingPayMongo || form.plan === 'tingi') ? 0.58 : 1 }}
                >
                  <span className="top-up-payment-option-head">
                    <PaymentLogoTile src={PAYMENT_LOGOS.dodo} alt="Dodo Payments" wide />
                    <span className="top-up-payment-option-tag">Cards worldwide</span>
                  </span>
                  <span className="top-up-payment-copy">
                    <span className="top-up-payment-option-index">02 · Card checkout</span>
                    <span className="top-up-payment-title">Pay by card</span>
                    <span className="top-up-payment-desc">
                      {form.plan === 'tingi'
                        ? 'Card checkout starts at Basic. Use QR Ph for the Mini package.'
                        : 'Pay securely using your debit or credit card through the Dodo hosted checkout.'}
                    </span>
                  </span>
                  <span className="top-up-payment-option-foot">
                    <span>{form.plan === 'tingi' ? 'Unavailable for Mini' : 'Debit and credit cards supported'}</span>
                    <span className="top-up-payment-status">
                      {form.plan === 'tingi' ? 'Basic or higher' : isStartingDodo ? 'Opening…' : <>Continue <ArrowRight size={14} /></>}
                    </span>
                  </span>
                </button>
              </div>

              <div className="top-up-payment-nav">
                <button className="top-up-secondary-button" onClick={() => setStep(1)} disabled={isStartingPayMongo || isStartingDodo} style={{ padding: '12px 24px', background: 'transparent', color: '#d5d5d5', border: '1px solid #555', borderRadius: '6px', cursor: (isStartingPayMongo || isStartingDodo) ? 'not-allowed' : 'pointer', fontSize: '14px', fontWeight: '500' }}>← Back to plans</button>
              </div>
            </>
          ) : step === "qrph" ? (
            <div className="top-up-qrph-screen">
              <div className="top-up-qrph-header">
                <span className="top-up-qrph-eyebrow">QR Ph · Automatic payment</span>
                <h2>Scan with GCash or Maya</h2>
                <p>Open your e-wallet, scan the code, and confirm the exact amount.</p>
                <div className="top-up-qrph-order" aria-label="Selected package and amount">
                  <span>{CREDIT_PLANS[form.plan]?.label} package</span>
                  <strong>{CREDIT_PLANS[form.plan]?.credits} Claws</strong>
                  <span aria-hidden="true">·</span>
                  <strong>{qrphPayment?.amount ? formatCurrencyFromMinor(qrphPayment.amount, qrphPayment.currency) : PLAN_PRICES[form.plan]}</strong>
                </div>
              </div>

              <div className="top-up-qrph-layout">
                <div className="top-up-qrph-code-card">
                  {qrphPayment?.qrImageUrl ? (
                    <img
                      src={qrphPayment.qrImageUrl}
                      alt="QRPh payment code"
                      className="top-up-qrph-code"
                    />
                  ) : (
                    <div className="top-up-qrph-preparing">Preparing QR...</div>
                  )}
                  <PaymentBrandStrip light />
                </div>

                <div className="top-up-qrph-details">
                  <div>
                    <div className="top-up-qrph-details-head">
                      <span className="top-up-qrph-provider">Secure checkout</span>
                      <span
                        className={`top-up-qrph-status top-up-qrph-status-${qrphPayment?.status === 'paid' ? 'paid' : qrphPayment?.status === 'failed' ? 'failed' : 'waiting'}`}
                        role="status"
                        aria-live="polite"
                      >
                        <span className="top-up-qrph-status-dot" aria-hidden="true" />
                        {qrphPayment?.status === 'paid' ? 'Paid' : qrphPayment?.status === 'failed' ? 'Failed' : 'Waiting for payment'}
                      </span>
                    </div>

                    <div className="top-up-qrph-amount">
                      <span>Amount due</span>
                      <strong>
                        {qrphPayment?.amount ? formatCurrencyFromMinor(qrphPayment.amount, qrphPayment.currency) : PLAN_PRICES[form.plan]}
                      </strong>
                    </div>

                    <div className="top-up-qrph-steps">
                      {[
                        'Open GCash or Maya and tap Scan QR.',
                        'Scan this code and confirm the exact amount shown.',
                        'Keep this window open—your Claws are added automatically after confirmation.',
                      ].map((item, index) => (
                        <div className="top-up-qrph-step" key={item}>
                          <span>{index + 1}</span>
                          <span>{item}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="top-up-qrph-footer">
                    <p>Keep this window open while we confirm your payment.</p>
                    <div className="top-up-qrph-actions">
                    <button
                      type="button"
                      onClick={() => setStep(2)}
                      className="top-up-qrph-button top-up-qrph-button-secondary"
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      onClick={handleClose}
                      className="top-up-qrph-button top-up-qrph-button-primary"
                    >
                      {qrphPayment?.status === 'paid' ? 'Done' : 'Close'}
                    </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>,
    document.body
  );
});

export default TopUpModal;
