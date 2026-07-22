"use client";

import { useState, useCallback, useRef } from "react";
import { safeJson } from "@/lib/safeJson";

/**
 * useTraceExecution — Manages the full 3-step AI pipeline execution.
 *
 * KEY DESIGN DECISIONS:
 * 1. `consoleRef` is a DOM ref passed to PropertiesPanel. logToConsole() writes
 *    directly to the DOM — zero React re-renders per log line during AI runs.
 * 2. `nodeErrors` provides per-node error isolation: if Step 2 fails, only
 *    Node 3 shows an error badge. The pipeline does not crash.
 */
export function useTraceExecution({ project, setProject, userCredits, setUserCredits, supabase, onNoCredits }) {
  const [traceState, setTraceState] = useState("idle"); // idle | step1 | step2 | step3
  const [nodeErrors, setNodeErrors] = useState({ step1: null, step2: null, step3: null });
  const consoleRef = useRef(null); // DOM ref for the console <div>

  // DOM-direct log write — zero React re-renders
  const logToConsole = useCallback((text, type = "normal") => {
    const container = consoleRef.current;
    if (!container) return;
    const el = document.createElement("div");
    el.className = `console-msg${type === "success" ? " success" : type === "error" ? " error" : ""}`;
    el.textContent = text;
    container.appendChild(el);
    container.scrollTop = container.scrollHeight;
  }, []);

  const clearConsole = useCallback((initialMsg) => {
    const container = consoleRef.current;
    if (!container) return;
    container.innerHTML = "";
    if (initialMsg) {
      const el = document.createElement("div");
      el.className = "console-msg";
      el.textContent = initialMsg;
      container.appendChild(el);
    }
  }, []);

  const handleExecuteTrace = useCallback(async (vectorColors = "auto", svgEngine = "standard") => {
    if (!project || traceState !== "idle") return;
    const isPrecisionSvg = svgEngine === "precision";
    const creditCost = isPrecisionSvg ? 2 : 1;

    if (userCredits !== null && userCredits < creditCost) {
      onNoCredits?.();
      return;
    }

    // Reset per-node errors
    setNodeErrors({ step1: null, step2: null, step3: null });

    // Deduct locally in UI for immediate feedback
    if (userCredits > 0) setUserCredits(prev => Math.max(0, prev - creditCost));

    // Fetch auth token once — used for all secure API calls in this pipeline
    let authToken = null;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      authToken = session?.access_token || null;
    } catch {
      // Token fetch failed — save-asset calls will still work via server-side project check
    }

    try {
      // ─── Step 1: Gemini ───────────────────────────────────────────────
      setTraceState("step1");
      clearConsole("[Step 1] Analyzing Image with DesaynVision™...");

      const res1 = await fetch("/api/trace", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authToken ? { "Authorization": `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({ projectId: project.id, step: 1 }),
      });

      if (!res1.ok) {
        const errData = await safeJson(res1, res1.status === 504 ? "504 Timeout" : `Server Error ${res1.status}`);
        const msg = errData.error || `Error ${res1.status}`;
        if (msg === "INSUFFICIENT_CREDITS") {
          setUserCredits(0);
          onNoCredits?.();
          setTraceState("idle");
          return;
        }
        setNodeErrors(prev => ({ ...prev, step1: msg }));
        throw new Error(msg);
      }

      const data1 = await safeJson(res1, "Trace step 1 failed");
      logToConsole("[Step 1.5] Saving extracted image...", "normal");

      const save1 = await fetch("/api/save-asset", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authToken ? { "Authorization": `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({ projectId: project.id, step: 1, base64: data1.base64, mimeType: data1.mimeType }),
      });
      const saveData1 = await safeJson(save1, "Failed to save image");
      if (!save1.ok) throw new Error(saveData1.error || "Failed to save image");

      setProject(prev => ({ ...prev, generated_image_url: saveData1.url }));
      logToConsole("[Success] Image Extracted by DesaynVision™!", "success");

      // ─── Step 2: Upscale ─────────────────────────────────────────────
      setTraceState("step2");
      logToConsole("[Step 2] Upscaling with ClawScale™ Matrix...", "normal");

      const res2 = await fetch("/api/trace", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authToken ? { "Authorization": `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({ projectId: project.id, step: 2 }),
      });

      if (!res2.ok) {
        const errData = await safeJson(res2, res2.status === 504 ? "504 Timeout" : `Server Error ${res2.status}`);
        const msg = errData.error || `Error ${res2.status}`;
        setNodeErrors(prev => ({ ...prev, step2: msg }));
        throw new Error(msg);
      }

      const data2 = await safeJson(res2, "Trace step 2 failed");
      logToConsole("[Step 2.5] Saving upscaled image...", "normal");

      const save2 = await fetch("/api/save-asset", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authToken ? { "Authorization": `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({ projectId: project.id, step: 2, fileUrl: data2.fileUrl, mimeType: data2.mimeType }),
      });
      const saveData2 = await safeJson(save2, "Failed to save upscaled image");
      if (!save2.ok) throw new Error(saveData2.error || "Failed to save upscaled image");

      setProject(prev => ({ ...prev, upscaled_image_url: saveData2.url }));
      logToConsole("[Success] Upscale Complete!", "success");

      // ─── Step 3: Vectorize ───────────────────────────────────────────
      setTraceState("step3");
      logToConsole(
        isPrecisionSvg
          ? "[Step 3] Vectorizing with Precision SVG Engine..."
          : "[Step 3] Vectorizing with TrueVector™ Core...",
        "normal"
      );

      const res3 = await fetch("/api/trace-step3", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authToken ? { "Authorization": `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({ projectId: project.id, colors: vectorColors, svgEngine }),
      });

      if (!res3.ok) {
        const errData = await safeJson(res3, res3.status === 504 ? "504 Timeout" : `Server Error ${res3.status}`);
        const msg = errData.error || `Error ${res3.status}`;
        setNodeErrors(prev => ({ ...prev, step3: msg }));
        throw new Error(msg);
      }

      const data3 = await safeJson(res3, "Trace step 3 failed");
      setProject(prev => ({ ...prev, svg_url: data3.svg_url }));
      logToConsole("[Success] Vectorization Complete!", "success");

      setTraceState("idle");
      return { success: true }; // Signal to page to open compare modal

    } catch (error) {
      setTraceState("idle");

      const isTimeout = error.message?.includes("504") || error.message?.includes("Failed to fetch");

      // Attempt client-side refund request
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          const refundRes = await fetch("/api/refund", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({ projectId: project.id }),
          });
          const refundData = await safeJson(refundRes, "Refund request failed");
          if (refundData.success) {
            logToConsole("[System] Generation failed. Charged credits were restored.", "success");
          }

          const { data: profile } = await supabase
            .from("profiles")
            .select("credits")
            .eq("id", session.user.id)
            .single();
          if (profile) setUserCredits(profile.credits);
        }
      } catch {
        // Refund request failed silently — backend auto-refund should cover it
      }

      const displayMsg = isTimeout
        ? "Request Timed Out. Please crop the image to make it simpler and try again."
        : error.message;

      if (!isTimeout) {
        // Only surface unexpected errors to the dev overlay, not timeout noise
        console.error("[Trace Error]", error);
      }

      logToConsole(`[Error] ${displayMsg}`, "error");
      setTraceState("idle");
      return { success: false };
    }
  }, [project, traceState, userCredits, setUserCredits, setProject, supabase, onNoCredits, logToConsole, clearConsole]);

  return {
    traceState,
    nodeErrors,
    consoleRef,
    logToConsole,
    clearConsole,
    handleExecuteTrace,
  };
}
