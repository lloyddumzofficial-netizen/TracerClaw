import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readUpscaleAttempt, saveUpscaleAttempt, resolveUpscaleAttempt, restoreUpscaleProject } from "@/lib/upscaleAttempt";

let storage;
beforeEach(() => {
  storage = new Map();
  vi.stubGlobal("sessionStorage", {
    getItem: key => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: key => storage.delete(key),
  });
});
afterEach(() => vi.unstubAllGlobals());
const attempt = () => ({ requestKey: "stable-request", imageUrl: "https://storage.test/source.png", profile: "logo", createdAt: Date.now() });

describe("logical upscale attempts", () => {
  it("restores a historical job without guessing the original generation profile", () => {
    const project = { id: "project-1", name: "Saved logo", original_image_url: "https://storage.test/source.png", generated_image_url: "https://storage.test/result.png", client_request_id: "paid-request", ai_prompt: "fal:topaz/upscale/image/precision:paid-job", created_at: new Date().toISOString() };
    expect(restoreUpscaleProject(project, { ...attempt(), projectId: "another-project" })).toMatchObject({ projectId: "project-1", requestKey: "paid-request", requestId: "paid-job", upscaledUrl: project.generated_image_url, profile: null });
    expect(restoreUpscaleProject(project, { ...attempt(), projectId: "project-1" }).profile).toBe("logo");
    expect(restoreUpscaleProject({ ...project, generated_image_url: "REFUNDED" }).upscaledUrl).toBeNull();
  });
  it("isolates users, restores reloads and expires records with retained assets", () => {
    const value = attempt();
    saveUpscaleAttempt("user-1", value);
    expect(readUpscaleAttempt("user-1")).toEqual(value);
    expect(readUpscaleAttempt("user-2")).toBeNull();
    saveUpscaleAttempt("user-1", { ...value, createdAt: Date.now() - 4 * 86400000 });
    expect(readUpscaleAttempt("user-1")).toBeNull();
    saveUpscaleAttempt("user-1", null);
    expect(storage.size).toBe(0);
  });

  it("survives unavailable storage using the in-memory attempt", () => {
    vi.stubGlobal("sessionStorage", { getItem: () => { throw new Error("Denied"); }, setItem: () => { throw new Error("Denied"); } });
    expect(readUpscaleAttempt("user-1")).toBeNull();
    expect(() => saveUpscaleAttempt("user-1", attempt())).not.toThrow();
  });

  it("retries an uncertain POST with exactly the same source, key and profile", async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new TypeError("Connection lost"))
      .mockResolvedValueOnce(Response.json({ success: true, projectId: "project-1", requestId: "job-1" }));
    vi.stubGlobal("fetch", fetch);
    const value = attempt();
    const poll = vi.fn(async () => "https://storage.test/result.png");
    const options = { attempt: value, token: "test", poll, onUpdate: vi.fn() };
    await expect(resolveUpscaleAttempt(options)).rejects.toThrow("Connection lost");
    expect(await resolveUpscaleAttempt(options)).toContain("result.png");
    expect(fetch.mock.calls[0][1].body).toBe(fetch.mock.calls[1][1].body);
    expect(poll).toHaveBeenCalledWith({ projectId: "project-1", requestId: "job-1", token: "test" });
  });

  it("polls saved projects directly and does not resubmit after a lost status response", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const value = { ...attempt(), projectId: "project-1" };
    const poll = vi.fn().mockRejectedValueOnce(new Error("Offline")).mockResolvedValueOnce("https://storage.test/result.png");
    const options = { attempt: value, token: "test", poll, onUpdate: vi.fn() };
    await expect(resolveUpscaleAttempt(options)).rejects.toThrow("Offline");
    expect(await resolveUpscaleAttempt(options)).toContain("result.png");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("retains the claimed project even when the server reports a temporary save failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ projectId: "project-1", retryable: true, error: "Save pending" }, { status: 500 })));
    const value = attempt();
    const onUpdate = vi.fn();
    await expect(resolveUpscaleAttempt({ attempt: value, token: "test", poll: vi.fn(), onUpdate })).rejects.toThrow("Save pending");
    expect(value.projectId).toBe("project-1");
    expect(onUpdate).toHaveBeenCalledWith(value);
  });

  it.each([{ refunded: true, error: "Refunded" }, { error: "INSUFFICIENT_CREDITS" }])("allows a new attempt only after a confirmed terminal response: %j", async data => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(data, { status: 500 })));
    await expect(resolveUpscaleAttempt({ attempt: attempt(), token: "test", poll: vi.fn(), onUpdate: vi.fn() })).rejects.toMatchObject({ attemptFinished: true });
  });
});
