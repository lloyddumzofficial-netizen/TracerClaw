"use client";

import { memo } from "react";
import { Shirt } from "lucide-react";

const NewProjectModal = memo(function NewProjectModal({
  show,
  projectName,
  setProjectName,
  traceType,
  setTraceType,
  isUploading,
  onClose,
  onSelectImage,
}) {
  if (!show) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h2>Create New Project</h2>
        
        <div className="form-group">
          <label>Project Name</label>
          <input 
            type="text" 
            value={projectName} 
            onChange={(e) => setProjectName(e.target.value)} 
            className="modal-input"
          />
        </div>

        <div className="form-group">
          <label>Choose Trace Type</label>
          <div className="trace-type-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
            <div 
              className={`trace-card ${traceType === "mockup" ? "selected" : ""}`}
              onClick={() => setTraceType("mockup")}
              style={{ padding: '15px', border: traceType === "mockup" ? '2px solid #FFD700' : '2px solid #444', borderRadius: '8px', cursor: 'pointer', background: traceType === "mockup" ? 'rgba(255,215,0,0.1)' : 'transparent', textAlign: 'center' }}
            >
              <div className="trace-icon" style={{ marginBottom: '10px', color: traceType === "mockup" ? '#FFD700' : '#888' }}><Shirt size={32} strokeWidth={1.5} /></div>
              <h4 style={{ margin: '0 0 5px 0', color: traceType === "mockup" ? '#fff' : '#ccc' }}>Garment / Mockup</h4>
              <p style={{ margin: 0, fontSize: '12px', color: '#888' }}>Extracts flat prints from realistic photos or mockups.</p>
            </div>
            
            <div 
              className={`trace-card ${traceType === "logo" ? "selected" : ""}`}
              onClick={() => setTraceType("logo")}
              style={{ padding: '15px', border: traceType === "logo" ? '2px solid #FFD700' : '2px solid #444', borderRadius: '8px', cursor: 'pointer', background: traceType === "logo" ? 'rgba(255,215,0,0.1)' : 'transparent', textAlign: 'center' }}
            >
              <div className="trace-icon" style={{ marginBottom: '10px', color: traceType === "logo" ? '#FFD700' : '#888' }}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
              </div>
              <h4 style={{ margin: '0 0 5px 0', color: traceType === "logo" ? '#fff' : '#ccc' }}>Solid Logo / Icon</h4>
              <p style={{ margin: 0, fontSize: '12px', color: '#888' }}>Best for 2D vectors, sketches, and flat colored logos.</p>
            </div>
          </div>
        </div>

        <div className="modal-actions">
          <button className="btn-cancel" onClick={onClose}>Cancel</button>
          <button 
            className="btn-primary" 
            onClick={onSelectImage}
            disabled={isUploading}
          >
            {isUploading ? "Uploading..." : "Select Image & Create"}
          </button>
        </div>
      </div>
    </div>
  );
});

export default NewProjectModal;
