import { vi } from "vitest";

export function jsonRequest(body, { token = "test-token", url = "http://localhost/api/test" } = {}) {
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

export function okRateLimit() {
  return vi.fn(async () => ({ success: true, headers: {} }));
}

export function mockQuery(result) {
  const query = {};
  const methods = ["select", "eq", "gte", "order", "limit", "update"];
  for (const method of methods) {
    query[method] = vi.fn(() => query);
  }
  query.single = vi.fn(async () => result);
  query.maybeSingle = vi.fn(async () => result);
  return query;
}

export function createTableRouter(routes = {}) {
  const calls = [];
  const from = vi.fn((table) => {
    const route = routes[table];
    if (!route) throw new Error(`Unexpected table: ${table}`);
    return route({ table, calls });
  });
  return { from, calls };
}
