// Preserve structured provider diagnostics without logging prompts, images,
// URLs, or the provider's `input` field.
export function getTraceProviderFailure(error) {
  const detail = Array.isArray(error?.body?.detail) ? error.body.detail : [];
  const contentBlocked = detail.some(item => item?.type === "content_policy_violation");
  const safeLabel = value => typeof value === "string" && /^[a-z0-9_-]{1,80}$/i.test(value);
  return {
    contentBlocked,
    types: [...new Set(detail.map(item => item?.type).filter(safeLabel))].slice(0, 10),
    categories: [...new Set(detail.flatMap(item => Array.isArray(item?.categories) ? item.categories : []).filter(safeLabel))].slice(0, 10),
    requestId: safeLabel(error?.requestId) ? error.requestId : null,
  };
}
