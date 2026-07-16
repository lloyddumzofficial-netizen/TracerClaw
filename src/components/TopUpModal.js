"use client";

import { memo, useState, useCallback, useEffect } from "react";
import { X, Shirt, CheckCircle, Package, Tag, Mail, Smartphone, Check, ArrowRight, ImageIcon, History, Clock } from "lucide-react";
import { toast } from "@/components/Toast";

const PLANS = [
  { 
    key: 'tingi', label: 'Tingi', traces: 2, price: '₱50', 
    desc: 'Sachet pricing. Good for a quick test.',
    features: ['2 HD Vector Traces', 'Standard Processing'] 
  },
  { 
    key: 'basic', label: 'Basic', traces: 4, price: '₱100', 
    desc: 'Great for hobbyists printing occasionally.',
    features: ['4 HD Vector Traces', 'Standard Processing'] 
  },
  { 
    key: 'starter', label: 'Starter', traces: 13, price: '₱290', 
    desc: 'Ideal for small businesses taking their first steps.',
    features: ['13 HD Vector Traces', 'Priority Processing', 'Email support'] 
  },
  { 
    key: 'pro', label: 'Professional', traces: 45, price: '₱870', 
    desc: 'Perfect for print shops & growing design studios.',
    best: true,
    features: ['45 HD Vector Traces', 'Highest Priority Queue', 'Unlimited storage', 'Priority support'] 
  }
];

const PLAN_LABELS = { 
  tingi: "Tingi — 2 Credits", 
  basic: "Basic — 4 Credits", 
  starter: "Starter — 13 Credits", 
  pro: "Professional — 45 Credits" 
};
const PLAN_PRICES = { tingi: "₱50", basic: "₱100", starter: "₱290", pro: "₱870" };

