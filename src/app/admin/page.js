"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import { toast } from "@/components/ui/Toast";
import { Check, Clock, ExternalLink, LogOut, RefreshCw } from "lucide-react";
import { CREDIT_PLANS } from "@/lib/paymentPlans";
import { safeJson } from "@/lib/safeJson";

import "../globals.css";
import "../home.css";

const ADMIN_PAYMENT_REFRESH_MS = 10_000;

export default function AdminDashboard() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState([]);
  const [approvedRequests, setApprovedRequests] = useState([]);
  const [dodoPayments, setDodoPayments] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [totalProjects, setTotalProjects] = useState(0);
  const [activeCreditsTotal, setActiveCreditsTotal] = useState(0);
  const [paidUsers, setPaidUsers] = useState([]);
  const [processingId, setProcessingId] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [hasNewRequests, setHasNewRequests] = useState(false);
  const router = useRouter();

  const PLAN_PRICES = Object.fromEntries(
    Object.values(CREDIT_PLANS).map((plan) => [plan.key, Math.round(plan.amount / 100)])
  );
  const COST_PER_GENERATION = 2; // Estimated PHP cost per generation

  const [supabase] = useState(() => createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ));

  useEffect(() => {
    let fallbackInterval;
    let realtimeChannel;
    let refreshSilently = () => {};

    const checkAdmin = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session || session.user.email !== 'lloyddumzofficial@gmail.com') {
        router.push('/');
        return;
      }
      setUser(session.user);
      await fetchRequests(session.access_token);
      refreshSilently = () => fetchRequests(session.access_token, { silent: true });

      // Supabase Realtime Subscription
      // Fires instantly when any row in payment_requests changes,
      // with polling below as a fast safety net.
      realtimeChannel = supabase
        .channel('admin_payment_requests')
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'payment_requests' },
          (payload) => {
            // New payment just submitted. Notify admin immediately.
            const email = payload.new?.email || 'a user';
            const plan = payload.new?.plan || 'unknown';
            toast.success(`New payment from ${email} (${plan})`);
            setHasNewRequests(true);
            refreshSilently();
          }
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'payment_requests' },
          () => {
            // Status changed externally (e.g. another session approved it)
            refreshSilently();
          }
        )
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            console.log('[Admin] Realtime connected - instant payment notifications active.');
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.warn('[Admin] Realtime connection issue:', status);
          }
        });

      // Fast fallback in case the realtime WebSocket is disabled or drops.
      fallbackInterval = setInterval(refreshSilently, ADMIN_PAYMENT_REFRESH_MS);
    };

    const handleWindowFocus = () => {
      refreshSilently();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refreshSilently();
      }
    };

    window.addEventListener('focus', handleWindowFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    checkAdmin();

    return () => {
      window.removeEventListener('focus', handleWindowFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (fallbackInterval) clearInterval(fallbackInterval);
      if (realtimeChannel) supabase.removeChannel(realtimeChannel);
    };
  }, [supabase, router]);

  const fetchRequests = async (token, options = {}) => {
    if (!options.silent) setLoading(true);
    if (options.manual) setIsRefreshing(true);
    try {
      const res = await fetch('/api/admin/get-dashboard', {
        headers: { 'Authorization': `Bearer ${token}` },
        cache: 'no-store'
      });
      const data = await safeJson(res, "Failed to load admin dashboard");
      
      if (!res.ok) throw new Error(data.error || "Failed to load admin dashboard");

      const reqData = data.requests || [];
      const pending = reqData.filter(r => r.status === 'pending');
      const approved = reqData.filter(r => r.status === 'approved');
      
      // Show newest pending payments first so fresh user submissions are not
      // buried at the bottom of a long review list.
      setRequests(pending.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
      setApprovedRequests(approved);
      setDodoPayments(data.dodoPayments || []);
      setReviews(data.reviews || []);
      setTotalProjects(data.totalProjects || 0);
      setActiveCreditsTotal(Number(data.activeCreditsTotal || 0));
      setPaidUsers(data.paidUsers || []);

      // Clear the new-request indicator after fetching
      if (options.manual) setHasNewRequests(false);
    } catch (err) {
      toast.error("Failed to load admin data");
      console.error(err);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  };

  const handleManualRefresh = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      fetchRequests(session.access_token, { silent: true, manual: true });
    }
  };

  const handleApprove = async (request, markOnly = false) => {
    setProcessingId(request.id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      const res = await fetch('/api/admin/approve-payment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ requestId: request.id, markOnly })
      });

      const data = await safeJson(res, "Failed to approve payment");
      if (!res.ok) throw new Error(data.error || "Failed to approve payment");

      if (markOnly) {
        toast.success(`Marked as paid! (No credits added)`);
      } else {
        toast.success(`Approved! Added ${data.addedCredits} credits to ${request.email}`);
      }
      
      setRequests(reqs => reqs.filter(r => r.id !== request.id));
      setApprovedRequests(prev => [{ ...request, status: 'approved' }, ...prev]);
      fetchRequests(session.access_token, { silent: true });
    } catch (err) {
      toast.error(err.message || "Failed to approve payment");
    } finally {
      setProcessingId(null);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/');
  };

  if (loading) {
    return (
      <div className="start-screen-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: '#FFD700', fontSize: '14px', fontWeight: '500' }}>Loading Admin Panel...</div>
      </div>
    );
  }

  if (!user) return null;

  const totalRevenue = approvedRequests.reduce((sum, req) => sum + (PLAN_PRICES[req.plan] || 0), 0);
  const totalCost = totalProjects * COST_PER_GENERATION;
  const netProfit = totalRevenue - totalCost;
  const totalActiveCredits = activeCreditsTotal;

  return (
    <div className="start-screen-container">
      <div className="start-center-box" style={{ maxWidth: '700px', marginTop: '20px' }}>
        
        {/* LOGO & TITLE (Matching Homepage Exactly) */}
        <div className="start-logo" style={{ marginBottom: "20px", display: "flex", flexDirection: "column", alignItems: "center", width: "100%" }}>
          <img src="/logo.png" alt="DesaynClaw Logo" style={{ width: "300px", maxWidth: "100%", height: "auto", margin: 0, cursor: 'pointer' }} onClick={() => router.push('/')} />
          <p style={{ fontSize: "14px", color: "#FFD700", margin: "5px 0 0 0", fontWeight: "600", textTransform: 'uppercase', letterSpacing: '1px' }}>Admin Dashboard</p>
          <p style={{ fontSize: "14px", color: "#aaa", textAlign: "center", marginTop: "15px", maxWidth: "420px", lineHeight: "1.6" }}>
            Review and approve pending top-up requests from users.
          </p>
        </div>

        {/* TAB TITLE BADGE — updates browser tab with pending count */}
        {typeof document !== 'undefined' && (() => {
          document.title = requests.length > 0
            ? `(${requests.length}) Admin Dashboard — DesaynClaw`
            : 'Admin Dashboard — DesaynClaw';
          return null;
        })()}

        {/* TOP BUTTONS */}
        <div style={{ display: "flex", gap: "15px", marginBottom: "40px", flexWrap: "wrap", justifyContent: "center", width: "100%" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", background: "transparent", color: "#d5d5d5", border: "1px solid #444", padding: "12px 24px", borderRadius: "4px", fontSize: "16px", fontWeight: "500", whiteSpace: "nowrap" }}>
            Revenue: <strong style={{ color: '#FFD700', fontSize: '18px' }}>₱{totalRevenue.toLocaleString()}</strong>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", background: "transparent", color: "#d5d5d5", border: "1px solid #444", padding: "12px 24px", borderRadius: "4px", fontSize: "16px", fontWeight: "500", whiteSpace: "nowrap" }}>
            Costs: <strong style={{ fontSize: '18px' }}>₱{totalCost.toLocaleString()}</strong>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", background: "transparent", color: "#d5d5d5", border: "1px solid #444", padding: "12px 24px", borderRadius: "4px", fontSize: "16px", fontWeight: "500", whiteSpace: "nowrap" }}>
            Profit: <strong style={{ color: netProfit < 0 ? '#ff4444' : '#4ade80', fontSize: '18px' }}>₱{netProfit.toLocaleString()}</strong>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", background: "transparent", color: "#d5d5d5", border: "1px solid #5a4a00", padding: "12px 24px", borderRadius: "4px", fontSize: "16px", fontWeight: "500", whiteSpace: "nowrap" }}>
            Active Credits: <strong style={{ color: '#FFD700', fontSize: '18px' }}>🪙 {totalActiveCredits.toLocaleString()}</strong>
          </div>
          <button
            className="start-btn"
            onClick={handleManualRefresh}
            disabled={isRefreshing}
            title="Manually refresh dashboard"
            style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", padding: "12px 24px", borderRadius: "4px", fontSize: "16px", background: 'transparent', color: isRefreshing ? '#888' : '#aaa', borderColor: '#555', opacity: isRefreshing ? 0.7 : 1 }}
          >
            <RefreshCw size={16} style={{ animation: isRefreshing ? 'spin 1s linear infinite' : 'none' }} />
            {isRefreshing ? 'Refreshing...' : 'Refresh'}
          </button>
          <button className="start-btn" onClick={handleLogout} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", padding: "12px 24px", borderRadius: "4px", fontSize: "16px" }}>
            <LogOut size={16} /> Logout
          </button>
        </div>

        {/* REQUESTS BOX (Dashed like upload box) */}
        <div className="hero-upload-box" style={{ width: '100%', padding: '20px', minHeight: '300px', justifyContent: requests.length === 0 ? 'center' : 'flex-start' }}>
          
          {requests.length === 0 ? (
            <div style={{ textAlign: 'center' }}>
              <Check size={40} color="#FFD700" style={{ margin: '0 auto 15px' }} />
              <div style={{ fontSize: "16px", color: "#ccc", fontWeight: "500" }}>All caught up!</div>
              <div style={{ marginTop: "10px", color: "#888", fontSize: "13px" }}>No pending payments to review.</div>
            </div>
          ) : (
            <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '15px', maxHeight: '350px', overflowY: 'auto', paddingRight: '10px' }}>
              <div style={{ fontSize: "12px", color: "#FFD700", fontWeight: "600", textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '10px', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                {hasNewRequests && (
                  <span style={{
                    display: 'inline-block',
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    background: '#ff4444',
                    boxShadow: '0 0 0 0 rgba(255,68,68,0.7)',
                    animation: 'pulse-dot 1.5s ease-in-out infinite',
                    flexShrink: 0
                  }} />
                )}
                Pending Requests ({requests.length})
              </div>
              
              {requests.map(req => (
                <div key={req.id} style={{ background: '#222', border: '1px solid #444', borderRadius: '0', padding: '15px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '15px' }}>
                  
                  <div style={{ flex: 1, minWidth: '200px' }}>
                    <div style={{ color: '#888', fontSize: '11px', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      <Clock size={12} /> {new Date(req.created_at).toLocaleString()}
                    </div>
                    <div style={{ fontSize: '14px', fontWeight: '500', color: '#fff', marginBottom: '4px' }}>{req.email}</div>
                    <div style={{ color: '#aaa', fontSize: '12px' }}>
                      Plan: <strong style={{ color: '#FFD700', textTransform: 'capitalize' }}>{req.plan}</strong> &bull; Ref: {req.reference_number}
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    {req.proof_url && (
                      <a href={req.proof_url} target="_blank" rel="noreferrer" className="start-btn" style={{ padding: '8px 12px', fontSize: '11px', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        Receipt <ExternalLink size={12} />
                      </a>
                    )}
                    
                    <button 
                      onClick={() => handleApprove(req, true)}
                      disabled={processingId === req.id}
                      className="start-btn"
                      style={{ 
                        background: 'transparent',
                        color: processingId === req.id ? '#888' : '#aaa', 
                        borderColor: processingId === req.id ? '#444' : '#555',
                        padding: '8px 12px', 
                        fontSize: '11px', 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '6px',
                        opacity: processingId === req.id ? 0.7 : 1
                      }}
                      title="Move to Paid list WITHOUT adding credits"
                    >
                      {processingId === req.id ? '...' : 'Already Paid'}
                    </button>

                    <button 
                      onClick={() => handleApprove(req, false)}
                      disabled={processingId === req.id}
                      className="start-btn"
                      style={{ 
                        background: processingId === req.id ? 'transparent' : '#FFD700', 
                        color: processingId === req.id ? '#888' : '#000', 
                        borderColor: processingId === req.id ? '#555' : '#FFD700',
                        padding: '8px 12px', 
                        fontSize: '11px', 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '6px',
                        opacity: processingId === req.id ? 0.7 : 1
                      }}
                    >
                      {processingId === req.id ? 'Approving...' : <><Check size={12} strokeWidth={3} /> Approve & Add</>}
                    </button>
                  </div>

                </div>
              ))}
            </div>
          )}

        </div>

        {/* PAID / APPROVED SECTION */}
        <div className="hero-upload-box" style={{ width: '100%', padding: '20px', minHeight: '150px', marginTop: '30px', justifyContent: approvedRequests.length === 0 ? 'center' : 'flex-start', borderStyle: 'solid', borderColor: '#333' }}>
          {approvedRequests.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#888', fontSize: '14px' }}>
              No paid/approved requests yet.
            </div>
          ) : (
            <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '15px', maxHeight: '350px', overflowY: 'auto', paddingRight: '10px' }}>
              <div style={{ fontSize: "12px", color: "#4ade80", fontWeight: "600", textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '10px', textAlign: 'center' }}>
                Paid / Approved ({approvedRequests.length})
              </div>
              
              {approvedRequests.map(req => (
                <div key={req.id} style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: '0', padding: '15px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '15px', opacity: 0.7 }}>
                  
                  <div style={{ flex: 1, minWidth: '200px' }}>
                    <div style={{ color: '#666', fontSize: '11px', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      <Clock size={12} /> {new Date(req.created_at).toLocaleString()}
                    </div>
                    <div style={{ fontSize: '14px', fontWeight: '500', color: '#aaa', marginBottom: '4px' }}>{req.email}</div>
                    <div style={{ color: '#888', fontSize: '12px' }}>
                      Plan: <strong style={{ color: '#4ade80', textTransform: 'capitalize' }}>{req.plan}</strong> &bull; Ref: {req.reference_number}
                    </div>
                  </div>

                  <div style={{ color: '#4ade80', fontSize: '14px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Check size={16} strokeWidth={3} /> PAID
                  </div>

                </div>
              ))}
            </div>
          )}
        </div>

        {/* DODO AUTOMATED PAYMENTS SECTION */}
        <div className="hero-upload-box" style={{ width: '100%', padding: '20px', minHeight: '150px', marginTop: '30px', justifyContent: dodoPayments.length === 0 ? 'center' : 'flex-start', borderStyle: 'solid', borderColor: '#333' }}>
          {dodoPayments.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#888', fontSize: '14px' }}>
              No Dodo automated payments yet.
            </div>
          ) : (
            <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '15px', maxHeight: '350px', overflowY: 'auto', paddingRight: '10px' }}>
              <div style={{ fontSize: "12px", color: "#60a5fa", fontWeight: "600", textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '10px', textAlign: 'center' }}>
                Dodo Automated Payments ({dodoPayments.length})
              </div>

              {dodoPayments.map(payment => (
                <div key={payment.id} style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: '0', padding: '15px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '15px', opacity: payment.status === 'paid' ? 1 : 0.75 }}>
                  <div style={{ flex: 1, minWidth: '200px' }}>
                    <div style={{ color: '#666', fontSize: '11px', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      <Clock size={12} /> {new Date(payment.created_at).toLocaleString()}
                    </div>
                    <div style={{ fontSize: '14px', fontWeight: '500', color: '#aaa', marginBottom: '4px' }}>{payment.email}</div>
                    <div style={{ color: '#888', fontSize: '12px' }}>
                      Plan: <strong style={{ color: payment.status === 'paid' ? '#4ade80' : '#60a5fa', textTransform: 'capitalize' }}>{payment.plan}</strong> &bull; Credits: {payment.credits} &bull; {payment.currency} {(payment.amount / 100).toLocaleString()}
                    </div>
                  </div>

                  <div style={{ color: payment.status === 'paid' ? '#4ade80' : payment.status === 'failed' ? '#ff4444' : '#60a5fa', fontSize: '14px', fontWeight: 'bold', textTransform: 'uppercase' }}>
                    {payment.status}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* REVIEWS SECTION */}
        <div className="hero-upload-box" style={{ width: '100%', padding: '20px', minHeight: '150px', marginTop: '30px', justifyContent: reviews.length === 0 ? 'center' : 'flex-start', borderStyle: 'solid', borderColor: '#333' }}>
          {reviews.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#888', fontSize: '14px' }}>
              No user reviews yet.
            </div>
          ) : (
            <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '15px', maxHeight: '350px', overflowY: 'auto', paddingRight: '10px' }}>
              <div style={{ fontSize: "12px", color: "#fbbf24", fontWeight: "600", textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '10px', textAlign: 'center' }}>
                Recent User Reviews ({reviews.length})
              </div>
              
              {reviews.map(rev => (
                <div key={rev.id} style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: '0', padding: '15px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ color: '#666', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      <Clock size={12} /> {new Date(rev.created_at).toLocaleString()}
                    </div>
                    <div style={{ color: '#fbbf24', fontSize: '16px', letterSpacing: '2px' }}>
                      {'★'.repeat(rev.rating)}{'☆'.repeat(5 - rev.rating)}
                    </div>
                  </div>
                  
                  {rev.feedback_text ? (
                    <div style={{ fontSize: '14px', color: '#eee', fontStyle: 'italic', background: 'rgba(255,255,255,0.03)', padding: '10px', borderRadius: '4px', borderLeft: '3px solid #fbbf24' }}>
                      "{rev.feedback_text}"
                    </div>
                  ) : (
                    <div style={{ fontSize: '13px', color: '#888', fontStyle: 'italic' }}>
                      (No written feedback provided)
                    </div>
                  )}

                  <div style={{ color: '#555', fontSize: '11px', alignSelf: 'flex-end', marginTop: '4px' }}>
                    Project ID: {rev.id.substring(0,8)}...
                  </div>

                </div>
              ))}
            </div>
          )}
        </div>

        {/* PAID USERS & CREDITS SECTION */}
        <div className="hero-upload-box" style={{ width: '100%', padding: '20px', minHeight: '150px', marginTop: '30px', justifyContent: paidUsers.length === 0 ? 'center' : 'flex-start', borderStyle: 'solid', borderColor: '#333' }}>
          {paidUsers.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#888', fontSize: '14px' }}>
              No paid users found.
            </div>
          ) : (
            <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '15px', maxHeight: '350px', overflowY: 'auto', paddingRight: '10px' }}>
              <div style={{ fontSize: "12px", color: "#FFD700", fontWeight: "600", textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '10px', textAlign: 'center' }}>
                Paid Users & Remaining Credits ({paidUsers.length})
              </div>
              
              {paidUsers.map(u => (
                <div key={u.id} style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: '0', padding: '15px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '15px' }}>
                  
                  <div style={{ flex: 1, minWidth: '200px' }}>
                    <div style={{ fontSize: '14px', fontWeight: '500', color: '#fff', marginBottom: '4px' }}>{u.email}</div>
                    <div style={{ color: '#888', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Joined: {new Date(u.created_at).toLocaleDateString()}
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ background: '#222', padding: '8px 16px', borderRadius: '4px', border: '1px solid #444', color: '#FFD700', fontWeight: '600', fontSize: '14px' }}>
                      {u.credits} Traces
                    </div>
                  </div>

                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer Text */}
        <div style={{ marginTop: '40px', color: '#555', fontSize: '12px', textAlign: 'center' }}>
          Auto-Tracer Admin Panel &copy; 2026 &nbsp;·&nbsp;
          <span style={{ color: '#2a6', fontSize: '11px' }}>⚡ Live — Realtime notifications active</span>
        </div>

        {/* Inline keyframes for pulsing dot + spinner */}
        <style>{`
          @keyframes pulse-dot {
            0%   { box-shadow: 0 0 0 0 rgba(255, 68, 68, 0.7); }
            70%  { box-shadow: 0 0 0 8px rgba(255, 68, 68, 0); }
            100% { box-shadow: 0 0 0 0 rgba(255, 68, 68, 0); }
          }
          @keyframes spin {
            from { transform: rotate(0deg); }
            to   { transform: rotate(360deg); }
          }
        `}</style>
        
      </div>
    </div>
  );
}
