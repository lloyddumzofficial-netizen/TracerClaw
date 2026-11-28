"use client";

import { memo, useRef, useState } from "react";
import Image from "next/image";
import { ImageIcon as ImageIcon, DotsThreeVerticalIcon as MoreVertical, PencilSimpleIcon as Edit3, TrashIcon as Trash2, CheckIcon as Check, XIcon as X, MagnifyingGlassIcon as Search, ShieldWarningIcon as ShieldAlert, ClockIcon as Clock, CircleNotchIcon as Loader2, StackIcon as Layers3, TShirtIcon as Shirt, PenNibIcon as PenTool, GridFourIcon as Grid2X2, ScanIcon as Scan, ScissorsIcon as Scissors, ArrowsOutSimpleIcon as Maximize2 } from "@phosphor-icons/react/ssr";

const PROJECT_TOOLS = {
  design_extract: { label: "Design Extract", Icon: Layers3 },
  design_refined: { label: "Design Refined", Icon: Layers3 },
  logo: { label: "Logo Vectorizer", Icon: PenTool },
  mockup: { label: "Garment Extract", Icon: Shirt },
  pattern: { label: "Pattern Rebuilder", Icon: Grid2X2 },
  bg_remover: { label: "Background Remover", Icon: Scissors },
  upscale: { label: "Image Upscale", Icon: Scan },
};

function ProjectToolLabel({ traceType }) {
  const tool = PROJECT_TOOLS[traceType];
  if (!tool) return null;
  const { label, Icon } = tool;
  return <span className="recent-tool-label"><Icon size={11} aria-hidden="true" />{label}</span>;
}

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
  onPrefetch,
  onStartEditing,
  onCancelEditing,
  onSaveRename,
  onConfirmDelete,
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [expanded, setExpanded] = useState(false);
  const projectsDialog = useRef(null);
  // The workspace is a heavy client route, so router.push takes a beat to
  // resolve. Without this the card's only visual state is border-color on
  // :hover — already applied while the cursor is on it — so a click changed
  // nothing on screen and users clicked again and again (observed as rage
  // clicks in session replay). Track which card was opened so it can show
  // progress and stop accepting further clicks.
  const [navigatingId, setNavigatingId] = useState(null);

  const handleCardClick = (proj) => {
    if (navigatingId) return;
    setNavigatingId(proj.id);
    onNavigate(proj);
  };

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
    const query = searchQuery.trim().toLowerCase();
    const filteredProjects = recentProjects.filter(p => (p.name || "Untitled Design").toLowerCase().includes(query));
    const recentMatches = query ? filteredProjects : filteredProjects.slice(0, 6);
    const renderSearch = (label) => (
      <div className="recent-projects-search">
        <Search size={14} aria-hidden="true" />
        <input
          type="search"
          aria-label={label}
          placeholder="Search projects..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>
    );

    const renderGrid = (projects, inDialog = false) => (
        projects.length === 0 ? (
          <div className="recent-projects-empty">
            No projects found matching "{searchQuery}"
          </div>
        ) : (
          <div className="recent-grid">
            {projects.map(proj => (
              <div
                key={proj.id}
                className={`recent-card${navigatingId === proj.id ? " is-navigating" : ""}${navigatingId ? " is-locked" : ""}`}
                onClick={() => handleCardClick(proj)}
                onMouseEnter={() => onPrefetch?.(proj)}
                onFocus={() => onPrefetch?.(proj)}
                role="button"
                tabIndex={0}
                aria-busy={navigatingId === proj.id}
                onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); handleCardClick(proj); } }}
              >
                <div className="recent-thumb">
                  {proj.original_image_url && (
                    <Image
                      alt=""
                      fill
                      unoptimized
                      sizes={inDialog ? "(max-width: 600px) 50vw, (max-width: 1000px) 25vw, 240px" : "180px"}
                      src={proj.trace_type === "design_extract" ? proj.original_image_url : `/api/proxy?url=${encodeURIComponent(proj.original_image_url)}`}
                      className="recent-thumb-image"
                    />
                  )}
                  {navigatingId === proj.id && (
                    <div className="recent-opening">
                      <Loader2 size={18} className="animate-spin" />
                      <span>Opening…</span>
                    </div>
                  )}
                </div>
                <div className="recent-info">
                  
                  {editingId === proj.id && expanded === inDialog ? (
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
                      <div className="recent-project-copy">
                        <div className="recent-name" title={proj.name}>{proj.name}</div>
                        <ProjectToolLabel traceType={proj.workspaceMode === "refine" ? "design_refined" : proj.trace_type} />
                      </div>
                      <div className="menu-container" onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === proj.id ? null : proj.id); }}>
                        <button className="dots-btn"><MoreVertical size={16} /></button>
                        {openMenuId === proj.id && expanded === inDialog && (
                          <div className="dropdown-menu">
                            <button onClick={(e) => onStartEditing(e, proj)}><Edit3 size={14} /> Rename</button>
                            <button onClick={(e) => {
                              if (inDialog) projectsDialog.current.close();
                              onConfirmDelete(e, proj);
                            }} className="delete-option"><Trash2 size={14} /> Delete</button>
                          </div>
                        )}
                      </div>
                    </>
                  )}

                </div>
              </div>
            ))}
          </div>
        )
    );

    return (
      <div className="recent-projects">
        <div className="recent-projects-head">
          <div className="recent-projects-title">
            <h3>Recent Projects</h3>
            <div className="recent-projects-retention">
              <Clock size={10} /> Auto-deleted after 3 days
            </div>
          </div>
          {renderSearch("Search recent projects")}
        </div>
        <div className="recent-privacy-note">
          <ShieldAlert size={14} aria-hidden="true" />
          <div>
            <strong>Privacy first</strong>
            <p>Uploaded and generated projects are permanently deleted after 3 days.</p>
          </div>
        </div>
        <div className="recent-projects-view-controls">
          <span>{filteredProjects.length} {filteredProjects.length === 1 ? "project" : "projects"}</span>
          <button
            type="button"
            className="recent-projects-view-button"
            aria-haspopup="dialog"
            aria-controls="all-projects-dialog"
            onClick={() => {
              setOpenMenuId(null);
              projectsDialog.current.showModal();
              setExpanded(true);
            }}
          >
            View all projects <Maximize2 size={13} aria-hidden="true" />
          </button>
        </div>
        {renderGrid(recentMatches)}
        <dialog
          id="all-projects-dialog"
          ref={projectsDialog}
          className="all-projects-dialog"
          aria-labelledby="all-projects-title"
          onClose={() => { setExpanded(false); setOpenMenuId(null); }}
        >
          <header className="all-projects-header">
            <h3 id="all-projects-title">All Projects</h3>
            {renderSearch("Search all projects")}
            <button
              type="button"
              className="recent-projects-view-button"
              aria-label="Close all projects"
              autoFocus
              onClick={() => projectsDialog.current.close()}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </header>
          {expanded && <div className="all-projects-body" data-home-native-scroll>{renderGrid(filteredProjects, true)}</div>}
        </dialog>
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
