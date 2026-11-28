"use client";

import { memo } from "react";
import Image from "next/image";
import { CheckCircleIcon as CheckCircle2, HouseIcon as Home, KeyboardIcon as Keyboard, PencilIcon as Pencil } from "@phosphor-icons/react/ssr";

const StudioShell = memo(function StudioShell({
  className,
  title,
  projectName,
  savedAgo,
  credits,
  showCredits = true,
  onHome,
  onCreditsClick,
  onShortcuts,
  commandBar,
  commandBarPosition = "top",
  statusLeft,
  statusRight,
  extraTopActions,
  children,
}) {
  const controls = commandBar && <div className="studio-commandbar-shell" data-position={commandBarPosition}>{commandBar}</div>;
  return (
    <div className={`app-container studio-shell${className ? ` ${className}` : ""}`}>
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
          {extraTopActions}
          {onShortcuts && (
            <button className="studio-ghost-btn" onClick={onShortcuts}>
              <Keyboard size={12} /> Shortcuts
            </button>
          )}
          {showCredits && <button className="studio-credit-pill" onClick={onCreditsClick} type="button">
            <Image src="/Claws/Claws.webp" alt="Claws" width={14} height={14} style={{ objectFit: 'contain' }} />
            <span>{credits ?? "-"}</span>
            <small>Claws</small>
          </button>}
        </div>
      </header>


      {projectName && (
        <div className="studio-projectbar">
          <span>{projectName || "Untitled Project"}</span>
          <Pencil size={11} />
          {savedAgo && <small>{savedAgo}</small>}
        </div>
      )}

      {commandBarPosition !== "bottom" && controls}

      {children}

      {commandBarPosition === "bottom" && controls}

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