const TopUpModal = memo(function TopUpModal({ show, user, supabase, onClose, onLoginRequired }) {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({ plan: "pro", txnRef: "", screenshotName: "", screenshotFile: null });
  const [submitted, setSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
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
    setActiveTab("plans");
    setForm({ plan: "pro", txnRef: "", screenshotName: "", screenshotFile: null });
  }, [onClose]);

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

      const { error: dbError } = await supabase.from("payment_requests").insert({
        user_id: user.id,
        email: user.email,
        plan: form.plan,
        reference_number: form.txnRef,
        proof_url: publicData.publicUrl,
      });
      if (dbError) throw dbError;

      setSubmitted(true);
    } catch (err) {
      toast.error(`Error submitting request: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  }, [form, user, supabase]);

  if (!show) return null;

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal-content" style={{ maxWidth: '960px', width: '100%', padding: '0', overflow: 'hidden', borderRadius: '0', border: '1px solid #444', background: '#262626' }} onClick={(e) => e.stopPropagation()}>
        
        {/* Modal Header */}
        <div style={{ background: '#2a2a2a', borderBottom: '1px solid #444', padding: '24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
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
        <div style={{ display: 'flex', background: '#2a2a2a', borderBottom: '1px solid #444', padding: '0 24px' }}>
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

        <div style={{ background: '#262626', padding: '24px' }}>
          {activeTab === 'history' ? (
            <div style={{ minHeight: '300px' }}>
              <div style={{ marginBottom: '24px' }}>
                <h2 style={{ margin: '0 0 8px', fontSize: '24px', fontWeight: '700', color: '#fff' }}>Token History</h2>
                <p style={{ margin: 0, color: '#aaa', fontSize: '14px' }}>Tignan ang iyong mga naging transactions at na-consumeng credits. (Logs are auto-deleted after 3 days)</p>
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
              <div style={{ marginBottom: '12px', display: 'flex', justifyContent: 'center' }}>
                <CheckCircle size={48} color="#4ade80" strokeWidth={1.5} />
              </div>
              <h3 style={{ margin: '0 0 8px', color: '#4ade80', fontWeight: '700' }}>Request Submitted!</h3>
              <p style={{ color: '#888', fontSize: '13px', margin: '0 0 8px' }}>Natanggap namin ang iyong payment request.</p>
              <div style={{ background: '#111', border: '1px solid #2a2a2a', borderRadius: '8px', padding: '14px', margin: '16px 0', textAlign: 'left' }}>
                <p style={{ margin: '0 0 8px', color: '#aaa', fontSize: '12px', display: 'flex', alignItems: 'center' }}><Package size={14} style={{ marginRight: '6px', color: '#888' }} /> Package: <strong style={{ color: '#FFD700', marginLeft: '6px' }}>{PLAN_LABELS[form.plan]}</strong></p>
                <p style={{ margin: '0 0 8px', color: '#aaa', fontSize: '12px', display: 'flex', alignItems: 'center' }}><Tag size={14} style={{ marginRight: '6px', color: '#888' }} /> Ref No: <strong style={{ color: '#fff', marginLeft: '6px' }}>{form.txnRef || '—'}</strong></p>
                <p style={{ margin: 0, color: '#aaa', fontSize: '12px', display: 'flex', alignItems: 'center' }}><Mail size={14} style={{ marginRight: '6px', color: '#888' }} /> Account: <strong style={{ color: '#fff', marginLeft: '6px' }}>{user?.email}</strong></p>
              </div>
              <p style={{ color: '#666', fontSize: '12px', margin: '0 0 20px' }}>Credits will be added within <strong style={{ color: '#4ade80' }}>10–30 minutes</strong>. Salamat! 🙏</p>
              <button onClick={handleClose} style={{ width: '100%', padding: '12px', background: '#222', color: '#fff', border: '1px solid #444', borderRadius: '8px', cursor: 'pointer', fontWeight: '600', fontSize: '13px' }}>Close</button>
            </div>
          ) : step === 1 ? (
            <>
              <div style={{ textAlign: 'center', marginBottom: '32px' }}>
                {!user && (
                  <div style={{ background: 'rgba(255,215,0,0.1)', border: '1px solid #FFD700', color: '#FFD700', padding: '12px', borderRadius: '8px', marginBottom: '24px', fontSize: '14px', fontWeight: '500' }}>
                    👋 Welcome! You need credits to trace images. Please select a plan and log in.
                  </div>
                )}
                <div style={{ display: 'inline-block', border: '1px solid #555', padding: '4px 12px', fontSize: '11px', fontWeight: '600', color: '#ccc', letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: '16px', borderRadius: '4px' }}>Pricing Plan</div>
                <h2 style={{ margin: '0 0 8px', fontSize: '28px', fontWeight: '700', color: '#fff' }}>Affordable pricing</h2>
                <p style={{ margin: 0, color: '#aaa', fontSize: '14px', maxWidth: '500px', marginLeft: 'auto', marginRight: 'auto' }}>Piliin ang credit package na sakto sa pangangailangan mo.</p>
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
          ) : (
            <>
              <div style={{ background: '#2a2a2a', border: '1px solid #444', borderRadius: '8px', padding: '12px 16px', marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: '#aaa', fontSize: '13px' }}>Selected: <strong style={{ color: '#fff' }}>{PLAN_LABELS[form.plan]}</strong></span>
                <span style={{ color: '#FFD700', fontWeight: '600', fontSize: '15px' }}>{PLAN_PRICES[form.plan]}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '30px', marginBottom: '24px', alignItems: 'start' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ background: '#fff', borderRadius: '16px', padding: '16px', display: 'inline-block', marginBottom: '12px', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
                    <img src="/gcash_qr.png" alt="GCash QR" style={{ width: '100%', maxWidth: '280px', height: 'auto', objectFit: 'contain', display: 'block' }} />
                  </div>
                  <p style={{ color: '#FFD700', fontSize: '14px', margin: '0 0 6px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Smartphone size={18} style={{ marginRight: '6px' }} /> Scan with GCash</p>
                  <p style={{ color: '#aaa', fontSize: '13px', margin: 0 }}>LL**D D. · +63 948 562 ••••</p>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', paddingTop: '12px' }}>
                  <div>
                    <label style={{ display: 'block', color: '#aaa', fontSize: '13px', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>GCASH NUMBER *</label>
                    <input type="text" placeholder="e.g. 09123456789" value={form.txnRef} onChange={e => setForm(f => ({ ...f, txnRef: e.target.value }))} style={{ width: '100%', background: '#222', border: '1px solid #444', borderRadius: '8px', padding: '16px', color: '#fff', fontSize: '16px', outline: 'none', boxSizing: 'border-box' }} onFocus={e => e.target.style.borderColor = '#FFD700'} onBlur={e => e.target.style.borderColor = '#444'} />
                  </div>
                  <div>
                    <label style={{ display: 'block', color: '#aaa', fontSize: '13px', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Upload Proof of Payment *</label>
                    <input type="file" accept="image/*" onChange={e => { if (e.target.files[0]) setForm(f => ({ ...f, screenshotName: e.target.files[0].name, screenshotFile: e.target.files[0] })) }} style={{ display: 'none' }} id="proof-upload" />
                    <label htmlFor="proof-upload" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', background: '#222', border: '1px dashed #555', borderRadius: '8px', padding: '14px 16px', color: form.screenshotName ? '#FFD700' : '#888', fontSize: '15px', cursor: 'pointer', boxSizing: 'border-box', transition: 'all 0.2s' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><ImageIcon size={18} /> {form.screenshotName || 'Select screenshot...'}</span>
                      <span style={{ fontSize: '12px', background: '#444', color: '#fff', padding: '6px 10px', borderRadius: '4px' }}>Browse</span>
                    </label>
                  </div>
                  <div>
                    <label style={{ display: 'block', color: '#888', fontSize: '13px', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Your Email (auto-filled)</label>
                    <input type="text" value={user?.email || ''} readOnly style={{ width: '100%', background: '#1a1a1a', border: '1px solid #333', borderRadius: '8px', padding: '16px', color: '#666', fontSize: '16px', outline: 'none', boxSizing: 'border-box', cursor: 'not-allowed' }} />
                  </div>
                  <p style={{ margin: '12px 0 0', color: '#aaa', fontSize: '13px', lineHeight: 1.6 }}>After paying, fill in the reference number, attach your screenshot above and submit. Credits arrive within <strong style={{ color: '#FFD700' }}>10–30 minutes</strong>.</p>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '12px' }}>
                <button onClick={() => setStep(1)} disabled={isSubmitting} style={{ padding: '12px 24px', background: 'transparent', color: '#d5d5d5', border: '1px solid #555', borderRadius: '6px', cursor: isSubmitting ? 'not-allowed' : 'pointer', fontSize: '14px', fontWeight: '500' }}>Back</button>
                <button 
                  onClick={handleSubmit} 
                  disabled={isSubmitting} 
                  style={{ flex: 1, padding: '12px', background: '#fff', color: '#000', border: 'none', borderRadius: '6px', cursor: isSubmitting ? 'not-allowed' : 'pointer', fontSize: '14px', fontWeight: '600', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
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
