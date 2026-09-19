export function getMockupRenderStage({ rendering, status, completed = 0, total = 5 }) {
  if (status === "completed" || completed >= total) return { label: "Campaign ready", tone: "ready" };
  if (["failed", "refunded"].includes(status)) return { label: "Render stopped", tone: "error" };
  if (!rendering) return { label: `${completed}/${total} views ready`, tone: "idle" };
  if (["queueing", "queued"].includes(status)) return { label: "Preparing garment", tone: "active" };
  if (completed === 0) return { label: "Matching artwork", tone: "active" };
  if (completed < total - 1) return { label: "Rendering campaign", tone: "active" };
  return { label: "Finalizing views", tone: "active" };
}
