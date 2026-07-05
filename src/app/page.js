"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { FilePlus, Monitor, Image as ImageIcon, Trash2, Edit3, MoreVertical, Check, X, Shirt, PenTool, LogIn, User, Coins, CreditCard, Package, Tag, Mail, Smartphone, CheckCircle } from "lucide-react";
import "./globals.css";

export default function StartScreen() {
  const [recentProjects, setRecentProjects] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  
  // States for New Project Modal
  const [showModal, setShowModal] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState(null);
  const [modalProjectName, setModalProjectName] = useState("Untitled Design");
  const [modalTraceType, setModalTraceType] = useState("mockup");

  // Auth States
  const [user, setUser] = useState(null);
  const [credits, setCredits] = useState(0);
  const [showTopUpModal, setShowTopUpModal] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [topUpStep, setTopUpStep] = useState(1); // 1=pick plan, 2=submit proof
  const [topUpForm, setTopUpForm] = useState({ plan: 'pro', txnRef: '', screenshotName: '', screenshotFile: null });
  const [topUpSubmitted, setTopUpSubmitted] = useState(false);
  const [isSubmittingTopUp, setIsSubmittingTopUp] = useState(false);
  const supabase = createClient();
  const [openMenuId, setOpenMenuId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState("");
  const fileInputRef = useRef(null);
  const router = useRouter();

  useEffect(() => {
    fetchSession();
  }, []);

  const fetchSession = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      setUser(session.user);
      fetchRecentProjects(session.user.id);
      fetchCredits(session.user.id);
    }
  };

  const fetchCredits = async (userId) => {
    const { data } = await supabase.from('profiles').select('credits, created_at').eq('id', userId).single();
    if (data) {
      setCredits(data.credits);
      // Show onboarding if brand new user (created within last 60 seconds)
      const isNew = data.created_at && (Date.now() - new Date(data.created_at).getTime()) < 60000;
      if (isNew && !localStorage.getItem('onboarding_seen')) {
        setShowOnboarding(true);
        localStorage.setItem('onboarding_seen', '1');
      }
    }
  };

  const handleLogin = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/api/auth/callback`
      }
    });
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setRecentProjects([]);
  };

  const fetchRecentProjects = async (userId) => {
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(6);
    
    if (!error && data) {
      setRecentProjects(data);
    }
  };

  const startEditing = (e, proj) => {
    e.stopPropagation();
    setOpenMenuId(null);
    setEditingId(proj.id);
    setEditValue(proj.name);
  };

  const cancelEditing = (e) => {
    e.stopPropagation();
    setEditingId(null);
  };

  const saveRename = async (e, id) => {
    e.stopPropagation();
    if (!editValue.trim() || editValue === recentProjects.find(p=>p.id===id).name) {
      setEditingId(null);
      return;
    }

    try {
      const res = await fetch("/api/project", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: id, newName: editValue })
      });
      if (res.ok) {
        setRecentProjects(prev => prev.map(p => p.id === id ? { ...p, name: editValue } : p));
      }
    } catch (err) {
      console.error("Failed to rename", err);
    }
    setEditingId(null);
  };

  const confirmDelete = (e, project) => {
    e.stopPropagation();
    setProjectToDelete(project);
  };

  const deleteProject = async () => {
    if (!projectToDelete) return;
    
    const id = projectToDelete.id;
    setRecentProjects(prev => prev.filter(p => p.id !== id));
    setProjectToDelete(null);
    setOpenMenuId(null);

    try {
      await fetch(`/api/project?id=${id}`, { method: 'DELETE' });
    } catch (err) {
      console.error("Failed to delete", err);
      fetchRecentProjects();
    }
  };

  const handleFileUpload = async (file) => {
    if (!file || !file.type.startsWith("image/")) return;
    
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("image", file);
      // Send the modal selections or defaults
      formData.append("projectName", modalProjectName);
      formData.append("traceType", modalTraceType);
      if (user) formData.append("userId", user.id);

      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.details || "Upload failed");

      router.push(`/workspace/${data.projectId}`);
    } catch (error) {
      console.error("Upload error:", error);
      alert("Failed to create project: " + error.message);
      setIsUploading(false);
    }
  };

  const handleFileChange = (e) => {
    const selected = e.target.files[0];
    handleFileUpload(selected);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  };

  return (
    <div className="start-screen-container" onDragOver={(e) => e.preventDefault()} onDrop={handleDrop} onClick={() => setOpenMenuId(null)}>
      <div className="start-center-box">
        
        <div className="start-logo" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', marginBottom: '20px' }}>
          <h1 style={{fontSize: "4rem", fontWeight: "300", letterSpacing: "-1px", margin: 0}}>DesaynClaw</h1>
          <p style={{fontSize: "14px", color: "#888", margin: "5px 0 0 0"}}>Developed by desaynbro</p>
        </div>

        {/* User Profile / Login Area */}
        <div style={{ position: 'absolute', top: 20, right: 30, display: 'flex', alignItems: 'center', gap: '15px' }}>
          {user ? (
            <>
              <div onClick={() => setShowTopUpModal(true)} style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#333', padding: '6px 12px', borderRadius: '20px', cursor: 'pointer', border: '1px solid #555' }}>
                <Shirt size={14} color="#FFD700" />
                <span style={{ fontSize: '14px', fontWeight: 'bold', color: '#FFD700' }}>{credits} {credits === 1 ? 'Trace' : 'Traces'}</span>
                <span style={{ fontSize: '10px', background: '#FFD700', color: '#000', padding: '2px 6px', borderRadius: '10px', marginLeft: '4px', fontWeight: 'bold' }}>TOP UP</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#222', padding: '6px 12px', borderRadius: '20px', border: '1px solid #444' }}>
                {user.user_metadata?.avatar_url ? (
                  <img src={user.user_metadata.avatar_url} referrerPolicy="no-referrer" style={{ width: 20, height: 20, borderRadius: '50%' }} alt="Avatar" />
                ) : (
                  <User size={16} color="#aaa" />
                )}
                <span style={{ fontSize: '14px', color: '#ddd' }}>{user.user_metadata?.full_name || user.email}</span>
              </div>
              <button onClick={handleLogout} className="start-btn" style={{ padding: '6px 12px', fontSize: '12px' }}>Logout</button>
            </>
          ) : (
            <button onClick={handleLogin} className="start-btn" style={{ background: '#FFD700', color: '#000', borderColor: '#FFD700', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'bold' }}>
              <LogIn size={16} /> Log in to get 2 Free Credits!
            </button>
          )}
        </div>

        <div className="start-buttons">
          <button className="start-btn" onClick={(e) => { e.stopPropagation(); setShowModal(true); }} disabled={isUploading || !user} style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
            {isUploading ? <><Monitor size={16} className="animate-pulse" /> Creating...</> : <><FilePlus size={16} /> New Project</>}
          </button>
          <button className="start-btn" onClick={(e) => { e.stopPropagation(); fileInputRef.current.click(); }} disabled={isUploading || !user} style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
            {isUploading ? <><Monitor size={16} className="animate-pulse" /> Uploading...</> : <><Monitor size={16} /> Open From Computer</>}
          </button>
        </div>

        <div className="start-drop-zone">
          Drop any image files here
        </div>

        {recentProjects.length > 0 && (
          <div className="recent-projects">
            <h3>Recent Projects</h3>
            <div className="recent-grid">
              {recentProjects.map(proj => (
                <div key={proj.id} className="recent-card" onClick={() => router.push(`/workspace/${proj.id}`)}>
                  <div className="recent-thumb" style={{backgroundImage: `url(${proj.svg_url || proj.original_image_url})`}}></div>
                  <div className="recent-info">
                    
                    {editingId === proj.id ? (
                      <div className="inline-edit" onClick={(e) => e.stopPropagation()}>
                        <input 
                          type="text" 
                          value={editValue} 
                          onChange={(e) => setEditValue(e.target.value)} 
                          onKeyDown={(e) => e.key === 'Enter' && saveRename(e, proj.id)}
                          autoFocus
                        />
                        <button onClick={(e) => saveRename(e, proj.id)} className="save-btn"><Check size={14}/></button>
                        <button onClick={cancelEditing} className="cancel-btn"><X size={14}/></button>
                      </div>
                    ) : (
                      <>
                        <div className="recent-name" title={proj.name}>{proj.name}</div>
                        <div className="menu-container" onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === proj.id ? null : proj.id); }}>
                          <button className="dots-btn"><MoreVertical size={16} /></button>
                          {openMenuId === proj.id && (
                            <div className="dropdown-menu">
                              <button onClick={(e) => startEditing(e, proj)}><Edit3 size={14} /> Rename</button>
                              <button onClick={(e) => confirmDelete(e, proj)} className="delete-option"><Trash2 size={14} /> Delete</button>
                            </div>
                          )}
                        </div>
                      </>
                    )}

                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>Create New Project</h2>
            
            <div className="form-group">
              <label>Project Name</label>
              <input 
                type="text" 
                value={modalProjectName} 
                onChange={(e) => setModalProjectName(e.target.value)} 
                className="modal-input"
              />
            </div>

            <div className="form-group">
              <label>Choose Trace Type</label>
              <div className="trace-type-grid">
                <div 
                  className={`trace-card ${modalTraceType === 'mockup' ? 'selected' : ''}`}
                  onClick={() => setModalTraceType('mockup')}
                >
                  <div className="trace-icon"><Shirt size={32} strokeWidth={1.5} /></div>
                  <h4>Garment / Mockup</h4>
                  <p>Extracts flat prints from realistic photos or mockups.</p>
                </div>
              </div>
            </div>

            <div className="modal-actions">
              <button className="btn-cancel" onClick={() => setShowModal(false)}>Cancel</button>
              <button 
                className="btn-primary" 
                onClick={() => fileInputRef.current.click()}
                disabled={isUploading}
              >
                {isUploading ? "Uploading..." : "Select Image & Create"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {projectToDelete && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '400px', textAlign: 'center' }}>
            <div className="modal-icon text-danger" style={{ marginBottom: '15px' }}>
              <Trash2 size={48} strokeWidth={1} color="#ff4444" />
            </div>
            <h3 style={{ marginBottom: '10px' }}>Delete Project?</h3>
            <p style={{ color: '#888', marginBottom: '25px', fontSize: '13px' }}>
              Are you sure you want to delete <strong>"{projectToDelete.name}"</strong>? This will permanently remove the project and its files from the cloud. This action cannot be undone.
            </p>
            <div className="modal-actions" style={{ justifyContent: 'center' }}>
              <button className="btn-secondary" onClick={() => setProjectToDelete(null)}>Cancel</button>
              <button className="btn-primary bg-danger" style={{ backgroundColor: '#ff4444', color: '#fff' }} onClick={deleteProject}>Delete Forever</button>
            </div>
          </div>
        </div>
      )}

      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleFileChange} 
        accept="image/*" 
        style={{ display: "none" }} 
      />

      {/* ===== ONBOARDING MODAL (shown once for new users) ===== */}
      {showOnboarding && (
        <div className="modal-overlay" style={{ zIndex: 9999 }}>
          <div className="modal-content" style={{ maxWidth: '500px', padding: '40px', textAlign: 'center', background: '#0a0a0a', border: '1px solid #222', borderRadius: '16px' }} onClick={(e) => e.stopPropagation()}>
            
            {/* Header */}
            <div style={{ marginBottom: '32px' }}>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '20px' }}>
                <div style={{ background: '#111', border: '1px solid #333', borderRadius: '50%', width: '72px', height: '72px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Shirt size={32} color="#FFD700" />
                </div>
              </div>
              <h2 style={{ margin: '0 0 10px', fontWeight: '800', fontSize: '24px', color: '#fff', letterSpacing: '-0.5px' }}>Congratulations! You received 2 Free Credits.</h2>
              <p style={{ color: '#888', fontSize: '14px', margin: 0, lineHeight: '1.5' }}>Welcome to DesaynClaw! Before you start, let's quickly go over how it works.</p>
            </div>

            {/* How it works */}
            <div style={{ background: '#111', border: '1px solid #222', borderRadius: '12px', padding: '24px', textAlign: 'left', marginBottom: '24px' }}>
              <p style={{ margin: '0 0 20px', fontWeight: '700', color: '#FFD700', fontSize: '12px', letterSpacing: '1px', textTransform: 'uppercase' }}>How DesaynClaw Works</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
                  <div style={{ minWidth: '24px', height: '24px', background: '#1a1a1a', border: '1px solid #333', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: '800', color: '#fff' }}>1</div>
                  <div>
                    <p style={{ margin: '0 0 4px', color: '#fff', fontWeight: '700', fontSize: '14px' }}>Upload any image</p>
                    <p style={{ margin: 0, color: '#666', fontSize: '13px', lineHeight: '1.4' }}>Take a picture of a shirt, mockup, or sketch.</p>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
                  <div style={{ minWidth: '24px', height: '24px', background: '#1a1a1a', border: '1px solid #333', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: '800', color: '#fff' }}>2</div>
                  <div>
                    <p style={{ margin: '0 0 4px', color: '#fff', fontWeight: '700', fontSize: '14px' }}>AI generates the vector</p>
                    <p style={{ margin: 0, color: '#666', fontSize: '13px', lineHeight: '1.4' }}>Our proprietary AI models extract and vectorize the design.</p>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
                  <div style={{ minWidth: '24px', height: '24px', background: '#1a1a1a', border: '1px solid #333', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: '800', color: '#fff' }}>3</div>
                  <div>
                    <p style={{ margin: '0 0 4px', color: '#fff', fontWeight: '700', fontSize: '14px' }}>Download your SVG</p>
                    <p style={{ margin: 0, color: '#666', fontSize: '13px', lineHeight: '1.4' }}>Import directly into Photoshop, Illustrator, or any design software.</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Credit explainer */}
            <div style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: '12px', padding: '24px', marginBottom: '32px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '12px' }}>
                <p style={{ margin: 0, fontWeight: '800', color: '#fff', fontSize: '15px' }}>1 Credit = 1 AI Generation</p>
              </div>
              <p style={{ margin: '0 0 8px', color: '#aaa', fontSize: '13px', textAlign: 'center', lineHeight: '1.5' }}>
                You have been granted <strong style={{ color: '#FFD700' }}>2 Free Credits</strong> to test the platform.
              </p>
              <p style={{ margin: 0, color: '#666', fontSize: '12px', textAlign: 'center' }}>
                Once depleted, you can top up for as low as ₱35 per credit.
              </p>
            </div>

            <button 
              className="start-btn" 
              onClick={() => setShowOnboarding(false)}
              style={{ width: '100%', padding: '16px', fontSize: '15px', fontWeight: '800', background: '#FFD700', color: '#000', border: 'none', borderRadius: '8px', cursor: 'pointer', transition: 'opacity 0.2s' }}
              onMouseOver={e => e.target.style.opacity = '0.9'}
              onMouseOut={e => e.target.style.opacity = '1'}
            >
              Start Using DesaynClaw
            </button>
          </div>
        </div>
      )}

      {/* Top Up Modal */}
      {showTopUpModal && (
        <div className="modal-overlay" onClick={() => { setShowTopUpModal(false); setTopUpStep(1); setTopUpSubmitted(false); }}>
          <div className="modal-content" style={{ maxWidth: '800px', width: '100%', padding: '0', overflow: 'hidden' }} onClick={(e) => e.stopPropagation()}>
            
            {/* Modal Header */}
            <div style={{ background: 'linear-gradient(135deg, #111, #1a1a1a)', borderBottom: '1px solid #2a2a2a', padding: '20px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Shirt size={18} color="#FFD700" />
                <span style={{ fontWeight: '700', fontSize: '15px', color: '#fff' }}>Get More Traces</span>
              </div>
              {/* Step Indicator */}
              {!topUpSubmitted && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {[1, 2].map(s => (
                    <div key={s} style={{ width: '24px', height: '24px', borderRadius: '50%', background: topUpStep >= s ? '#FFD700' : '#333', border: topUpStep >= s ? 'none' : '1px solid #555', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: '700', color: topUpStep >= s ? '#000' : '#666', transition: 'all 0.2s' }}>{s}</div>
                  ))}
                </div>
              )}
              <button onClick={() => { setShowTopUpModal(false); setTopUpStep(1); setTopUpSubmitted(false); }} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', padding: '4px' }}>
                <X size={16} />
              </button>
            </div>

            <div style={{ padding: '24px' }}>

              {/* ===== SUBMITTED SUCCESS ===== */}
              {topUpSubmitted ? (
                <div style={{ textAlign: 'center', padding: '20px 0' }}>
                  <div style={{ marginBottom: '12px', display: 'flex', justifyContent: 'center' }}>
                    <CheckCircle size={48} color="#4ade80" strokeWidth={1.5} />
                  </div>
                  <h3 style={{ margin: '0 0 8px', color: '#4ade80', fontWeight: '700' }}>Request Submitted!</h3>
                  <p style={{ color: '#888', fontSize: '13px', margin: '0 0 8px' }}>Natanggap namin ang iyong payment request.</p>
                  <div style={{ background: '#111', border: '1px solid #2a2a2a', borderRadius: '8px', padding: '14px', margin: '16px 0', textAlign: 'left' }}>
                    <p style={{ margin: '0 0 8px', color: '#aaa', fontSize: '12px', display: 'flex', alignItems: 'center' }}><Package size={14} style={{ marginRight: '6px', color: '#888' }} /> Package: <strong style={{ color: '#FFD700', marginLeft: '6px' }}>{topUpForm.plan === 'starter' ? '10 Credits — ₱350' : topUpForm.plan === 'pro' ? '30 Credits — ₱900' : '100 Credits — ₱2,800'}</strong></p>
                    <p style={{ margin: '0 0 8px', color: '#aaa', fontSize: '12px', display: 'flex', alignItems: 'center' }}><Tag size={14} style={{ marginRight: '6px', color: '#888' }} /> Ref No: <strong style={{ color: '#fff', marginLeft: '6px' }}>{topUpForm.txnRef || '—'}</strong></p>
                    <p style={{ margin: 0, color: '#aaa', fontSize: '12px', display: 'flex', alignItems: 'center' }}><Mail size={14} style={{ marginRight: '6px', color: '#888' }} /> Account: <strong style={{ color: '#fff', marginLeft: '6px' }}>{user?.email}</strong></p>
                  </div>
                  <p style={{ color: '#666', fontSize: '12px', margin: '0 0 20px' }}>Credits will be added within <strong style={{ color: '#4ade80' }}>10–30 minutes</strong>. Salamat! 🙏</p>
                  <button onClick={() => { setShowTopUpModal(false); setTopUpStep(1); setTopUpSubmitted(false); }} style={{ width: '100%', padding: '12px', background: '#222', color: '#fff', border: '1px solid #444', borderRadius: '8px', cursor: 'pointer', fontWeight: '600', fontSize: '13px' }}>Close</button>
                </div>
              ) : topUpStep === 1 ? (
                /* ===== STEP 1: CHOOSE PLAN ===== */
                <>
                  <p style={{ margin: '0 0 16px', color: '#888', fontSize: '12px' }}>Piliin ang package na gusto mo:</p>
                  
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '20px' }}>
                    {[
                      { key: 'starter', label: 'Starter', traces: 10, price: '₱350', desc: 'Para sa paminsan-minsang paggamit' },
                      { key: 'pro',     label: 'Pro',     traces: 30, price: '₱900', desc: 'Best value · Pinaka-popular', best: true },
                      { key: 'studio',  label: 'Studio',  traces: 100, price: '₱2,800', desc: 'Para sa madalas na gumagamit' },
                    ].map(p => (
                      <div 
                        key={p.key} 
                        onClick={() => setTopUpForm(f => ({ ...f, plan: p.key }))} 
                        style={{ 
                          background: topUpForm.plan === p.key ? '#1a1a1a' : '#0a0a0a', 
                          border: `1px solid ${topUpForm.plan === p.key ? '#FFD700' : '#222'}`, 
                          borderRadius: '12px', padding: '18px 20px', cursor: 'pointer', 
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between', 
                          transition: 'all 0.2s ease', position: 'relative',
                          boxShadow: topUpForm.plan === p.key ? '0 0 20px rgba(255,215,0,0.08)' : 'none'
                        }}
                      >
                        {p.best && <div style={{ position: 'absolute', top: '-10px', right: '20px', background: '#FFD700', color: '#000', fontSize: '10px', fontWeight: '800', padding: '4px 10px', borderRadius: '12px', letterSpacing: '0.5px' }}>POPULAR</div>}
                        
                        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                          <div style={{ width: '18px', height: '18px', borderRadius: '50%', border: `2px solid ${topUpForm.plan === p.key ? '#FFD700' : '#444'}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            {topUpForm.plan === p.key && <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#FFD700' }} />}
                          </div>
                          <div>
                            <div style={{ fontWeight: '800', fontSize: '18px', color: '#fff', display: 'flex', alignItems: 'center', gap: '6px' }}>
                              {p.traces} <span style={{ color: topUpForm.plan === p.key ? '#FFD700' : '#888', fontWeight: '600', fontSize: '15px' }}>Credits</span>
                            </div>
                            <div style={{ color: '#666', fontSize: '12px', marginTop: '2px' }}>{p.label} Plan</div>
                          </div>
                        </div>

                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: '20px', fontWeight: '800', color: topUpForm.plan === p.key ? '#FFD700' : '#fff' }}>{p.price}</div>
                          <div style={{ display: 'inline-block', background: '#222', color: '#aaa', fontSize: '10px', padding: '3px 8px', borderRadius: '6px', marginTop: '4px', fontWeight: '600' }}>
                            ₱{(parseInt(p.price.replace(/[^0-9]/g,'')) / p.traces).toFixed(0)} / credit
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <button
                    onClick={() => setTopUpStep(2)}
                    style={{ width: '100%', padding: '14px', background: '#FFD700', color: '#000', border: 'none', borderRadius: '6px', fontWeight: '800', fontSize: '14px', cursor: 'pointer', transition: 'opacity 0.2s' }}
                    onMouseOver={e => e.target.style.opacity = '0.9'}
                    onMouseOut={e => e.target.style.opacity = '1'}
                  >
                    Continue to Payment →
                  </button>
                </>
              ) : (
                /* ===== STEP 2: PAY & SUBMIT ===== */
                <>
                  {/* Selected plan summary */}
                  <div style={{ background: '#111', border: '1px solid #2a2a2a', borderRadius: '8px', padding: '10px 14px', marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: '#aaa', fontSize: '12px' }}>Selected: <strong style={{ color: '#fff' }}>
                      {topUpForm.plan === 'starter' ? 'Starter — 10 Credits' : topUpForm.plan === 'pro' ? 'Pro — 30 Credits' : 'Studio — 100 Credits'}
                    </strong></span>
                    <span style={{ color: '#FFD700', fontWeight: '800', fontSize: '16px' }}>
                      {topUpForm.plan === 'starter' ? '₱350' : topUpForm.plan === 'pro' ? '₱900' : '₱2,800'}
                    </span>
                  </div>

                  {/* QR + instructions */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '30px', marginBottom: '24px', alignItems: 'start' }}>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ background: '#fff', borderRadius: '16px', padding: '16px', display: 'inline-block', marginBottom: '12px', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
                        <img src="/gcash_qr.png" alt="GCash QR" style={{ width: '100%', maxWidth: '280px', height: 'auto', objectFit: 'contain', display: 'block' }} />
                      </div>
                      <p style={{ color: '#60a5fa', fontSize: '14px', margin: '0 0 6px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Smartphone size={18} style={{ marginRight: '6px' }} /> Scan with GCash</p>
                      <p style={{ color: '#aaa', fontSize: '13px', margin: 0 }}>LL**D D. · +63 948 562 ••••</p>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', paddingTop: '12px' }}>
                      <div>
                        <label style={{ display: 'block', color: '#aaa', fontSize: '13px', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>GCash Ref. Number *</label>
                        <input
                          type="text"
                          placeholder="e.g. 1234567890"
                          value={topUpForm.txnRef}
                          onChange={e => setTopUpForm(f => ({ ...f, txnRef: e.target.value }))}
                          style={{ width: '100%', background: '#111', border: '1px solid #333', borderRadius: '8px', padding: '16px', color: '#fff', fontSize: '16px', outline: 'none', boxSizing: 'border-box' }}
                          onFocus={e => e.target.style.borderColor = '#FFD700'}
                          onBlur={e => e.target.style.borderColor = '#333'}
                        />
                      </div>
                      <div>
                        <label style={{ display: 'block', color: '#aaa', fontSize: '13px', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Upload Proof of Payment *</label>
                        <input type="file" accept="image/*" onChange={e => { if (e.target.files[0]) setTopUpForm(f => ({ ...f, screenshotName: e.target.files[0].name, screenshotFile: e.target.files[0] })) }} style={{ display: 'none' }} id="proof-upload-home" />
                        <label htmlFor="proof-upload-home" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', background: '#111', border: '1px dashed #444', borderRadius: '8px', padding: '14px 16px', color: topUpForm.screenshotName ? '#4ade80' : '#888', fontSize: '15px', cursor: 'pointer', boxSizing: 'border-box', transition: 'all 0.2s' }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><ImageIcon size={18} /> {topUpForm.screenshotName || 'Select screenshot...'}</span>
                          <span style={{ fontSize: '12px', background: '#333', color: '#fff', padding: '6px 10px', borderRadius: '4px' }}>Browse</span>
                        </label>
                      </div>
                      <div>
                        <label style={{ display: 'block', color: '#888', fontSize: '13px', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Your Email (auto-filled)</label>
                        <input
                          type="text"
                          value={user?.email || ''}
                          readOnly
                          style={{ width: '100%', background: '#0a0a0a', border: '1px solid #222', borderRadius: '8px', padding: '16px', color: '#666', fontSize: '16px', outline: 'none', boxSizing: 'border-box', cursor: 'not-allowed' }}
                        />
                      </div>

                      <p style={{ margin: '12px 0 0', color: '#aaa', fontSize: '13px', lineHeight: 1.6 }}>
                        After paying, fill in the reference number, attach your screenshot above and submit. Credits arrive within <strong style={{ color: '#4ade80' }}>10–30 minutes</strong>.
                      </p>
                    </div>
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: '16px' }}>
                    <button
                      onClick={() => setTopUpStep(1)}
                      disabled={isSubmittingTopUp}
                      style={{ padding: '16px 24px', background: 'transparent', color: '#888', border: '1px solid #333', borderRadius: '8px', cursor: isSubmittingTopUp ? 'not-allowed' : 'pointer', fontSize: '16px', fontWeight: '600' }}
                    >
                      ← Back
                    </button>
                    <button
                      onClick={async () => {
                        if (!topUpForm.txnRef.trim() || !topUpForm.screenshotFile) { alert('Please enter your GCash reference number and upload proof of payment.'); return; }
                        if (!user) { alert('You must be logged in.'); return; }
                        
                        setIsSubmittingTopUp(true);
                        try {
                          const supabase = createClient();
                          
                          // 1. Upload to Supabase Storage
                          const fileExt = topUpForm.screenshotFile.name.split('.').pop();
                          const fileName = `proof_${user.id}_${Date.now()}.${fileExt}`;
                          
                          const { error: uploadError } = await supabase.storage
                            .from('payment_proofs')
                            .upload(fileName, topUpForm.screenshotFile);
                            
                          if (uploadError) throw uploadError;
                          
                          const proofUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/payment_proofs/${fileName}`;
                          
                          // 2. Insert into payment_requests table
                          const { error: dbError } = await supabase
                            .from('payment_requests')
                            .insert({
                              user_id: user.id,
                              email: user.email,
                              plan: topUpForm.plan,
                              reference_number: topUpForm.txnRef,
                              proof_url: proofUrl
                            });
                            
                          if (dbError) throw dbError;
                          
                          setTopUpSubmitted(true);
                        } catch (error) {
                          console.error("Payment Submission Error:", error);
                          alert("Failed to submit payment request: " + error.message);
                        } finally {
                          setIsSubmittingTopUp(false);
                        }
                      }}
                      disabled={isSubmittingTopUp}
                      style={{ flex: 1, padding: '16px', background: (topUpForm.txnRef.trim() && topUpForm.screenshotFile) ? '#FFD700' : '#222', color: (topUpForm.txnRef.trim() && topUpForm.screenshotFile) ? '#000' : '#555', border: 'none', borderRadius: '8px', fontWeight: '800', fontSize: '16px', cursor: (topUpForm.txnRef.trim() && topUpForm.screenshotFile && !isSubmittingTopUp) ? 'pointer' : 'not-allowed', transition: 'all 0.2s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                    >
                      {isSubmittingTopUp ? 'Uploading...' : <><Check size={20} /> Submit Payment Request</>}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}



      <style jsx>{`
        .start-screen-container {
          min-height: 100vh;
          background-color: #262626;
          color: #d5d5d5;
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        }
        .start-center-box {
          display: flex;
          flex-direction: column;
          align-items: center;
          width: 100%;
          max-width: 800px;
        }
        .start-logo {
          display: flex;
          align-items: center;
          margin-bottom: 50px;
        }
        .start-buttons {
          display: flex;
          gap: 15px;
          margin-bottom: 30px;
        }
        .start-btn {
          background: transparent;
          border: 1px solid #555;
          color: #d5d5d5;
          padding: 10px 20px;
          border-radius: 4px;
          font-size: 14px;
          cursor: pointer;
          transition: all 0.2s;
        }
        .start-btn:hover:not(.disabled) {
          background: #3a3a3a;
          border-color: #777;
        }
        .start-btn.disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .start-drop-zone {
          width: 600px;
          height: 120px;
          border: 1px solid #444;
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #777;
          background: #2a2a2a;
          margin-bottom: 50px;
        }
        .recent-projects {
          width: 100%;
          max-width: 600px;
        }
        .recent-projects h3 {
          font-size: 14px;
          font-weight: normal;
          color: #aaa;
          margin-bottom: 15px;
          border-bottom: 1px solid #444;
          padding-bottom: 5px;
        }
        .recent-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 15px;
        }
        .recent-card {
          background: #333;
          border-radius: 6px;
          overflow: hidden;
          cursor: pointer;
          border: 1px solid transparent;
          transition: border 0.2s;
        }
        .recent-card:hover {
          border-color: #666;
        }
        .recent-thumb {
          height: 100px;
          background-color: #222;
          background-size: cover;
          background-position: center;
        }
        .recent-info {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 8px 10px;
        }
        .recent-name {
          font-size: 12px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          flex-grow: 1;
        }
        .menu-container {
          position: relative;
        }
        .dots-btn {
          background: transparent;
          border: none;
          color: #888;
          cursor: pointer;
          padding: 2px;
          border-radius: 4px;
        }
        .dots-btn:hover {
          color: #fff;
          background: #444;
        }
        .dropdown-menu {
          position: absolute;
          right: 0;
          bottom: 100%;
          margin-bottom: 5px;
          background: #333;
          border: 1px solid #444;
          border-radius: 6px;
          padding: 4px;
          display: flex;
          flex-direction: column;
          gap: 2px;
          min-width: 100px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.5);
          z-index: 10;
        }
        .dropdown-menu button {
          background: transparent;
          border: none;
          color: #ccc;
          padding: 6px 10px;
          text-align: left;
          font-size: 12px;
          cursor: pointer;
          border-radius: 4px;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .dropdown-menu button:hover {
          background: #444;
          color: #fff;
        }
        .dropdown-menu .delete-option:hover {
          background: rgba(255, 68, 68, 0.1);
          color: #ff4444;
        }
        .inline-edit {
          display: flex;
          align-items: center;
          gap: 4px;
          width: 100%;
        }
        .inline-edit input {
          flex-grow: 1;
          background: #222;
          border: 1px solid #555;
          color: #fff;
          font-size: 12px;
          padding: 4px 6px;
          border-radius: 3px;
          outline: none;
          width: 50%;
        }
        .inline-edit input:focus {
          border-color: #888;
        }
        .save-btn, .cancel-btn {
          background: transparent;
          border: none;
          color: #aaa;
          cursor: pointer;
          padding: 2px;
        }
        .save-btn:hover { color: #4ade80; }
        .cancel-btn:hover { color: #f87171; }

        /* Modal Styles */
        .modal-overlay {
          position: fixed;
          top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(0,0,0,0.7);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 50;
        }
        .modal-content {
          background: #2a2a2a;
          border: 1px solid #444;
          border-radius: 8px;
          padding: 24px;
          width: 500px;
          max-width: 90vw;
          box-shadow: 0 10px 30px rgba(0,0,0,0.5);
        }
        .modal-content h2 {
          margin-top: 0;
          margin-bottom: 20px;
          font-weight: 400;
        }
        .form-group {
          margin-bottom: 20px;
        }
        .form-group label {
          display: block;
          font-size: 13px;
          color: #aaa;
          margin-bottom: 8px;
        }
        .modal-input {
          width: 100%;
          background: #1a1a1a;
          border: 1px solid #444;
          color: #fff;
          padding: 10px;
          border-radius: 4px;
          font-size: 14px;
          box-sizing: border-box;
        }
        .trace-type-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 15px;
        }
        .trace-card {
          background: #1a1a1a;
          border: 2px solid #333;
          border-radius: 6px;
          padding: 15px;
          cursor: pointer;
          transition: all 0.2s;
        }
        .trace-card:hover {
          border-color: #555;
          background: #222;
        }
        .trace-card.selected {
          border-color: #FFD700;
          background: rgba(255, 215, 0, 0.05);
        }
        .trace-icon {
          margin-bottom: 10px;
          color: #888;
          transition: color 0.2s;
        }
        .trace-card.selected .trace-icon {
          color: #FFD700;
        }
        .trace-card h4 {
          margin: 0 0 5px 0;
          font-size: 14px;
          color: #ddd;
        }
        .trace-card p {
          margin: 0;
          font-size: 12px;
          color: #888;
          line-height: 1.4;
        }
        .modal-actions {
          display: flex;
          justify-content: flex-end;
          gap: 10px;
          margin-top: 30px;
        }
        .btn-cancel {
          background: transparent;
          border: 1px solid #555;
          color: #ccc;
          padding: 8px 16px;
          border-radius: 4px;
          cursor: pointer;
        }
        .btn-cancel:hover { background: #333; }
        .btn-primary {
          background: #FFD700;
          color: #000;
          border: none;
          padding: 8px 16px;
          border-radius: 4px;
          font-weight: 600;
          cursor: pointer;
        }
        .btn-primary:hover { background: #E6C200; }
        .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
      `}</style>
    </div>
  );
}
