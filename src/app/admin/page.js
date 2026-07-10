"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import { toast } from "@/components/Toast";
import { Check, Clock, ExternalLink, LogOut } from "lucide-react";

import "../globals.css";
import "../home.css";

export default function AdminDashboard() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState([]);
  const [approvedRequests, setApprovedRequests] = useState([]);
  const [totalProjects, setTotalProjects] = useState(0);
  const [processingId, setProcessingId] = useState(null);
  const router = useRouter();

  const PLAN_PRICES = {
    tingi: 50,
    basic: 100,
    starter: 290,
    pro: 870
  };
  const COST_PER_GENERATION = 2; // Estimated PHP cost per generation

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );

  useEffect(() => {
    const checkAdmin = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session || session.user.email !== 'lloyddumzofficial@gmail.com') {
        router.push('/');
        return;
      }
      setUser(session.user);
      fetchRequests(session.access_token);
    };
    checkAdmin();
  }, [supabase, router]);

  const fetchRequests = async (token) => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/get-dashboard', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      
      if (!res.ok) throw new Error(data.error);

      const reqData = data.requests || [];
      const pending = reqData.filter(r => r.status === 'pending');
      const approved = reqData.filter(r => r.status === 'approved');
      
      // Sort pending so oldest is first
      setRequests(pending.sort((a, b) => new Date(a.created_at) - new Date(b.created_at)));
      setApprovedRequests(approved);
      setTotalProjects(data.totalProjects || 0);
    } catch (err) {
      toast.error("Failed to load admin data");
      console.error(err);
    } finally {
      setLoading(false);
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

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      if (markOnly) {
        toast.success(`Marked as paid! (No credits added)`);
      } else {
        toast.success(`Approved! Added ${data.addedCredits} credits to ${request.email}`);
      }
      
      setRequests(reqs => reqs.filter(r => r.id !== request.id));
      setApprovedRequests(prev => [...prev, { ...request, status: 'approved' }]);
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
            <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '15px' }}>
              <div style={{ fontSize: "12px", color: "#FFD700", fontWeight: "600", textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '10px', textAlign: 'center' }}>
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
            <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '15px' }}>
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

        {/* Footer Text */}
        <div style={{ marginTop: '40px', color: '#555', fontSize: '12px', textAlign: 'center' }}>
          Auto-Tracer Admin Panel &copy; 2026
        </div>
        
      </div>
    </div>
  );
}
