import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
const auth = vi.hoisted(() => ({ getSession: vi.fn(), onAuthStateChange: vi.fn() }));
vi.mock("@/utils/supabase/client", () => ({ createClient: () => ({ auth }) }));
let client, event;
const card = { id: "project", trace_type: "design_extract", original_image_url: "https://owned.test/image.png", width: 800, height: 1200 };
const document = { project: { id: "project", expires_at: "2099-01-01", manifest: { width: 800, height: 1200, layers: [] } }, job: null, billing: { mode: "paid" }, guidedCutouts: false };
beforeEach(async () => {
  vi.resetModules(); vi.useFakeTimers();
  auth.getSession.mockResolvedValue({ data: { session: { user: { id: "owner" }, access_token: "token" } } });
  auth.onAuthStateChange.mockImplementation(callback => { event = callback; return { data: { subscription: { unsubscribe() {} } } }; });
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => structuredClone(document) })));
  client = await import("@/features/design-extract/projectClient");
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("private project memory cache", () => {
  it("seeds only the thumbnail, deduplicates prefetch, then expires validated data after 60 seconds", async () => {
    client.seedDesignPreview("owner", card);
    expect(client.editorSeed("project")).toMatchObject({ preview: true, project: { source_url: card.original_image_url } });
    await Promise.all([client.fetchDesignProject("project"), client.fetchDesignProject("project")]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(client.editorSeed("project")).toMatchObject(document);
    expect(client.editorSeed("project").thumbnailUrl).toBe(card.original_image_url);
    await client.fetchDesignProject("project"); expect(fetch).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60001);
    expect(client.editorSeed("project")).toBeNull();
    await client.fetchDesignProject("project"); expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("clears on sign-out, identity change, access denial, deletion and expiry", async () => {
    await client.fetchDesignProject("project"); event("SIGNED_OUT", null);
    expect(client.editorSeed("project")).toBeNull();
    await client.fetchDesignProject("project"); client.seedDesignPreview("another-user", { ...card, id: "another" });
    expect(client.editorSeed("project")).toBeNull();
    await client.fetchDesignProject("project"); client.forgetDesignProject("project"); expect(client.editorSeed("project")).toBeNull();
    client.cacheDesignProject({ ...document, project: { ...document.project, expires_at: "2000-01-01" } }); expect(client.editorSeed("project")).toBeNull();
    await client.fetchDesignProject("project");
    fetch.mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({ error: "Denied" }) });
    await expect(client.fetchDesignProject("project", true)).rejects.toMatchObject({ status: 403 });
    expect(client.editorSeed("project")).toBeNull();
  });
  it("revalidates the extraction mode after a mutation returns only the saved project", async () => {
    const guided = { ...document, guidedCutouts: true };
    fetch.mockResolvedValueOnce({ ok: true, json: async () => guided });
    await client.fetchDesignProject("project");
    expect(client.editorSeed("project").guidedCutouts).toBe(true);

    const project = { ...document.project, revision: 1 };
    client.cacheDesignProject({ project, billing: document.billing });
    expect(client.editorSeed("project")).toBeNull();
    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ ...guided, project }) });
    await expect(client.fetchDesignProject("project")).resolves.toMatchObject({ project: { revision: 1 }, guidedCutouts: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("discards a response that arrives after sign-out", async () => {
    let resolve;
    fetch.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const pending = client.fetchDesignProject("project");
    await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
    event("SIGNED_OUT", null);
    resolve({ ok: true, json: async () => document });
    await expect(pending).rejects.toMatchObject({ status: 401 });
    expect(client.editorSeed("project")).toBeNull();
  });
});
