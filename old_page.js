"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { ImageIcon, Monitor, LogIn, FilePlus, User, Edit3, Trash2, MoreVertical, X, Check, Shirt, Smartphone, ArrowRight, CheckCircle, Package, Tag, Mail } from "lucide-react";
import { toast } from "@/components/Toast";
import "./globals.css";

const TraceIcon = ({ size = 16, color = "#FFD700" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    {/* Outer Coin Circle */}
    <circle cx="10" cy="12" r="8" stroke={color} strokeWidth="2" />
    <circle cx="10" cy="12" r="9" stroke={color} strokeWidth="0.5" opacity="0.5" />
    {/* Inner Shirt */}
    <path d="M7 8H13L14 10H13V15H7V10H6L7 8Z" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    {/* Dotted Trail */}
    <circle cx="18" cy="8" r="1" fill={color} />
    <circle cx="21" cy="6" r="1.5" fill={color} />
    <circle cx="20" cy="10" r="1" fill={color} />
  </svg>
);

export default function StartScreen() {
  const [recentProjects, setRecentProjects] = useState([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
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
  const [showSamplesModal, setShowSamplesModal] = useState(false);
  const [sampleSliderPos, setSampleSliderPos] = useState(50);
  const [sampleSliderPos2, setSampleSliderPos2] = useState(50);
  const [isDraggingGlobal, setIsDraggingGlobal] = useState(false);
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
    
    const handleGlobalDragOver = (e) => {
      e.preventDefault();
      if (e.dataTransfer.types.includes('Files')) {
        setIsDraggingGlobal(true);
      }
    };
    window.addEventListener("dragover", handleGlobalDragOver);
    return () => {
      window.removeEventListener("dragover", handleGlobalDragOver);
    };
  }, []);

  const fetchSession = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      setUser(session.user);
      fetchRecentProjects(session.user.id);
      fetchCredits(session.user.id);
    } else {
      setIsLoadingProjects(false);
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
    setIsLoadingProjects(true);
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);
    
    if (!error && data) {
      setRecentProjects(data);
    }
    setIsLoadingProjects(false);
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
      // 1. Get presigned URL
      const sessionRes = await supabase.auth.getSession();
      const token = sessionRes.data.session?.access_token;
      
      if (!token) {
        setIsUploading(false);
        handleLogin();
        return;
      }

      const urlRes = await fetch("/api/upload-url", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ fileName: file.name, contentType: file.type })
      });
      
      const urlData = await urlRes.json();
      if (!urlRes.ok || !urlData.uploadUrl) {
        throw new Error(urlData.error || "Failed to get upload URL from server");
      }
      const { uploadUrl, publicUrl } = urlData;

      // 2. Upload directly to Cloudflare R2
      const putRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file
      });
      
      if (!putRes.ok) throw new Error("Failed to upload image to storage");

      // 3. Create project in Database
      const response = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageUrl: publicUrl,
          projectName: modalProjectName || file.name,
          traceType: modalTraceType,
          userId: user.id
        })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.details || "Project creation failed");

      router.push(`/workspace/${data.projectId}`);
    } catch (error) {
      console.error("Upload error:", error);
      toast.error("Failed to create project: " + error.message);
      setIsUploading(false);
    }
  };

  const handleFileChange = (e) => {
    const selected = e.target.files[0];
    handleFileUpload(selected);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    if (!user) {
      handleLogin();
      return;
    }
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  };

  return (
    <div className="start-screen-container" onDragOver={(e) => e.preventDefault()} onDrop={handleDrop} onClick={() => setOpenMenuId(null)}>
      {isDraggingGlobal && (
        <div 
           style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(26,26,26,0.95)', zIndex: 99999, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', border: '4px dashed #FFD700', borderRadius: '0' }}
           onDragOver={(e) => e.preventDefault()}
           onDragLeave={() => setIsDraggingGlobal(false)}
           onDrop={(e) => {
              e.preventDefault();
              setIsDraggingGlobal(false);
              if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                if (!user) { handleLogin(); return; }
                handleFileUpload(e.dataTransfer.files[0]);
              }
           }}
        >
          <div style={{ background: '#FFD700', padding: '24px', borderRadius: '50%', marginBottom: '24px' }}>
            <ImageIcon size={48} color="#000" />
          </div>
          <h2 style={{ color: '#FFD700', fontSize: '32px', margin: 0, fontWeight: '800' }}>Drop your image anywhere</h2>
          <p style={{ color: '#aaa', fontSize: '16px', marginTop: '12px' }}>Release to start tracing instantly.</p>
        </div>
      )}

      <div className="start-center-box">
        
        <div className="start-logo" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', marginBottom: '20px' }}>
          <img src="/logo.png" alt="DesaynClaw Logo" style={{ width: '400px', maxWidth: '100%', height: 'auto', margin: 0 }} />
          <p style={{fontSize: "14px", color: "#888", margin: "5px 0 0 0"}}>Developed by desaynbro</p>
        </div>

        {/* User Profile / Login Area */}
        <div style={{ position: 'absolute', top: 20, right: 30, display: 'flex', alignItems: 'center', gap: '15px' }}>
          {user ? (
            <>
              <div onClick={() => setShowTopUpModal(true)} style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#333', padding: '6px 12px', borderRadius: '20px', cursor: 'pointer', border: '1px solid #555' }}>
                <TraceIcon size={16} color="#FFD700" />
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
              <LogIn size={16} /> Log in to get 1 Free Credit!
            </button>
          )}
        </div>

        <div className="start-buttons">
          <button className="start-btn" onClick={(e) => { 
            e.stopPropagation(); 
            if (!user) { handleLogin(); return; }
            setShowModal(true); 
          }} disabled={isUploading} style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
            {isUploading ? <><Monitor size={16} className="animate-pulse" /> Creating...</> : <><FilePlus size={16} /> New Project</>}
          </button>
          <button className="start-btn" onClick={(e) => { 
            e.stopPropagation(); 
            if (!user) { handleLogin(); return; }
            fileInputRef.current.click(); 
          }} disabled={isUploading} style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
            {isUploading ? <><Monitor size={16} className="animate-pulse" /> Uploading...</> : <><Monitor size={16} /> Open From Computer</>}
          </button>
          <button className="start-btn" onClick={(e) => { 
            e.stopPropagation(); 
            setShowSamplesModal(true); 
          }} disabled={isUploading} style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
            <ImageIcon size={16} /> View Samples
          </button>
        </div>

        <div className="start-drop-zone">
          Drop any image files here
        </div>

        {isLoadingProjects ? (
          <div className="recent-projects">
            <h3>Recent Projects</h3>
            <div className="recent-grid">
              {[1, 2, 3, 4].map((n) => (
                <div key={n} className="recent-card skeleton-card">
                  <div className="skeleton-thumb"></div>
                  <div className="skeleton-info">
                    <div className="skeleton-text"></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : recentProjects.length > 0 ? (
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
        ) : (
          user && (
            <div className="recent-projects" style={{ textAlign: 'center', padding: '40px 0', background: '#1a1a1a', border: '1px dashed #333', marginTop: '24px' }}>
               <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
                 <div style={{ background: '#222', padding: '16px', borderRadius: '50%', border: '1px solid #333' }}>
                    <ImageIcon size={32} color="#555" />
                 </div>
               </div>
               <p style={{ color: '#888', fontSize: '14px', margin: 0 }}>No projects yet. Upload a design above to start your first trace.</p>
            </div>
          )
        )}

        {/* HOW TO USE / DEMO VIDEO SECTION */}
        <div className="demo-section" style={{ marginTop: '40px', width: '100%', textAlign: 'center' }}>
          <h3 style={{ color: '#666', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '12px' }}>How to Use DesaynClaw</h3>
          <video 
            src="/demo.mp4" 
            autoPlay 
            muted 
            loop 
            playsInline 
            style={{ width: '100%', maxWidth: '600px', borderRadius: '0', border: '1px solid #333' }} 
          />
        </div>

        {/* EDUCATIONAL SECTION */}
        <div className="edu-section" style={{ marginTop: '80px', width: '100%', borderTop: '1px solid #222', paddingTop: '60px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '24px', textAlign: 'left' }}>
            
            {/* Col 1 */}
            <div style={{ background: '#111', border: '1px solid #333', padding: '32px', display: 'flex', flexDirection: 'column' }}>
              <h3 style={{ fontSize: '20px', color: '#FFD700', marginBottom: '16px', fontWeight: 'bold' }}>How does it work</h3>
              <p style={{ color: '#aaa', fontSize: '14px', lineHeight: '1.6', flex: 1 }}>
                Vectorization of raster images is done by converting pixel color information into simple geometric objects. The most common variant is looking over edge detection areas of the same or similar brightness or color, which are then expressed as graphic primitives like lines, circles, and curves.
              </p>
            </div>

            {/* Col 2 */}
            <div style={{ background: '#111', border: '1px solid #333', padding: '32px', display: 'flex', flexDirection: 'column' }}>
              <h3 style={{ fontSize: '20px', color: '#fff', marginBottom: '16px', fontWeight: 'bold' }}>Raster Graphics</h3>
              <p style={{ color: '#aaa', fontSize: '14px', lineHeight: '1.6', flex: 1 }}>
                A Raster graphics image is a rectangular grid of pixels, in which each pixel (or point) has an associated color value. Changing the size of the raster image mostly results in loss of apparent quality.
                <br/><br/>
                <i style={{ color: '#888' }}>examples: photos</i>
              </p>
            </div>

            {/* Col 3 */}
            <div style={{ background: '#111', border: '1px solid #333', padding: '32px', display: 'flex', flexDirection: 'column' }}>
              <h3 style={{ fontSize: '20px', color: '#fff', marginBottom: '16px', fontWeight: 'bold' }}>Vector Graphics</h3>
              <p style={{ color: '#aaa', fontSize: '14px', lineHeight: '1.6', flex: 1 }}>
                Vector graphics are not based on pixels but on primitives such as points, lines, curves which are represented by mathematical expressions. Without a loss in quality, vector graphics are easily scalable and rotatable.
                <br/><br/>
                <i style={{ color: '#888' }}>examples: cliparts, logos, tattoos, decals, stickers, t-shirt designs</i>
              </p>
            </div>

          </div>
        </div>

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
          <div className="modal-content" style={{ maxWidth: '500px', padding: '40px', textAlign: 'center', background: '#0a0a0a', border: '1px solid #222', borderRadius: '0' }} onClick={(e) => e.stopPropagation()}>
            
            {/* Header */}
            <div style={{ marginBottom: '32px' }}>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '20px' }}>
                <div style={{ background: '#111', border: '1px solid #333', borderRadius: '50%', width: '72px', height: '72px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Shirt size={32} color="#FFD700" />
                </div>
              </div>
              <h2 style={{ margin: '0 0 10px', fontWeight: '800', fontSize: '24px', color: '#fff', letterSpacing: '-0.5px' }}>Congratulations! You received 1 Free Credit.</h2>
              <p style={{ color: '#888', fontSize: '14px', margin: 0, lineHeight: '1.5' }}>Welcome to DesaynClaw! Before you start, let's quickly go over how it works.</p>
            </div>

            {/* How it works */}
            <div style={{ background: '#111', border: '1px solid #222', borderRadius: '0', padding: '24px', textAlign: 'left', marginBottom: '24px' }}>
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
            <div style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: '0', padding: '24px', marginBottom: '32px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '12px' }}>
                <p style={{ margin: 0, fontWeight: '800', color: '#fff', fontSize: '15px' }}>1 Credit = 1 AI Generation</p>
              </div>
              <p style={{ margin: '0 0 8px', color: '#aaa', fontSize: '13px', textAlign: 'center', lineHeight: '1.5' }}>
                You have been granted <strong style={{ color: '#FFD700' }}>1 Free Credit</strong> to test the platform.
              </p>
              <p style={{ margin: 0, color: '#666', fontSize: '12px', textAlign: 'center' }}>
                Once depleted, you can top up for as low as Γé▒35 per credit.
              </p>
            </div>

            <button 
              className="start-btn" 
              onClick={() => setShowOnboarding(false)}
              style={{ width: '100%', padding: '16px', fontSize: '15px', fontWeight: '800', background: '#FFD700', color: '#000', border: 'none', borderRadius: '0', cursor: 'pointer', transition: 'opacity 0.2s' }}
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
          <div className="modal-content" style={{ maxWidth: '960px', width: '100%', padding: '0', overflow: 'hidden', borderRadius: '0', border: '1px solid #444', background: '#262626' }} onClick={(e) => e.stopPropagation()}>
            
            {/* Modal Header */}
            <div style={{ background: '#2a2a2a', borderBottom: '1px solid #444', padding: '24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Shirt size={18} color="#fff" />
                <span style={{ fontWeight: '600', fontSize: '15px', color: '#fff' }}>Get More Traces</span>
              </div>
              {!topUpSubmitted && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {[1, 2].map(s => (
                    <div key={s} style={{ width: '24px', height: '24px', borderRadius: '50%', background: topUpStep >= s ? '#fff' : '#27272a', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: '600', color: topUpStep >= s ? '#000' : '#888', transition: 'all 0.2s' }}>{s}</div>
                  ))}
                </div>
              )}
              <button onClick={() => { setShowTopUpModal(false); setTopUpStep(1); setTopUpSubmitted(false); }} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', padding: '4px' }}><X size={16} /></button>
            </div>
            <div style={{ background: '#262626', padding: '24px' }}>

              {/* ===== SUBMITTED SUCCESS ===== */}
              {topUpSubmitted ? (
                <div style={{ textAlign: 'center', padding: '20px 0' }}>
                  <div style={{ marginBottom: '12px', display: 'flex', justifyContent: 'center' }}>
                    <CheckCircle size={48} color="#4ade80" strokeWidth={1.5} />
                  </div>
                  <h3 style={{ margin: '0 0 8px', color: '#4ade80', fontWeight: '700' }}>Request Submitted!</h3>
                  <p style={{ color: '#888', fontSize: '13px', margin: '0 0 8px' }}>Natanggap namin ang iyong payment request.</p>
                  <div style={{ background: '#111', border: '1px solid #2a2a2a', borderRadius: '8px', padding: '14px', margin: '16px 0', textAlign: 'left' }}>
                    <p style={{ margin: '0 0 8px', color: '#aaa', fontSize: '12px', display: 'flex', alignItems: 'center' }}><Package size={14} style={{ marginRight: '6px', color: '#888' }} /> Package: <strong style={{ color: '#FFD700', marginLeft: '6px' }}>{topUpForm.plan === 'tingi' ? '2 Credits ΓÇö Γé▒50' : topUpForm.plan === 'basic' ? '5 Credits ΓÇö Γé▒100' : topUpForm.plan === 'starter' ? '10 Credits ΓÇö Γé▒290' : '35 Credits ΓÇö Γé▒870'}</strong></p>
                    <p style={{ margin: '0 0 8px', color: '#aaa', fontSize: '12px', display: 'flex', alignItems: 'center' }}><Tag size={14} style={{ marginRight: '6px', color: '#888' }} /> Ref No: <strong style={{ color: '#fff', marginLeft: '6px' }}>{topUpForm.txnRef || 'ΓÇö'}</strong></p>
                    <p style={{ margin: 0, color: '#aaa', fontSize: '12px', display: 'flex', alignItems: 'center' }}><Mail size={14} style={{ marginRight: '6px', color: '#888' }} /> Account: <strong style={{ color: '#fff', marginLeft: '6px' }}>{user?.email}</strong></p>
                  </div>
                  <p style={{ color: '#666', fontSize: '12px', margin: '0 0 20px' }}>Credits will be added within <strong style={{ color: '#4ade80' }}>10ΓÇô30 minutes</strong>. Salamat! ≡ƒÖÅ</p>
                  <button onClick={() => { setShowTopUpModal(false); setTopUpStep(1); setTopUpSubmitted(false); }} style={{ width: '100%', padding: '12px', background: '#222', color: '#fff', border: '1px solid #444', borderRadius: '8px', cursor: 'pointer', fontWeight: '600', fontSize: '13px' }}>Close</button>
                </div>
              ) : topUpStep === 1 ? (
                /* ===== STEP 1: CHOOSE PLAN ===== */
                <>
                  <div style={{ textAlign: 'center', marginBottom: '32px' }}>
                    <div style={{ display: 'inline-block', border: '1px solid #555', padding: '4px 12px', fontSize: '11px', fontWeight: '600', color: '#ccc', letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: '16px', borderRadius: '4px' }}>Pricing Plan</div>
                    <h2 style={{ margin: '0 0 8px', fontSize: '28px', fontWeight: '700', color: '#fff' }}>Affordable pricing</h2>
                    <p style={{ margin: 0, color: '#aaa', fontSize: '14px', maxWidth: '500px', marginLeft: 'auto', marginRight: 'auto' }}>Piliin ang credit package na sakto sa pangangailangan mo.</p>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '24px' }}>
                    {[
                      { 
                        key: 'tingi', label: 'Tingi', traces: 2, price: 'Γé▒50', 
                        desc: 'Sachet pricing. Good for a quick test.',
                        features: ['2 HD Vector Traces', 'Standard Processing'] 
                      },
                      { 
                        key: 'basic', label: 'Basic', traces: 5, price: 'Γé▒100', 
                        desc: 'Great for hobbyists printing occasionally.',
                        features: ['5 HD Vector Traces', 'Standard Processing', '7-day storage'] 
                      },
                      { 
                        key: 'starter', label: 'Starter', traces: 10, price: 'Γé▒290', 
                        desc: 'Ideal for small businesses taking their first steps.',
                        features: ['10 HD Vector Traces', 'Priority Processing', '30-day storage', 'Email support'] 
                      },
                      { 
                        key: 'pro', label: 'Professional', traces: 35, price: 'Γé▒870', 
                        desc: 'Perfect for print shops & growing design studios.',
                        best: true,
                        features: ['35 HD Vector Traces', 'Highest Priority Queue', 'Unlimited storage', 'Priority support'] 
                      },
                    ].map(p => (
                      <div 
                        key={p.key} 
                        style={{ 
                          background: p.best ? '#333' : '#2a2a2a', 
                          border: `1px solid ${p.best ? '#FFD700' : '#444'}`, 
                          padding: '32px 24px', 
                          display: 'flex', flexDirection: 'column', 
                          position: 'relative',
                          borderRadius: '6px'
                        }}
                      >
                        {/* Header */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                          <div style={{ fontSize: '16px', fontWeight: '500', color: '#fff' }}>{p.label}</div>
                          {p.best && <div style={{ background: '#FFD700', color: '#000', fontSize: '11px', fontWeight: '800', padding: '4px 12px', display: 'flex', alignItems: 'center', gap: '4px', borderRadius: '4px' }}><CheckCircle size={12} /> Most popular</div>}
                        </div>

                        {/* Price */}
                        <div style={{ marginBottom: '16px', display: 'flex', alignItems: 'baseline', gap: '4px' }}>
                          <span style={{ fontSize: '36px', fontWeight: '700', color: '#fff', letterSpacing: '-1px' }}>{p.price}</span>
                          <span style={{ fontSize: '12px', color: '#888' }}>/ {p.traces} credits</span>
                        </div>
                        
                        <p style={{ color: '#aaa', fontSize: '13px', lineHeight: '1.5', margin: '0 0 24px', minHeight: '40px' }}>{p.desc}</p>

                        {/* Button */}
                        <button 
                          onClick={() => {
                            setTopUpForm(f => ({ ...f, plan: p.key }));
                            setTopUpStep(2);
                          }}
                          style={{ 
                            width: '100%', padding: '12px', 
                            background: p.best ? '#FFD700' : 'transparent', 
                            color: p.best ? '#000' : '#d5d5d5', 
                            border: p.best ? 'none' : '1px solid #555', 
                            fontWeight: '600', fontSize: '14px', 
                            cursor: 'pointer', transition: 'all 0.2s',
                            display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px',
                            marginBottom: '32px', borderRadius: '4px'
                          }} 
                          onMouseOver={e => {
                            e.target.style.opacity = '0.9';
                            if (!p.best) { e.target.style.background = '#3a3a3a'; e.target.style.borderColor = '#777'; }
                          }} 
                          onMouseOut={e => {
                            e.target.style.opacity = '1';
                            if (!p.best) { e.target.style.background = 'transparent'; e.target.style.borderColor = '#555'; }
                          }}
                        >
                          Select Plan <ArrowRight size={14} />
                        </button>

                        <div style={{ borderTop: '1px solid #444', margin: '0 -24px 24px' }}></div>

                        {/* Features */}
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
                /* ===== STEP 2: PAY & SUBMIT ===== */
                <>
                  <div style={{ background: '#2a2a2a', border: '1px solid #444', borderRadius: '8px', padding: '12px 16px', marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: '#aaa', fontSize: '13px' }}>Selected: <strong style={{ color: '#fff' }}>{topUpForm.plan === 'tingi' ? 'Tingi ΓÇö 2 Credits' : topUpForm.plan === 'basic' ? 'Basic ΓÇö 5 Credits' : topUpForm.plan === 'starter' ? 'Starter ΓÇö 10 Credits' : 'Professional ΓÇö 35 Credits'}</strong></span>
                    <span style={{ color: '#FFD700', fontWeight: '600', fontSize: '15px' }}>{topUpForm.plan === 'tingi' ? 'Γé▒50' : topUpForm.plan === 'basic' ? 'Γé▒100' : topUpForm.plan === 'starter' ? 'Γé▒290' : 'Γé▒870'}</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '30px', marginBottom: '24px', alignItems: 'start' }}>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ background: '#fff', borderRadius: '16px', padding: '16px', display: 'inline-block', marginBottom: '12px', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
                        <img src="/gcash_qr.png" alt="GCash QR" style={{ width: '100%', maxWidth: '280px', height: 'auto', objectFit: 'contain', display: 'block' }} />
                      </div>
                      <p style={{ color: '#FFD700', fontSize: '14px', margin: '0 0 6px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Smartphone size={18} style={{ marginRight: '6px' }} /> Scan with GCash</p>
                      <p style={{ color: '#aaa', fontSize: '13px', margin: 0 }}>LL**D D. ┬╖ +63 948 562 ΓÇóΓÇóΓÇóΓÇó</p>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', paddingTop: '12px' }}>
                      <div>
                        <label style={{ display: 'block', color: '#aaa', fontSize: '13px', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>GCash Ref. Number *</label>
                        <input type="text" placeholder="e.g. 1234567890" value={topUpForm.txnRef} onChange={e => setTopUpForm(f => ({ ...f, txnRef: e.target.value }))} style={{ width: '100%', background: '#222', border: '1px solid #444', borderRadius: '8px', padding: '16px', color: '#fff', fontSize: '16px', outline: 'none', boxSizing: 'border-box' }} onFocus={e => e.target.style.borderColor = '#FFD700'} onBlur={e => e.target.style.borderColor = '#444'} />
                      </div>
                      <div>
                        <label style={{ display: 'block', color: '#aaa', fontSize: '13px', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Upload Proof of Payment *</label>
                        <input type="file" accept="image/*" onChange={e => { if (e.target.files[0]) setTopUpForm(f => ({ ...f, screenshotName: e.target.files[0].name, screenshotFile: e.target.files[0] })) }} style={{ display: 'none' }} id="proof-upload" />
                        <label htmlFor="proof-upload" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', background: '#222', border: '1px dashed #555', borderRadius: '8px', padding: '14px 16px', color: topUpForm.screenshotName ? '#FFD700' : '#888', fontSize: '15px', cursor: 'pointer', boxSizing: 'border-box', transition: 'all 0.2s' }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><ImageIcon size={18} /> {topUpForm.screenshotName || 'Select screenshot...'}</span>
                          <span style={{ fontSize: '12px', background: '#444', color: '#fff', padding: '6px 10px', borderRadius: '4px' }}>Browse</span>
                        </label>
                      </div>
                      <div>
                        <label style={{ display: 'block', color: '#888', fontSize: '13px', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Your Email (auto-filled)</label>
                        <input type="text" value={user?.email || ''} readOnly style={{ width: '100%', background: '#1a1a1a', border: '1px solid #333', borderRadius: '8px', padding: '16px', color: '#666', fontSize: '16px', outline: 'none', boxSizing: 'border-box', cursor: 'not-allowed' }} />
                      </div>
                      <p style={{ margin: '12px 0 0', color: '#aaa', fontSize: '13px', lineHeight: 1.6 }}>After paying, fill in the reference number, attach your screenshot above and submit. Credits arrive within <strong style={{ color: '#FFD700' }}>10ΓÇô30 minutes</strong>.</p>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '12px' }}>
                    <button onClick={() => setTopUpStep(1)} disabled={isSubmittingTopUp} style={{ padding: '12px 24px', background: 'transparent', color: '#d5d5d5', border: '1px solid #555', borderRadius: '6px', cursor: isSubmittingTopUp ? 'not-allowed' : 'pointer', fontSize: '14px', fontWeight: '500' }}>Back</button>
                    <button 
                      onClick={async () => { 
                        if (!topUpForm.txnRef.trim() || !topUpForm.screenshotFile) { toast.error('Please enter your GCash reference number and upload proof of payment.'); return; } 
                        if (!user) { toast.error('You must be logged in.'); return; }
                        
                        setIsSubmittingTopUp(true);
                        try {
                          const fileExt = topUpForm.screenshotFile.name.split('.').pop();
                          const fileName = `proof_${user.id}_${Date.now()}.${fileExt}`;
                          
                          const { error: uploadError } = await supabase.storage
                            .from('payment_proofs')
                            .upload(fileName, topUpForm.screenshotFile);
                            
                          if (uploadError) throw uploadError;
                          
                          const { data: publicData } = supabase.storage
                            .from('payment_proofs')
                            .getPublicUrl(fileName);
                            
                          const { error: dbError } = await supabase
                            .from('payment_requests')
                            .insert({
                              user_id: user.id,
                              email: user.email,
                              plan: topUpForm.plan,
                              reference_number: topUpForm.txnRef,
                              proof_url: publicData.publicUrl
                            });
                            
                          if (dbError) throw dbError;
                          
                          setTopUpSubmitted(true);
                        } catch (err) {
                          toast.error(`Error submitting request: ${err.message}`);
                        } finally {
                          setIsSubmittingTopUp(false);
                        }
                      }} 
                      disabled={isSubmittingTopUp} 
                      style={{ flex: 1, padding: '12px', background: '#fff', color: '#000', border: 'none', borderRadius: '6px', cursor: isSubmittingTopUp ? 'not-allowed' : 'pointer', fontSize: '14px', fontWeight: '600', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    >
                      {isSubmittingTopUp ? 'Submitting...' : 'Submit Payment'}
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
          height: 100vh;
          overflow-y: auto;
          background-color: #262626;
          color: #d5d5d5;
          display: flex;
          flex-direction: column;
          padding: 60px 20px;
          box-sizing: border-box;
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        }
        .start-center-box {
          display: flex;
          flex-direction: column;
          align-items: center;
          width: 100%;
          max-width: 800px;
          margin: auto;
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
          max-height: 400px;
          overflow-y: auto;
          padding-right: 8px;
        }
        /* Custom scrollbar for recent-grid */
        .recent-grid::-webkit-scrollbar {
          width: 6px;
        }
        .recent-grid::-webkit-scrollbar-track {
          background: #1a1a1a;
          border-radius: 3px;
        }
        .recent-grid::-webkit-scrollbar-thumb {
          background: #444;
          border-radius: 3px;
        }
        .recent-grid::-webkit-scrollbar-thumb:hover {
          background: #666;
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
          background: #262626;
          border: 1px solid #444;
          border-radius: 0;
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
          border-radius: 0;
          font-size: 14px;
          box-sizing: border-box;
          transition: border-color 0.2s;
        }
        .modal-input:focus {
          border-color: #FFD700;
          outline: none;
        }
        .trace-type-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 15px;
        }
        .trace-card {
          background: #1a1a1a;
          border: 1px solid #444;
          border-radius: 0;
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
          border-radius: 0;
          cursor: pointer;
        }
        .btn-cancel:hover { background: #333; }
        .btn-primary {
          background: #FFD700;
          color: #000;
          border: none;
          padding: 8px 16px;
          border-radius: 0;
          font-weight: 600;
          cursor: pointer;
        }
        .btn-primary:hover { background: #E6C200; }
        .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

        /* Skeleton Loaders */
        .skeleton-card {
          pointer-events: none;
        }
        .skeleton-thumb {
          height: 180px;
          background: #222;
          border-bottom: 1px solid #333;
          position: relative;
          overflow: hidden;
        }
        .skeleton-info {
          padding: 15px;
          position: relative;
          overflow: hidden;
        }
        .skeleton-text {
          height: 14px;
          background: #333;
          width: 60%;
          border-radius: 2px;
          position: relative;
          overflow: hidden;
        }
        .skeleton-thumb::after, .skeleton-text::after {
          content: '';
          position: absolute;
          top: 0; left: -150%; width: 150%; height: 100%;
          background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.05), transparent);
          animation: shimmer 1.5s infinite ease-in-out;
        }
        @keyframes shimmer {
          0% { left: -150%; }
          100% { left: 150%; }
        }
      `}</style>
      {/* SAMPLES MODAL */}
      {showSamplesModal && (
        <div className="modal-overlay" onClick={() => setShowSamplesModal(false)} style={{ zIndex: 9999 }}>
          <div className="modal-content" style={{ maxWidth: '1200px', width: '95%', maxHeight: '95vh', padding: '32px', background: '#262626', border: '1px solid #444', borderRadius: '0', display: 'flex', flexDirection: 'column' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <h2 style={{ margin: 0, fontSize: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}><ImageIcon size={24} color="#FFD700" /> Sample AI Extractions</h2>
              <button onClick={() => setShowSamplesModal(false)} style={{ background: 'transparent', border: 'none', color: '#888', cursor: 'pointer' }}><X size={24} /></button>
            </div>
            
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '24px', textAlign: 'left', overflowY: 'auto', paddingRight: '8px', flex: 1 }}>
              
              {/* Sample 1: Interactive Slider */}
              <div style={{ background: '#1a1a1a', border: '1px solid #333', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ position: 'relative', height: '400px', background: '#000', overflow: 'hidden', border: '1px solid #444' }}>
                  
                  {/* Original Image (Background) */}
                  <img 
                    src="https://pub-c1f9daa772cc48a394341ecc043e63a5.r2.dev/users/30f2a02b-2b1a-4ce3-9ec2-585a21b741b1/1783338326367_crop_1783338342234.jpg" 
                    alt="Original" 
                    style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover' }} 
                  />
                  <span style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.7)', padding: '2px 8px', fontSize: '11px', color: '#fff', borderRadius: '4px', zIndex: 1 }}>Original Photo</span>
                  
                  {/* Vectorized SVG (Clipped Foreground) */}
                  <img 
                    src="https://pub-c1f9daa772cc48a394341ecc043e63a5.r2.dev/projects/bdf18f96-9332-44c3-8b77-e82917acbffa/vector_1783338385589.svg" 
                    alt="Vector" 
                    style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover', clipPath: `polygon(0 0, ${sampleSliderPos}% 0, ${sampleSliderPos}% 100%, 0 100%)`, zIndex: 2 }} 
                  />
                  <span style={{ position: 'absolute', top: 8, left: 8, background: '#FFD700', padding: '2px 8px', fontSize: '11px', color: '#000', fontWeight: 'bold', borderRadius: '4px', zIndex: 3, opacity: sampleSliderPos > 20 ? 1 : 0, transition: 'opacity 0.2s' }}>Vectorized SVG</span>

                  {/* Slider Divider Line */}
                  <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${sampleSliderPos}%`, width: '2px', background: '#FFD700', transform: 'translateX(-50%)', zIndex: 3, pointerEvents: 'none' }}></div>
                  
                  {/* Slider Handle Visual */}
                  <div style={{ position: 'absolute', top: '50%', left: `${sampleSliderPos}%`, transform: 'translate(-50%, -50%)', width: '32px', height: '32px', background: '#FFD700', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3, pointerEvents: 'none', boxShadow: '0 2px 10px rgba(0,0,0,0.5)' }}>
                    <div style={{ display: 'flex', gap: '2px' }}>
                      <div style={{ width: '2px', height: '12px', background: '#000' }}></div>
                      <div style={{ width: '2px', height: '12px', background: '#000' }}></div>
                    </div>
                  </div>

                  {/* Invisible Range Input for Interaction */}
                  <input 
                    type="range" 
                    min="0" max="100" 
                    value={sampleSliderPos} 
                    onChange={e => setSampleSliderPos(e.target.value)} 
                    style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: 0, cursor: 'ew-resize', zIndex: 4, margin: 0 }} 
                  />
                  
                </div>
                <div>
                  <div style={{ fontSize: '14px', color: '#fff', fontWeight: 'bold' }}>EMPOWER Custom Jersey (Auto-Traced)</div>
                  <div style={{ fontSize: '12px', color: '#888', marginTop: '4px' }}>Slide to compare the original photo vs. the extracted vector SVG.</div>

                </div>
              </div>

              {/* Sample 2: Interactive Slider */}
              <div style={{ background: '#1a1a1a', border: '1px solid #333', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ position: 'relative', height: '400px', background: '#000', overflow: 'hidden', border: '1px solid #444' }}>
                  
                  {/* Original Image (Background) */}
                  <img 
                    src="https://pub-c1f9daa772cc48a394341ecc043e63a5.r2.dev/projects/0e8401f8-6602-4458-a308-8db01e22c0e2/cropped_1783258312728.jpeg" 
                    alt="Original" 
                    style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover' }} 
                  />
                  <span style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.7)', padding: '2px 8px', fontSize: '11px', color: '#fff', borderRadius: '4px', zIndex: 1 }}>Original Photo</span>
                  
                  {/* Vectorized SVG (Clipped Foreground) */}
                  <img 
                    src="https://pub-c1f9daa772cc48a394341ecc043e63a5.r2.dev/projects/0e8401f8-6602-4458-a308-8db01e22c0e2/vector_1783258378211.svg" 
                    alt="Vector" 
                    style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover', clipPath: `polygon(0 0, ${sampleSliderPos2}% 0, ${sampleSliderPos2}% 100%, 0 100%)`, zIndex: 2 }} 
                  />
                  <span style={{ position: 'absolute', top: 8, left: 8, background: '#FFD700', padding: '2px 8px', fontSize: '11px', color: '#000', fontWeight: 'bold', borderRadius: '4px', zIndex: 3, opacity: sampleSliderPos2 > 20 ? 1 : 0, transition: 'opacity 0.2s' }}>Vectorized SVG</span>

                  {/* Slider Divider Line */}
                  <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${sampleSliderPos2}%`, width: '2px', background: '#FFD700', transform: 'translateX(-50%)', zIndex: 3, pointerEvents: 'none' }}></div>
                  
                  {/* Slider Handle Visual */}
                  <div style={{ position: 'absolute', top: '50%', left: `${sampleSliderPos2}%`, transform: 'translate(-50%, -50%)', width: '32px', height: '32px', background: '#FFD700', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3, pointerEvents: 'none', boxShadow: '0 2px 10px rgba(0,0,0,0.5)' }}>
                    <div style={{ display: 'flex', gap: '2px' }}>
                      <div style={{ width: '2px', height: '12px', background: '#000' }}></div>
                      <div style={{ width: '2px', height: '12px', background: '#000' }}></div>
                    </div>
                  </div>

                  {/* Invisible Range Input for Interaction */}
                  <input 
                    type="range" 
                    min="0" max="100" 
                    value={sampleSliderPos2} 
                    onChange={e => setSampleSliderPos2(e.target.value)} 
                    style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: 0, cursor: 'ew-resize', zIndex: 4, margin: 0 }} 
                  />
                  
                </div>
                <div>
                  <div style={{ fontSize: '14px', color: '#fff', fontWeight: 'bold' }}>Graphic Tees (Auto-Traced)</div>
                  <div style={{ fontSize: '12px', color: '#888', marginTop: '4px' }}>Slide to compare the original photo vs. the extracted vector SVG.</div>
                </div>
              </div>

            </div>
          </div>
        </div>
      )}

    </div>
  );
}
