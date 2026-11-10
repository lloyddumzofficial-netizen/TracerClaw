// Optional isolated PostgreSQL execution. No connection to a real Supabase project.
// Setup: pnpm --dir scratch/artwork-sql add @electric-sql/pglite
import { beforeAll, beforeEach, afterAll, describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
const require = createRequire(import.meta.url);
let PGlite;
try { ({ PGlite } = require("../../scratch/artwork-sql/node_modules/@electric-sql/pglite")); } catch { /* Optional test runtime is intentionally not a production dependency. */ }
describe.skipIf(!PGlite)("artwork-edit transactions in PostgreSQL", () => {
  let db, user, project;
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE TABLE public.profiles(id uuid PRIMARY KEY,credits integer NOT NULL);
      CREATE TABLE public.projects(id uuid PRIMARY KEY,user_id uuid REFERENCES profiles(id),trace_type text,ai_prompt text,created_at timestamptz DEFAULT now(),generated_image_url text,upscaled_image_url text,svg_url text,zip_url text,zip_signature text,zip_generated_at timestamptz,google_drive_folder_id text,google_drive_folder_url text,google_drive_exported_at timestamptz,google_drive_export_signature text,credit_deducted boolean DEFAULT true,refunded boolean DEFAULT false);
      CREATE TABLE public.credit_logs(id serial PRIMARY KEY,user_id uuid,action text,amount integer);`);
    const attempts=readFileSync("database/migrations/021_generation_attempt_idempotency.sql","utf8").split("CREATE OR REPLACE FUNCTION")[0];
    await db.exec(attempts);
    await db.exec(readFileSync("database/migrations/036_artwork_edits.sql","utf8"));
  },60000);
  beforeEach(async () => {
    await db.exec("TRUNCATE public.profiles CASCADE; TRUNCATE public.credit_logs;");
    user=randomUUID();project=randomUUID();
    await db.query("INSERT INTO profiles(id,credits)VALUES($1,5)",[user]);
    await db.query("INSERT INTO projects(id,user_id,trace_type,generated_image_url,upscaled_image_url,svg_url)VALUES($1,$2,'standard','flat.png','hd.png','vector.svg')",[project,user]);
  });
  afterAll(async()=>{await db?.close();});
  const claim=async(key="request-key-1234567890",revision=0,source="flat.png")=>(await db.query("SELECT claim_artwork_edit($1,$2,$3,$4,$5,$6,$7) AS result",[user,project,key,revision,source,JSON.stringify([{id:1,prompt:"Remove text",shapes:[]}]),"fingerprint"])).rows[0].result;
  const settle=async(id,result=null)=>(await db.query("SELECT settle_artwork_edit($1,$2,$3,$4) AS result",[id,user,result,result?null:"FAILED"])).rows[0].result;
  const apply=async(id,restore=false)=>(await db.query("SELECT apply_artwork_edit($1,$2,$3) AS result",[id,user,restore])).rows[0].result;
  const balance=async()=>(await db.query("SELECT credits FROM profiles WHERE id=$1",[user])).rows[0].credits;
  it("charges one batch once and replays the same attempt",async()=>{
    const first=await claim();const replay=await claim();
    expect(first.claimed).toBe(true);expect(replay.claimed).toBe(false);expect(replay.edit.id).toBe(first.edit.id);expect(await balance()).toBe(4);
    await expect(claim("another-request-key-12345")).rejects.toThrow("PROJECT_BUSY");expect(await balance()).toBe(4);
  });
  it("refunds exactly once without changing paid extraction flags",async()=>{
    const {edit}=await claim();await settle(edit.id);await settle(edit.id);
    expect(await balance()).toBe(5);
    expect((await db.query("SELECT credit_deducted,refunded,generated_image_url FROM projects WHERE id=$1",[project])).rows[0]).toEqual({credit_deducted:true,refunded:false,generated_image_url:"flat.png"});
  });
  it("keeps preview separate, then atomically invalidates downstream output and restores it",async()=>{
    const {edit}=await claim();await settle(edit.id,"edited.png");
    expect((await db.query("SELECT generated_image_url FROM projects WHERE id=$1",[project])).rows[0].generated_image_url).toBe("flat.png");
    const changed=await apply(edit.id);expect(changed).toMatchObject({generated_image_url:"edited.png",upscaled_image_url:null,svg_url:null,artwork_revision:1});
    const late=await db.query("UPDATE projects SET upscaled_image_url='stale-hd.png' WHERE id=$1 AND artwork_revision=0 RETURNING id",[project]);
    expect(late.rows).toHaveLength(0);
    expect((await apply(edit.id)).artwork_revision).toBe(1);
    const restored=await apply(edit.id,true);expect(restored).toMatchObject({generated_image_url:"flat.png",upscaled_image_url:"hd.png",svg_url:"vector.svg",artwork_revision:2});expect(await balance()).toBe(4);
  });
  it("retains a review warning through interrupted settlement without refunding or applying the preview",async()=>{
    const {edit}=await claim();
    await db.query("UPDATE artwork_edits SET error_code='EDIT_BOUNDARY_REVIEW' WHERE id=$1 AND status='processing'",[edit.id]);
    const ready=await settle(edit.id,"review-preview.png");
    expect(ready).toMatchObject({status:"ready",result_url:"review-preview.png",error_code:"EDIT_BOUNDARY_REVIEW"});
    expect(await settle(edit.id,"review-preview.png")).toMatchObject({status:"ready",error_code:"EDIT_BOUNDARY_REVIEW"});
    expect(await balance()).toBe(4);
    expect((await db.query("SELECT generated_image_url FROM projects WHERE id=$1",[project])).rows[0].generated_image_url).toBe("flat.png");
  });
  it("refuses stale source application, insufficient credits, and another user's project",async()=>{
    const {edit}=await claim();await settle(edit.id,"edited.png");
    await db.query("UPDATE projects SET generated_image_url='new-extract.png' WHERE id=$1",[project]);
    await expect(apply(edit.id)).rejects.toThrow("SOURCE_CHANGED");
    await db.query("UPDATE profiles SET credits=0 WHERE id=$1",[user]);
    await expect(claim("new-request-key-123456",1,"new-extract.png")).rejects.toThrow("INSUFFICIENT_CREDITS");
    user=randomUUID();await expect(claim()).rejects.toThrow("PROJECT_NOT_FOUND");
  });
  it("blocks legacy generation while editing, but preserves normal legacy requests",async()=>{
    const {edit}=await claim();
    const insert=()=>db.query("INSERT INTO generation_attempts(user_id,project_id,operation,request_key)VALUES($1,$2,'trace','legacy-request-key-12345')",[user,project]);
    await expect(insert()).rejects.toThrow("PROJECT_BUSY");
    await settle(edit.id);await expect(insert()).resolves.toBeDefined();
  });
  it("rejects Clean Pattern Only even when called directly",async()=>{
    await db.query("UPDATE projects SET trace_type='mockup_erase',ai_prompt='ERASE_LOGOS' WHERE id=$1",[project]);
    await expect(claim()).rejects.toThrow("NO_GARMENT_ARTWORK");expect(await balance()).toBe(5);
  });
});
