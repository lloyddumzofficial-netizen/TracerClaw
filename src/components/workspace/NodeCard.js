"use client";

import { memo } from "react";
import { MoreHorizontal } from "lucide-react";

/**
 * NodeCard — Generic pipeline node container.
 * memo'd so it only re-renders when its own props change.
 * Supports per-node error state via `errorMessage` prop.
 */
const NodeCard = memo(function NodeCard({
  title,
  icon,
  isActiveStep,
  isDimmed,
  imageUrl,
  loadingLabel,
  statusLabel,
  statusColor,
  errorMessage,
  showInput = false,
  showOutput = false,
  headerActions,
  footerLeft,
  children,
}) {
  return (
    <div className={`node-card${isDimmed ? " dimmed" : ""}`}>
      {showInput && <div className="node-port input" />}

      <div className="node-header" style={{ justifyContent: "space-between" }}>
        <div className="node-header-title">
          {icon}
          {title}
        </div>
        {headerActions ?? <MoreHorizontal size={14} style={{ color: "#52525b", cursor: "pointer" }} />}
      </div>

      {/* Error badge — only shown when errorMessage is set */}
      {errorMessage && (
        <div className="node-error-badge">
          ⚠ {errorMessage}
        </div>
      )}

      <div className="node-content" style={{ position: "relative" }}>
        {isActiveStep && (
          <div className="node-loading-overlay">
            <div className="node-spinner" />
            <span>{loadingLabel || "Processing..."}</span>
          </div>
        )}
        {children ?? (
          imageUrl ? (
            <img
              src={imageUrl}
              alt={title}
              style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "4px" }}
              referrerPolicy="no-referrer"
              decoding="async"
            />
          ) : (
            <div className="placeholder-node">
              {isActiveStep ? null : "Awaiting Execution"}
            </div>
          )
        )}
      </div>

      <div
        className="node-footer"
        style={{ padding: "8px 12px", borderTop: "1px solid #222", fontSize: "11px", color: "#555", display: "flex", justifyContent: "space-between" }}
      >
        <span>{footerLeft}</span>
        <span className={isActiveStep ? "param-active-pulse" : ""} style={{ color: statusColor }}>
          {statusLabel}
        </span>
      </div>

      {showOutput && <div className="node-port output" />}
    </div>
  );
});

export default NodeCard;
