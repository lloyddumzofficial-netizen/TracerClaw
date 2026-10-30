"use client";

import { memo, useRef } from "react";
import Image from "next/image";
import useDialogFocus from "@/hooks/useDialogFocus";

const NoCreditsModal = memo(function NoCreditsModal({ show, onClose, onTopUp, credits, requiredCredits = 1 }) {
  const dialogRef = useRef(null);
  useDialogFocus(show, dialogRef, onClose);
  if (!show) return null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="no-credits-title" aria-describedby="no-credits-description" tabIndex={-1} className="modal-content" style={{ maxWidth: "400px", textAlign: "center", padding: "30px" }} onClick={e => e.stopPropagation()}>
        <div style={{ marginBottom: "16px", display: "flex", justifyContent: "center" }}>
          <Image src="/Claws/Claws.webp" alt="Claws" width={48} height={48} style={{ objectFit: 'contain' }} />
        </div>
        <h3 id="no-credits-title" style={{ margin: "0 0 10px", color: "#fff", fontWeight: "700", fontSize: "20px" }}>More Claws needed</h3>
        <p id="no-credits-description" style={{ color: "#aaa", fontSize: "14px", marginBottom: "24px", lineHeight: 1.5 }}>
          This action requires {requiredCredits} Claw{requiredCredits === 1 ? "" : "s"}.
          {Number.isFinite(credits) && <> Your balance is {credits} Claw{credits === 1 ? "" : "s"}.</>}
          {" "}Top up to continue; no new generation has started.
        </p>
        <div style={{ display: "flex", gap: "10px" }}>
          <button
            onClick={onClose}
            style={{ flex: 1, padding: "12px", background: "transparent", color: "#888", border: "1px solid #333", borderRadius: "8px", cursor: "pointer", fontWeight: "600" }}
          >
            Close
          </button>
          <button
            onClick={() => { onClose(); onTopUp(); }}
            style={{ flex: 1, padding: "12px", background: "var(--accent)", color: "#000", border: "none", borderRadius: "6px", cursor: "pointer", fontWeight: "800", fontSize: "13px" }}
            onMouseOver={e => e.currentTarget.style.opacity = "0.9"}
            onMouseOut={e => e.currentTarget.style.opacity = "1"}
          >
            Top Up Now
          </button>
        </div>
      </div>
    </div>
  );
});

export default NoCreditsModal;
