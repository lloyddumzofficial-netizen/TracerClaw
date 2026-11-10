import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), ownedProject: vi.fn(), startEdit: vi.fn(), readEdit: vi.fn(), settleEdit: vi.fn(), applyEdit: vi.fn(), listEdits: vi.fn(), enabled: true }));
vi.mock("@/lib/supabase", () => ({ adminSupabase: { auth: { getUser: mocks.getUser } } }));
vi.mock("@/utils/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: mocks.getUser } }) }));
vi.mock("@/lib/rateLimit", () => ({ enforceRateLimit: async () => ({ success: true }) }));
vi.mock("@/server/artworkEdits/service", () => ({ ...mocks, artworkEditsEnabled: () => mocks.enabled, publicEdit: edit => edit, editError: (message,status) => Object.assign(new Error(message),{status}) }));
import { GET, POST } from "@/app/api/projects/[id]/artwork-edits/route";
import { POST as apply } from "@/app/api/projects/[id]/artwork-edits/[editId]/apply/route";
const context = { params: Promise.resolve({ id: "project-1", editId: "edit-1" }) };
const req = body => new Request("http://localhost/api/projects/project-1/artwork-edits", { method: body === undefined ? "GET" : "POST", headers: { Authorization: "Bearer token", "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }) });
beforeEach(() => {
  vi.clearAllMocks(); mocks.enabled=true;
  mocks.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  mocks.ownedProject.mockResolvedValue({ id: "project-1" }); mocks.listEdits.mockResolvedValue([]);
  mocks.startEdit.mockResolvedValue({ id: "edit-1", status: "processing" });
  mocks.applyEdit.mockResolvedValue({ generated_image_url: "edited.png", svg_url: null });
});
it("requires authentication and gates the feature before any charge", async () => {
  mocks.getUser.mockResolvedValue({ data: { user: null }, error: true });
  expect((await POST(req({}),context)).status).toBe(401);
  expect(mocks.startEdit).not.toHaveBeenCalled();
});
it("hides disabled editor and refuses POST even when called directly", async () => {
  mocks.enabled=false;
  expect(await (await GET(req(),context)).json()).toMatchObject({ enabled:false });
  expect((await POST(req({}),context)).status).toBe(403);
  expect(mocks.startEdit).not.toHaveBeenCalled();
});
it("checks ownership and validates body size before submitting", async () => {
  mocks.ownedProject.mockRejectedValueOnce(Object.assign(new Error("Not found"), { status:404 }));
  expect((await POST(req({}),context)).status).toBe(404);
  expect((await POST(req('x'.repeat(256*1024+1)),context)).status).toBe(413);
  expect(mocks.startEdit).not.toHaveBeenCalled();
});
it("returns the authoritative owned artifact revision without prompt or internal project fields",async()=>{
  mocks.ownedProject.mockResolvedValue({id:"project-1",user_id:"user-1",artwork_revision:3,generated_image_url:"https://storage.test/current.png",upscaled_image_url:null,svg_url:null,ai_prompt:"PRIVATE_PROMPT",internal_field:"private"});
  const response=await GET(req(),context);const data=await response.json();
  expect(response.status).toBe(200);
  expect(mocks.ownedProject).toHaveBeenCalledWith("user-1","project-1");
  expect(data.project).toMatchObject({id:"project-1",artwork_revision:3,generated_image_url:"https://storage.test/current.png"});
  expect(data.project).not.toHaveProperty("ai_prompt");expect(data.project).not.toHaveProperty("user_id");expect(data.project).not.toHaveProperty("internal_field");
  expect(mocks.startEdit).not.toHaveBeenCalled();
});
it("passes the exact user/project and request to the isolated submitter", async () => {
  const body={ sourceRevision:2,requestKey:"request-1234567890",instructions:[] };
  expect((await POST(req(body),context)).status).toBe(202);
  expect(mocks.startEdit).toHaveBeenCalledWith({id:"project-1"},{id:"user-1"},body);
});
it("applies or restores through the atomic ownership-checked service", async () => {
  expect((await apply(req({restore:true}),context)).status).toBe(200);
  expect(mocks.applyEdit).toHaveBeenCalledWith("user-1","project-1","edit-1",true);
});
