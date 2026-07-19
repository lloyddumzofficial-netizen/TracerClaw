"use client";

import { memo, useState, useCallback, useEffect } from "react";
import { X, Shirt, CheckCircle, Package, Tag, Mail, Smartphone, Check, ArrowRight, ImageIcon, History, Clock, CreditCard, AlertTriangle } from "lucide-react";
import { toast } from "@/components/Toast";
import { createClient } from "@/utils/supabase/client";
import { CREDIT_PLANS } from "@/lib/paymentPlans";

// Derived from CREDIT_PLANS — single source of truth.
// To change prices, edit src/lib/paymentPlans.js only.
const PLANS_META = {
  tingi:   { desc: 'Small package for quick tests.',                          features: ['2 HD Vector Traces', 'Standard Processing'] },
  basic:   { desc: 'Great for hobbyists printing occasionally.',               features: ['5 HD Vector Traces', 'Standard Processing'] },
  starter: { desc: 'Ideal for small businesses taking their first steps.',     features: ['10 HD Vector Traces', 'Priority Processing', 'Email support'] },
  pro:     { desc: 'Perfect for print shops & growing design studios.',        best: true, features: ['35 HD Vector Traces', 'Highest Priority Queue', 'Unlimited storage', 'Priority support'] },
};

const PLANS = Object.values(CREDIT_PLANS).map((plan) => ({
  key:      plan.key,
  label:    plan.label,
  traces:   plan.credits,
  price:    plan.price,
  desc:     PLANS_META[plan.key]?.desc || '',
  best:     PLANS_META[plan.key]?.best || false,
  features: PLANS_META[plan.key]?.features || [],
}));

const PLAN_LABELS = Object.fromEntries(
  Object.values(CREDIT_PLANS).map((p) => [p.key, `${p.label} — ${p.credits} Credits`])
);
const PLAN_PRICES = Object.fromEntries(
  Object.values(CREDIT_PLANS).map((p) => [p.key, p.price])
);
const DODO_ENABLED_PLANS = new Set(
  Object.values(CREDIT_PLANS).filter((p) => p.dodoEnabled).map((p) => p.key)
);


