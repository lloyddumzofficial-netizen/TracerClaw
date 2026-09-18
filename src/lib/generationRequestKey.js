const PREFIX = "desaynclaw:generation";

function storageKey(operation, projectId) {
  return `${PREFIX}:${operation}:${projectId}`;
}

function createKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now()}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
}

export function getOrCreateGenerationRequestKey(operation, projectId) {
  const key = storageKey(operation, projectId);
  try {
    const existing = globalThis.sessionStorage?.getItem(key);
    if (existing) return existing;
    const next = createKey();
    globalThis.sessionStorage?.setItem(key, next);
    return next;
  } catch {
    return createKey();
  }
}

export function clearGenerationRequestKey(operation, projectId) {
  try {
    globalThis.sessionStorage?.removeItem(storageKey(operation, projectId));
  } catch {
    // Storage can be unavailable in hardened/private browser contexts.
  }
}
