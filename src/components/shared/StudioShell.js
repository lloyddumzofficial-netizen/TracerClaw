"use client";

import { memo } from "react";
import Image from "next/image";
import { CheckCircle2, Home, Keyboard, Pencil } from "lucide-react";

const StudioShell = memo(function StudioShell({
  title,
  projectName,
  savedAgo,
  credits,
  onHome,
  onCreditsClick,
  onShortcuts,
  commandBar,
  statusLeft,
  statusRight,
  children,
}) {
  return (
    <div className="app-container studio-shell">
      <header className="studio-topbar">
        <button className="studio-logo-btn" onClick={onHome} aria-label="Go to Home">
          <Image
            src="/logo.png"
            alt="DesaynClaw"
            width={145}
            height={36}
            priority
            className="studio-logo-img"
          />
        </button>
        <button className="studio-nav-btn" onClick={onHome}>
          <Home size={14} /> Home
        </button>

        <div className="studio-title-wrap">
          <h1>{title}</h1>
        </div>

        <div className="studio-top-actions">
          {onShortcuts && (
            <button className="studio-ghost-btn" onClick={onShortcuts}>
              <Keyboard size={12} /> Shortcuts
            </button>
          )}
          <button className="studio-credit-pill" onClick={onCreditsClick} type="button">
            <span>{credits ?? "-"}</span>
            <small>Credits</small>
          </button>
        </div>
      </header>


      {projectName && (
        <div className="studio-projectbar">
          <span>{projectName || "Untitled Project"}</span>
          <Pencil size={11} />
          {savedAgo && <small>{savedAgo}</small>}
        </div>
      )}

      {commandBar && (
        <div className="studio-commandbar-shell">
          {commandBar}
        </div>
      )}

      {children}

      <div className="studio-statusbar">
        <div className="studio-status-left">
          {statusLeft || (
            <>
              <CheckCircle2 size={12} color="#4ade80" />
              <span>Ready</span>
            </>
          )}
        </div>
        <div className="studio-status-right">{statusRight}</div>
      </div>
    </div>
  );
});

export default StudioShell;