const TopUpModal = memo(function TopUpModal({ show = true, user, supabase: supabaseProp, onClose, onLoginRequired }) {
  const [fallbackSupabase] = useState(() => createClient());
  const supabase = supabaseProp || fallbackSupabase;
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({ plan: "pro", txnRef: "", screenshotName: "", screenshotFile: null });
  const [submitted, setSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isStartingDodo, setIsStartingDodo] = useState(false);
  const [activeTab, setActiveTab] = useState("plans");
  const [logs, setLogs] = useState([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);

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

  const handleClose = useCallback(() => {
    onClose();
    setStep(1);
    setSubmitted(false);
    setIsStartingDodo(false);
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

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to start Dodo checkout");
      if (!data.checkoutUrl) throw new Error("Dodo checkout URL is missing");

      window.location.href = data.checkoutUrl;
    } catch (err) {
      toast.error(err.message || "Failed to start Dodo checkout");
    } finally {
      setIsStartingDodo(false);
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
      const fileExt = form.screenshotFile.name.split(".").pop();
      const fileName = `proof_${user.id}_${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from("payment_proofs")
        .upload(fileName, form.screenshotFile);
      if (uploadError) throw uploadError;

      const { data: publicData } = supabase.storage.from("payment_proofs").getPublicUrl(fileName);

      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Please log in again before submitting payment proof.");

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

      const data = await response.json();

      // If this reference was already approved, credits are already in their account.
      // Treat this as success/info — not an error — so users aren't confused.
      if (data.alreadyApproved) {
        toast.success("✅ Your credits were already added! Please check your balance.");
        setSubmitted(true);
        return;
      }

      if (!response.ok) throw new Error(data.error || "Failed to submit payment request.");

      setSubmitted(true);
    } catch (err) {
      toast.error(`Error submitting request: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  }, [form, user, supabase]);

  if (!show) return null;

  return (
    <div className="modal-overlay" onClick={handleClose} style={{ padding: '24px' }}>
      <div className="modal-content" style={{ maxWidth: '960px', width: '100%', maxHeight: 'calc(100vh - 48px)', padding: '0', overflow: 'hidden', borderRadius: '0', border: '1px solid #444', background: '#262626', display: 'flex', flexDirection: 'column' }} onClick={(e) => e.stopPropagation()}>
        
        {/* Modal Header */}
        <div style={{ background: '#2a2a2a', borderBottom: '1px solid #444', padding: '24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Shirt size={18} color="#fff" />
            <span style={{ fontWeight: '600', fontSize: '15px', color: '#fff' }}>Get More Traces</span>
          </div>
          {!submitted && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              {activeTab === 'plans' && [1, 2].map(s => (
                <div key={s} style={{ width: '24px', height: '24px', borderRadius: '50%', background: step >= s ? '#fff' : '#27272a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: '600', color: step >= s ? '#000' : '#888', transition: 'all 0.2s' }}>{s}</div>
              ))}
            </div>
          )}
          <button onClick={handleClose} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', padding: '4px' }}><X size={16} /></button>
        </div>

        {/* Tab Navigation */}
        <div style={{ display: 'flex', background: '#2a2a2a', borderBottom: '1px solid #444', padding: '0 24px', flexShrink: 0 }}>
          <button 
            onClick={() => { setActiveTab('plans'); setStep(1); }} 
            style={{ padding: '16px 20px', background: 'none', border: 'none', borderBottom: activeTab === 'plans' ? '2px solid #FFD700' : '2px solid transparent', color: activeTab === 'plans' ? '#FFD700' : '#888', fontWeight: '600', fontSize: '14px', cursor: 'pointer', transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            <Package size={16} /> Top-Up Plans
          </button>
          <button 
            onClick={() => { setActiveTab('history'); setStep(1); }} 
            style={{ padding: '16px 20px', background: 'none', border: 'none', borderBottom: activeTab === 'history' ? '2px solid #FFD700' : '2px solid transparent', color: activeTab === 'history' ? '#FFD700' : '#888', fontWeight: '600', fontSize: '14px', cursor: 'pointer', transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            <History size={16} /> Token Logs
          </button>
        </div>

        <div style={{ background: '#262626', padding: '24px', overflowY: 'auto', minHeight: 0 }}>
          {activeTab === 'history' ? (
            <div style={{ minHeight: '300px' }}>
              <div style={{ marginBottom: '24px' }}>
                <h2 style={{ margin: '0 0 8px', fontSize: '24px', fontWeight: '700', color: '#fff' }}>Token History</h2>
                <p style={{ margin: 0, color: '#aaa', fontSize: '14px' }}>View your recent credit transactions and usage. Logs are automatically deleted after 3 days.</p>
              </div>
              
              {!user ? (
                <div style={{ textAlign: 'center', padding: '40px 20px', color: '#888' }}>Please log in to view your token history.</div>
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
              <p style={{ color: '#666', fontSize: '12px', margin: '0 0 24px' }}>Credits are usually added within <strong style={{ color: '#FFD700' }}>10-30 minutes</strong>. Thank you.</p>
              <button onClick={handleClose} style={{ width: '100%', padding: '14px', background: 'transparent', color: '#fff', border: '1px solid #444', borderRadius: '4px', cursor: 'pointer', fontWeight: '600', fontSize: '14px', transition: 'all 0.2s' }} onMouseEnter={e => { e.currentTarget.style.background = '#333'; e.currentTarget.style.borderColor = '#777'; }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = '#444'; }}>Close</button>
            </div>
          ) : step === 1 ? (
            <>
              <div style={{ textAlign: 'center', marginBottom: '32px' }}>
                {!user && (
                  <div style={{ background: 'rgba(255,215,0,0.1)', border: '1px solid #FFD700', color: '#FFD700', padding: '12px', borderRadius: '8px', marginBottom: '24px', fontSize: '14px', fontWeight: '500' }}>
                    Welcome. You need credits to trace images. Please select a plan and log in.
                  </div>
                )}
                <div style={{ display: 'inline-block', border: '1px solid #555', padding: '4px 12px', fontSize: '11px', fontWeight: '600', color: '#ccc', letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: '16px', borderRadius: '4px' }}>Pricing Plan</div>
                <h2 style={{ margin: '0 0 8px', fontSize: '28px', fontWeight: '700', color: '#fff' }}>Affordable pricing</h2>
                <p style={{ margin: 0, color: '#aaa', fontSize: '14px', maxWidth: '500px', marginLeft: 'auto', marginRight: 'auto' }}>Choose the credit package that fits your workflow.</p>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '24px' }}>
                {PLANS.map(p => (
                  <div key={p.key} style={{ background: p.best ? '#333' : '#2a2a2a', border: `1px solid ${p.best ? '#FFD700' : '#444'}`, padding: '32px 24px', display: 'flex', flexDirection: 'column', position: 'relative', borderRadius: '6px' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', marginBottom: '16px' }}>
                      <div style={{ fontSize: '16px', fontWeight: '500', color: '#fff' }}>{p.label}</div>
                      {p.best && <div style={{ background: '#FFD700', color: '#000', fontSize: '11px', fontWeight: '800', padding: '4px 8px', display: 'flex', alignItems: 'center', gap: '4px', borderRadius: '4px', whiteSpace: 'nowrap' }}><CheckCircle size={12} /> Most popular</div>}
                    </div>

                    <div style={{ marginBottom: '16px', display: 'flex', alignItems: 'baseline', gap: '4px' }}>
                      <span style={{ fontSize: '36px', fontWeight: '700', color: '#fff', letterSpacing: '-1px' }}>{p.price}</span>
                      <span style={{ fontSize: '12px', color: '#888' }}>/ {p.traces} credits</span>
                    </div>
                    
                    <p style={{ color: '#aaa', fontSize: '13px', lineHeight: '1.5', margin: '0 0 24px', minHeight: '40px' }}>{p.desc}</p>

                    <button 
                      onClick={() => { 
                        if (!user) {
                          onLoginRequired?.();
                          return;
                        }
                        setForm(f => ({ ...f, plan: p.key })); 
                        setStep(2); 
                      }}
                      style={{ width: '100%', padding: '12px 8px', background: p.best ? '#FFD700' : 'transparent', color: p.best ? '#000' : '#d5d5d5', border: p.best ? 'none' : '1px solid #555', fontWeight: '600', fontSize: '13px', cursor: 'pointer', transition: 'all 0.2s', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '6px', marginBottom: '32px', borderRadius: '4px', whiteSpace: 'nowrap' }} 
                      onMouseOver={e => { e.target.style.opacity = '0.9'; if (!p.best) { e.target.style.background = '#3a3a3a'; e.target.style.borderColor = '#777'; } }} 
                      onMouseOut={e => { e.target.style.opacity = '1'; if (!p.best) { e.target.style.background = 'transparent'; e.target.style.borderColor = '#555'; } }}
                    >
                      {user ? 'Select Plan' : 'Log in to Purchase'} <ArrowRight size={14} />
                    </button>

                    <div style={{ borderTop: '1px solid #444', margin: '0 -24px 24px' }}></div>

                    <div style={{ fontSize: '12px', fontWeight: '600', color: '#888', marginBottom: '16px' }}>What's Included:</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flex: 1 }}>
                      {p.features.map((feat, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#d5d5d5', fontSize: '13px' }}>
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
              <div style={{ textAlign: 'center', marginBottom: '28px' }}>
                <div style={{ display: 'inline-block', border: '1px solid #555', padding: '4px 12px', fontSize: '11px', fontWeight: '600', color: '#ccc', letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: '16px', borderRadius: '4px' }}>Payment Method</div>
                <h2 style={{ margin: '0 0 8px', fontSize: '28px', fontWeight: '700', color: '#fff' }}>Choose how to pay</h2>
                <p style={{ margin: 0, color: '#aaa', fontSize: '14px' }}>
                  Selected: <strong style={{ color: '#FFD700' }}>{PLAN_LABELS[form.plan]}</strong> · <strong style={{ color: '#fff' }}>{PLAN_PRICES[form.plan]}</strong>
                </p>
                {form.plan === 'tingi' && (
                  <p style={{ margin: '10px 0 0', color: '#FFD700', fontSize: '13px', fontWeight: '600' }}>
                    Mini is GCash-only. Card / International starts at Basic.
                  </p>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px', marginBottom: '24px' }}>
                <button
                  type="button"
                  onClick={() => setStep(3)}
                  style={{ background: '#2a2a2a', border: '1px solid #444', color: '#fff', padding: '24px', textAlign: 'left', cursor: 'pointer', borderRadius: '6px', display: 'flex', flexDirection: 'column', gap: '12px' }}
                >
                  <Smartphone size={26} color="#FFD700" />
                  <span style={{ fontSize: '18px', fontWeight: '700' }}>GCash Manual</span>
                  <span style={{ color: '#aaa', fontSize: '13px', lineHeight: 1.5 }}>Scan the QR code, upload payment proof, then wait for admin approval. Best for Philippine GCash users.</span>
                  <span style={{ color: '#FFD700', fontSize: '12px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Manual approval</span>
                </button>

                <button
                  type="button"
                  onClick={handleStartDodoCheckout}
                  disabled={isStartingDodo || form.plan === 'tingi'}
                  style={{ background: '#333', border: '1px solid #FFD700', color: '#fff', padding: '24px', textAlign: 'left', cursor: (isStartingDodo || form.plan === 'tingi') ? 'not-allowed' : 'pointer', borderRadius: '6px', display: 'flex', flexDirection: 'column', gap: '12px', opacity: (isStartingDodo || form.plan === 'tingi') ? 0.55 : 1 }}
                >
                  <CreditCard size={26} color="#FFD700" />
                  <span style={{ fontSize: '18px', fontWeight: '700' }}>Card / International</span>
                  <span style={{ color: '#aaa', fontSize: '13px', lineHeight: 1.5 }}>
                    {form.plan === 'tingi'
                      ? 'Not available for Mini because card fees are too high for micro-payments.'
                      : 'Pay through Dodo Payments hosted checkout. Credits are added automatically after payment confirmation.'}
                  </span>
                  <span style={{ color: '#FFD700', fontSize: '12px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    {form.plan === 'tingi' ? 'Choose Basic or higher' : isStartingDodo ? 'Starting checkout...' : 'Automated checkout'}
                  </span>
                </button>
              </div>

              <button onClick={() => setStep(1)} disabled={isStartingDodo} style={{ padding: '12px 24px', background: 'transparent', color: '#d5d5d5', border: '1px solid #555', borderRadius: '6px', cursor: isStartingDodo ? 'not-allowed' : 'pointer', fontSize: '14px', fontWeight: '500' }}>Back</button>
            </>
          ) : (
            <>
              {/* Header */}
              <div style={{ background: '#1f1f1f', borderRadius: '8px', padding: '16px 20px', marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: '#aaa', fontSize: '14px' }}>Selected: <strong style={{ color: '#fff' }}>{PLAN_LABELS[form.plan]}</strong> · GCash Manual</span>
                <span style={{ color: '#FFD700', fontWeight: '700', fontSize: '16px' }}>{PLAN_PRICES[form.plan]}</span>
              </div>
              
              {/* Warning Alert */}
              <div style={{ background: 'rgba(255, 215, 0, 0.05)', borderLeft: '3px solid #FFD700', borderRadius: '4px', padding: '16px', marginBottom: '32px', display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                <AlertTriangle size={20} color="#FFD700" style={{ flexShrink: 0, marginTop: '2px' }} />
                <div style={{ color: '#ccc', fontSize: '13px', lineHeight: 1.6 }}>
                  <strong style={{ color: '#FFD700' }}>Manual GCash is not automated.</strong> Submit only once after paying. Duplicate or repeated proof submissions after credits are already added may be blocked for 7 days. Use the same email/account you want credited.
                </div>
              </div>

              {/* Two Column Layout */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '32px', marginBottom: '32px', alignItems: 'start' }}>
                
                {/* Left: QR Code */}
                <div style={{ textAlign: 'center', background: '#1a1a1a', border: '1px solid #333', borderRadius: '12px', padding: '32px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div style={{ background: '#fff', borderRadius: '12px', padding: '12px', display: 'inline-block', marginBottom: '20px', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}>
                    <img src="/gcash_qr.png" alt="GCash QR" style={{ width: '100%', maxWidth: '220px', height: 'auto', objectFit: 'contain', display: 'block', borderRadius: '4px' }} />
                  </div>
                  <p style={{ color: '#fff', fontSize: '15px', fontWeight: '600', margin: '0 0 6px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Smartphone size={18} color="#FFD700" style={{ marginRight: '8px' }} /> Scan with GCash</p>
                  <p style={{ color: '#888', fontSize: '13px', margin: 0, letterSpacing: '0.5px' }}>LL**D D. · +63 948 562 ••••</p>
                </div>

                {/* Right: Form */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  <div>
                    <label style={{ display: 'block', color: '#888', fontSize: '12px', fontWeight: '600', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>GCash Number *</label>
                    <input type="text" placeholder="e.g. 09123456789" value={form.txnRef} onChange={e => setForm(f => ({ ...f, txnRef: e.target.value }))} style={{ width: '100%', background: '#1a1a1a', border: '1px solid #333', borderRadius: '8px', padding: '14px 16px', color: '#fff', fontSize: '15px', outline: 'none', boxSizing: 'border-box', transition: 'border-color 0.2s' }} onFocus={e => e.target.style.borderColor = '#FFD700'} onBlur={e => e.target.style.borderColor = '#333'} />
                  </div>
                  <div>
                    <label style={{ display: 'block', color: '#888', fontSize: '12px', fontWeight: '600', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Upload Proof of Payment *</label>
                    <input type="file" accept="image/*" onChange={e => { if (e.target.files[0]) setForm(f => ({ ...f, screenshotName: e.target.files[0].name, screenshotFile: e.target.files[0] })) }} style={{ display: 'none' }} id="proof-upload" />
                    <label htmlFor="proof-upload" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', background: '#1a1a1a', border: form.screenshotName ? '1px solid #FFD700' : '1px dashed #444', borderRadius: '8px', padding: '12px 16px', color: form.screenshotName ? '#FFD700' : '#666', fontSize: '14px', cursor: 'pointer', boxSizing: 'border-box', transition: 'all 0.2s' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><ImageIcon size={18} /> {form.screenshotName || 'Select screenshot...'}</span>
                      <span style={{ fontSize: '12px', fontWeight: '600', background: form.screenshotName ? '#FFD700' : '#333', color: form.screenshotName ? '#000' : '#fff', padding: '6px 12px', borderRadius: '4px', transition: 'all 0.2s' }}>Browse</span>
                    </label>
                  </div>
                  <div>
                    <label style={{ display: 'block', color: '#666', fontSize: '12px', fontWeight: '600', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Your Email (Auto-filled)</label>
                    <input type="text" value={user?.email || ''} readOnly style={{ width: '100%', background: 'transparent', border: '1px solid #222', borderRadius: '8px', padding: '14px 16px', color: '#555', fontSize: '15px', outline: 'none', boxSizing: 'border-box', cursor: 'not-allowed' }} />
                  </div>
                  <p style={{ margin: '4px 0 0', color: '#888', fontSize: '13px', lineHeight: 1.6 }}>After paying, fill in the number, attach screenshot and submit. Credits arrive within <strong style={{ color: '#FFD700' }}>10–30 minutes</strong>.</p>
                </div>
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', gap: '12px', borderTop: '1px solid #2a2a2a', paddingTop: '24px' }}>
                <button onClick={() => setStep(2)} disabled={isSubmitting} style={{ padding: '14px 28px', background: 'transparent', color: '#aaa', border: '1px solid #444', borderRadius: '8px', cursor: isSubmitting ? 'not-allowed' : 'pointer', fontSize: '15px', fontWeight: '600', transition: 'all 0.2s' }} onMouseOver={e => { if(!isSubmitting){ e.currentTarget.style.color = '#fff'; e.currentTarget.style.borderColor = '#666'; } }} onMouseOut={e => { if(!isSubmitting){ e.currentTarget.style.color = '#aaa'; e.currentTarget.style.borderColor = '#444'; } }}>Back</button>
                <button 
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
    </div>
  );
});

export default TopUpModal;
