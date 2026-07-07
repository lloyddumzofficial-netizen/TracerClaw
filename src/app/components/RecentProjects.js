"use client";

import { memo, useState } from "react";
import { ImageIcon, MoreVertical, Edit3, Trash2, Check, X, Search } from "lucide-react";

const RecentProjects = memo(function RecentProjects({
  user,
  isLoadingProjects,
  recentProjects,
  editingId,
  editValue,
  setEditValue,
  openMenuId,
  setOpenMenuId,
  onNavigate,
  onStartEditing,
  onCancelEditing,
  onSaveRename,
  onConfirmDelete,
}) {
  const [searchQuery, setSearchQuery] = useState("");

  if (isLoadingProjects) {
    return (
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
    );
  }

  if (recentProjects.length > 0) {
    const filteredProjects = recentProjects.filter(p => p.name.toLowerCase().includes(searchQuery.toLowerCase()));

    return (
      <div className="recent-projects">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
          <h3 style={{ margin: 0 }}>Recent Projects</h3>
          <div style={{ position: "relative", width: "240px" }}>
            <Search size={14} color="#888" style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)" }} />
            <input 
              type="text" 
              placeholder="Search projects..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: "100%",
                background: "#1a1a1a",
                border: "1px solid #333",
                color: "#e0e0e0",
                padding: "8px 12px 8px 34px",
                borderRadius: "6px",
                fontSize: "13px",
                outline: "none",
                transition: "border-color 0.2s"
              }}
              onFocus={(e) => e.target.style.borderColor = "#FFD700"}
              onBlur={(e) => e.target.style.borderColor = "#333"}
            />
          </div>
        </div>

        {filteredProjects.length === 0 ? (
          <div style={{ padding: "40px 0", textAlign: "center", color: "#666", fontSize: "14px", background: "#1a1a1a", border: "1px dashed #333", borderRadius: "8px" }}>
            No projects found matching "{searchQuery}"
          </div>
        ) : (
          <div className="recent-grid">
            {filteredProjects.map(proj => (
              <div key={proj.id} className="recent-card" onClick={() => onNavigate(proj.id)}>
                <div className="recent-thumb" style={{backgroundImage: `url(${proj.svg_url || proj.original_image_url})`}}></div>
                <div className="recent-info">
                  
                  {editingId === proj.id ? (
                    <div className="inline-edit" onClick={(e) => e.stopPropagation()}>
                      <input 
                        type="text" 
                        value={editValue} 
                        onChange={(e) => setEditValue(e.target.value)} 
                        onKeyDown={(e) => e.key === 'Enter' && onSaveRename(e, proj.id)}
                        autoFocus
                      />
                      <button onClick={(e) => onSaveRename(e, proj.id)} className="save-btn"><Check size={14}/></button>
                      <button onClick={onCancelEditing} className="cancel-btn"><X size={14}/></button>
                    </div>
                  ) : (
                    <>
                      <div className="recent-name" title={proj.name}>{proj.name}</div>
                      <div className="menu-container" onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === proj.id ? null : proj.id); }}>
                        <button className="dots-btn"><MoreVertical size={16} /></button>
                        {openMenuId === proj.id && (
                          <div className="dropdown-menu">
                            <button onClick={(e) => onStartEditing(e, proj)}><Edit3 size={14} /> Rename</button>
                            <button onClick={(e) => onConfirmDelete(e, proj)} className="delete-option"><Trash2 size={14} /> Delete</button>
                          </div>
                        )}
                      </div>
                    </>
                  )}

                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (user) {
    return (
      <div className="recent-projects" style={{ textAlign: "center", padding: "40px 0", background: "#1a1a1a", border: "1px dashed #333", marginTop: "24px" }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: "16px" }}>
          <div style={{ background: "#222", padding: "16px", borderRadius: "50%", border: "1px solid #333" }}>
            <ImageIcon size={32} color="#555" />
          </div>
        </div>
        <p style={{ color: "#888", fontSize: "14px", margin: 0 }}>No projects yet. Upload a design above to start your first trace.</p>
      </div>
    );
  }

  return null;
});

export default RecentProjects;
