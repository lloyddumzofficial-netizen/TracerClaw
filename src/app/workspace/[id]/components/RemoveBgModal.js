"use client";

import { memo, useState } from "react";
import { ImageMinus, X, Loader2, Sparkles, ShieldCheck } from "lucide-react";
import { safeJson } from "@/lib/safeJson";

/**
 * RemoveBgModal — Redesigned confirmation modal for AI Background Removal.
 */
const RemoveBgModal = memo(function RemoveBgModal({
  show,
  project,
  supabase,
  onClose,
  onRemoveBgApplied,
}) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  if (!show) return null;

  const handleConfirm = async () => {
    if (!project?.id) return;
    setIsProcessing(true);
    setErrorMsg("");

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      
      const res = await fetch("/api/remove-bg", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          ...(token ? { "Authorization": `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ projectId: project.id }),
      });

      const data = await safeJson(res, "Failed to remove background.");
      if (!res.ok) throw new Error(data.error || "Failed to remove background.");

      onRemoveBgApplied(data.original_image_url, null);
      onClose();
    } catch (err) {
      setErrorMsg(err.message || "Something went wrong.");
      onRemoveBgApplied(null, err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const proxyUrl = project?.original_image_url
    ? `/api/proxy?url=${encodeURIComponent(project.original_image_url)}`
    : null;

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 99999,
      display: "flex", alignItems: "center", justifyContent: "center",
      background: "rgba(0,0,0,0.88)", backdropFilter: "blur(8px)",
      padding: "20px",
    }}>
      <div style={{
        background: "#141414",
        border: "1px solid #2a2a2a",
        width: "100%",
        maxWidth: "480px",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        boxShadow: "0 40px 80px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,215,0,0.06)",
        animation: "modalIn 0.18s ease-out",
      }}>

        {/* ── Header ─────────────────────────────────────────── */}
        <div style={{
          padding: "14px 18px",
          borderBottom: "1px solid #222",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          background: "#1a1a1a",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            {/* Icon badge */}
            <div style={{
              width: "30px", height: "30px",
              background: "rgba(255,215,0,0.1)",
              border: "1px solid rgba(255,215,0,0.25)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <ImageMinus size={15} color="#FFD700" />
            </div>
            <div>
              <div style={{ fontSize: "12px", fontWeight: "700", color: "#fff", letterSpacing: "1.5px", textTransform: "uppercase" }}>
                AI Background Remover
              </div>
              <div style={{ fontSize: "10px", color: "#555", marginTop: "1px", letterSpacing: "0.5px" }}>
                Powered by Fal.ai BiRefNet
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isProcessing}
            style={{
              background: "none", border: "1px solid #2a2a2a", color: "#555",
              cursor: isProcessing ? "not-allowed" : "pointer",
              width: "28px", height: "28px",
              display: "flex", alignItems: "center", justifyContent: "center",
              transition: "all 0.15s",
            }}
            onMouseOver={e => { if (!isProcessing) { e.currentTarget.style.borderColor = "#555"; e.currentTarget.style.color = "#fff"; }}}
            onMouseOut={e => { e.currentTarget.style.borderColor = "#2a2a2a"; e.currentTarget.style.color = "#555"; }}
          >
            <X size={14} />
          </button>
        </div>

        {/* ── Image Preview ───────────────────────────────────── */}
        <div style={{ padding: "18px 18px 0" }}>
          <div style={{
            width: "100%",
            height: "210px",
            background: "#111",
            border: "1px solid #222",
            overflow: "hidden",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            position: "relative",
          }}>
            {/* Processing overlay */}
            {isProcessing && (
              <div style={{
                position: "absolute", inset: 0, zIndex: 5,
                background: "rgba(0,0,0,0.75)",
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                gap: "12px",
              }}>
                <div style={{ position: "relative" }}>
                  <Loader2 size={32} color="#FFD700" style={{ animation: "spin 1s linear infinite" }} />
                </div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: "13px", color: "#FFD700", fontWeight: "600", letterSpacing: "1px" }}>
                    Removing Background...
                  </div>
                  <div style={{ fontSize: "10px", color: "#555", marginTop: "4px" }}>
                    This may take 10–20 seconds
                  </div>
                </div>
              </div>
            )}
            {proxyUrl && (
              <img
                src={proxyUrl}
                alt="Source"
                style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", opacity: isProcessing ? 0.3 : 1, transition: "opacity 0.3s" }}
              />
            )}
          </div>
        </div>

        {/* ── Info & Features ─────────────────────────────────── */}
        <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: "10px" }}>

          <p style={{ color: "#777", fontSize: "12px", lineHeight: "1.6", margin: 0 }}>
            Uses neural segmentation to precisely extract the foreground and erase the background — perfect for vectorization.
          </p>

          {/* Feature pills */}
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            {[
              { icon: <Sparkles size={10} />, label: "AI-Powered" },
              { icon: <ShieldCheck size={10} />, label: "Non-destructive" },
            ].map(({ icon, label }) => (
              <div key={label} style={{
                display: "flex", alignItems: "center", gap: "5px",
                background: "rgba(255,215,0,0.06)",
                border: "1px solid rgba(255,215,0,0.15)",
                padding: "3px 10px",
                fontSize: "10px", color: "#FFD700", fontWeight: "600",
                letterSpacing: "0.5px",
              }}>
                {icon} {label}
              </div>
            ))}
          </div>

          {/* Cost notice */}
          <div style={{
            display: "flex", alignItems: "center", gap: "8px",
            background: "rgba(255,215,0,0.04)",
            border: "1px solid #2a2a2a",
            padding: "8px 12px",
            fontSize: "11px",
          }}>
            <span style={{ fontSize: "14px" }}>🪙</span>
            <span style={{ color: "#888" }}>This action will consume <strong style={{ color: "#FFD700" }}>1 Credit</strong> from your account.</span>
          </div>

          {/* Error */}
          {errorMsg && (
            <div style={{
              color: "#ff6b6b", fontSize: "12px", padding: "10px 12px",
              background: "rgba(255,68,68,0.08)",
              border: "1px solid rgba(255,68,68,0.25)",
              display: "flex", alignItems: "flex-start", gap: "8px",
            }}>
              <span style={{ fontWeight: "700", flexShrink: 0 }}>✕</span>
              {errorMsg}
            </div>
          )}
        </div>

        {/* ── Footer ─────────────────────────────────────────── */}
        <div style={{
          padding: "14px 18px",
          borderTop: "1px solid #1e1e1e",
          display: "flex",
          gap: "10px",
          background: "#111",
        }}>
          <button
            onClick={onClose}
            disabled={isProcessing}
            style={{
              flex: 1,
              background: "transparent",
              color: isProcessing ? "#444" : "#888",
              border: "1px solid #2a2a2a",
              padding: "11px",
              fontSize: "11px",
              fontWeight: "700",
              cursor: isProcessing ? "not-allowed" : "pointer",
              textTransform: "uppercase",
              letterSpacing: "1.5px",
              transition: "all 0.15s",
            }}
            onMouseOver={e => { if (!isProcessing) { e.currentTarget.style.borderColor = "#555"; e.currentTarget.style.color = "#ccc"; }}}
            onMouseOut={e => { if (!isProcessing) { e.currentTarget.style.borderColor = "#2a2a2a"; e.currentTarget.style.color = "#888"; }}}
          >
            Cancel
          </button>

          <button
            onClick={handleConfirm}
            disabled={isProcessing}
            style={{
              flex: 2,
              background: isProcessing ? "rgba(255,215,0,0.15)" : "#FFD700",
              color: isProcessing ? "#888" : "#000",
              border: "1px solid " + (isProcessing ? "#333" : "#FFD700"),
              padding: "11px",
              fontSize: "11px",
              fontWeight: "800",
              cursor: isProcessing ? "not-allowed" : "pointer",
              textTransform: "uppercase",
              letterSpacing: "1px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
              transition: "all 0.15s",
            }}
            onMouseOver={e => { if (!isProcessing) e.currentTarget.style.background = "#FFC800"; }}
            onMouseOut={e => { if (!isProcessing) e.currentTarget.style.background = "#FFD700"; }}
          >
            {isProcessing ? (
              <>
                <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} />
                Processing...
              </>
            ) : (
              <>
                <ImageMinus size={13} strokeWidth={2.5} />
                Remove Background  (−1 Credit)
              </>
            )}
          </button>
        </div>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes modalIn {
          from { opacity: 0; transform: scale(0.96) translateY(8px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes spin { 100% { transform: rotate(360deg); } }
      `}} />
    </div>
  );
});

export default RemoveBgModal;
