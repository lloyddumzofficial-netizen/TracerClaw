// Emergency AI-service pause, explicitly enabled with AI_MAINTENANCE_MODE=on.
// Provider funding has been restored; normal service is the default again.
export const MAINTENANCE_RETURN_LABEL = "1:00 PM";
export const MAINTENANCE_RETURN_DATE = "October 28, 2026";
export const MAINTENANCE_MESSAGE = "AI processing is temporarily paused. We expect service to return by 1:00 PM on October 28, 2026 (Philippine time). Please wait for confirmation before generating again.";

export function isMaintenanceEnabled() {
  return process.env.AI_MAINTENANCE_MODE === "on";
}

export function isMaintenancePage(path) {
  return path === "/" || /^\/(workspace|upscale|bg-remover|mockup-studio|mobile)(\/|$)/.test(path);
}

export function isPausedGeneration(path, method) {
  if (path === "/api/cron/mockup-jobs") return true;
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) return false;
  return /^\/api\/(trace|trace-step3|upscale|remove-bg|crop|upload|upload-url|upload-direct|upload-mobile)\/?$/.test(path)
    || /^\/api\/mockups\/[^/]+\/render\/?$/.test(path)
    || /^\/api\/mockups\/jobs\/[^/]+\/retry\/?$/.test(path);
}
