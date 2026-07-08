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
          <div className="trace-type-grid" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div 
              className={`trace-card ${traceType === "mockup_erase" ? "selected" : ""}`}
              onClick={() => setTraceType("mockup_erase")}
              style={{ display: 'flex', alignItems: 'center', gap: '15px', padding: '12px 15px', border: traceType === "mockup_erase" ? '2px solid #FFD700' : '2px solid #444', borderRadius: '8px', cursor: 'pointer', background: traceType === "mockup_erase" ? 'rgba(255,215,0,0.1)' : 'transparent', textAlign: 'left' }}
            >
              <div className="trace-icon" style={{ color: traceType === "mockup_erase" ? '#FFD700' : '#888' }}><Shirt size={24} strokeWidth={1.5} /></div>
              <div>
                <h4 style={{ margin: '0 0 3px 0', color: traceType === "mockup_erase" ? '#fff' : '#ccc', fontSize: '14px' }}>Mockup (Extract Pattern)</h4>
                <p style={{ margin: 0, fontSize: '12px', color: '#888' }}>Erases text and logos to extract a clean background pattern.</p>
              </div>
            </div>

            <div 
              className={`trace-card ${traceType === "mockup_preserve" ? "selected" : ""}`}
              onClick={() => setTraceType("mockup_preserve")}
              style={{ display: 'flex', alignItems: 'center', gap: '15px', padding: '12px 15px', border: traceType === "mockup_preserve" ? '2px solid #FFD700' : '2px solid #444', borderRadius: '8px', cursor: 'pointer', background: traceType === "mockup_preserve" ? 'rgba(255,215,0,0.1)' : 'transparent', textAlign: 'left' }}
            >
              <div className="trace-icon" style={{ color: traceType === "mockup_preserve" ? '#FFD700' : '#888' }}><Shirt size={24} strokeWidth={1.5} /></div>
              <div>
                <h4 style={{ margin: '0 0 3px 0', color: traceType === "mockup_preserve" ? '#fff' : '#ccc', fontSize: '14px' }}>Mockup (Preserve Art)</h4>
                <p style={{ margin: 0, fontSize: '12px', color: '#888' }}>Keeps logos, characters, and text exactly as they are.</p>
              </div>
            </div>
            
            <div 
              className={`trace-card ${traceType === "logo" ? "selected" : ""}`}
              onClick={() => setTraceType("logo")}
              style={{ display: 'flex', alignItems: 'center', gap: '15px', padding: '12px 15px', border: traceType === "logo" ? '2px solid #FFD700' : '2px solid #444', borderRadius: '8px', cursor: 'pointer', background: traceType === "logo" ? 'rgba(255,215,0,0.1)' : 'transparent', textAlign: 'left' }}
            >
              <div className="trace-icon" style={{ color: traceType === "logo" ? '#FFD700' : '#888' }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
              </div>
              <div>
                <h4 style={{ margin: '0 0 3px 0', color: traceType === "logo" ? '#fff' : '#ccc', fontSize: '14px' }}>Solid Logo / Icon</h4>
                <p style={{ margin: 0, fontSize: '12px', color: '#888' }}>Best for 2D vectors, sketches, and flat colored logos.</p>
              </div>
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
