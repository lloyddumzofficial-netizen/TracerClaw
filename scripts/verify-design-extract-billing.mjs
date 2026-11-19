// Isolated real-Postgres/WASM verification; never connects to production.
// Uses the pinned development dependency; an explicit runtime override is optional.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
const { PGlite } = await (process.env.PGLITE_TEST_MODULE ? import(pathToFileURL(path.resolve(process.env.PGLITE_TEST_MODULE)).href) : import('@electric-sql/pglite'));
const db = new PGlite();
try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE public.profiles(id uuid PRIMARY KEY, credits integer NOT NULL CHECK(credits >= 0));
    CREATE TABLE public.credit_logs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES public.profiles(id), action text NOT NULL, amount integer NOT NULL);
  `);
  for (const file of ["038_design_extract.sql", "039_design_extract_billing.sql"]) await db.exec(await readFile(`database/migrations/${file}`, "utf8"));
  const owner = "10000000-0000-4000-8000-000000000001", other = "10000000-0000-4000-8000-000000000002";
  const project = "20000000-0000-4000-8000-000000000001", second = "20000000-0000-4000-8000-000000000002";
  await db.query("INSERT INTO profiles VALUES ($1,5),($2,1)", [owner, other]);
  for (const id of [project, second]) await db.query("INSERT INTO design_extract_projects(id,user_id,source_url,manifest) VALUES ($1,$2,'https://test.invalid/source','{\"layers\":[]}')", [id, owner]);
  const balance = async () => (await db.query("SELECT credits FROM profiles WHERE id=$1", [owner])).rows[0].credits;
  const claim = async (key, kind = "extract", id = project, user = owner, revision = 0) => (await db.query("SELECT claim_design_extract($1,$2,$3,$4,$5,NULL,$6,$7::jsonb) AS result", [user, id, revision, key, kind, kind === "segment" ? "fal-ai/sam-3/image" : "fal-ai/qwen-image-layered", JSON.stringify({ image_url: "https://test.invalid/source" })])).rows[0].result;
  const settle = async id => (await db.query("SELECT settle_design_extract_billing($1,$2) AS result", [owner, id])).rows[0].result;
  assert.equal((await claim("unauthorized-key", "extract", project, other)).status, "not_found");
  const first = await claim("initial-request");
  assert.equal(first.status, "charged"); assert.equal(first.job.charge_amount, 2); assert.equal(await balance(), 3);
  assert.equal((await claim("initial-request")).status, "existing"); assert.equal(await balance(), 3);
  assert.equal((await claim("duplicate-new-key")).status, "operation_active");
  await assert.rejects(claim("initial-request", "split"));
  await db.query("UPDATE design_extract_jobs SET status='ready',result='{\"layers\":[{\"id\":\"layer\"}]}' WHERE id=$1", [first.job.id]);
  assert.equal((await settle(first.job.id)).status, "settled");
  assert.equal((await settle(first.job.id)).status, "settled"); assert.equal(await balance(), 3);
  await db.query("UPDATE design_extract_jobs SET status='accepted' WHERE id=$1", [first.job.id]);
  const failed = await claim("failed-request", "split");
  assert.equal(failed.status, "charged"); assert.equal(await balance(), 1);
  assert.equal((await claim("insufficient-key", "extract", second)).status, "insufficient_credits");
  assert.equal((await db.query("SELECT count(*)::int AS count FROM design_extract_jobs WHERE project_id=$1", [second])).rows[0].count, 0);
  await db.query("UPDATE design_extract_jobs SET status='failed' WHERE id=$1", [failed.job.id]);
  assert.equal((await settle(failed.job.id)).status, "refunded"); assert.equal(await balance(), 3);
  assert.equal((await settle(failed.job.id)).status, "refunded"); assert.equal(await balance(), 3);
  assert.equal((await claim("wrong-revision", "extract", second, owner, 10)).status, "revision_conflict");
  const selection = await claim("selection-request", "segment", second);
  assert.equal(selection.job.charge_amount, 1); assert.equal(await balance(), 2);
  assert.equal(selection.job.dispatch_started_at, null);
  const claimDispatch = () => db.query("UPDATE design_extract_jobs SET dispatch_started_at=now() WHERE id=$1 AND dispatch_started_at IS NULL AND status='submitting' AND billing_state='held' RETURNING id", [selection.job.id]);
  const dispatchClaims = await Promise.all([claimDispatch(), claimDispatch(), claimDispatch()]);
  assert.equal(dispatchClaims.reduce((count, result) => count + result.rows.length, 0), 1);
  assert.equal(await balance(), 2);

  // A lost provider receipt stays reserved; repeating the key does not spend more.
  assert.equal((await claim("selection-request", "segment", second)).status, "existing");
  assert.equal((await settle(selection.job.id)).status, "held"); assert.equal(await balance(), 2);
  const signature = "public.claim_design_extract(uuid,uuid,integer,text,text,text,text,jsonb)";
  for (const role of ["anon", "authenticated", "service_role"]) {
    const result = await db.query("SELECT has_function_privilege($1,$2,'EXECUTE') AS allowed", [role, signature]);
    assert.equal(result.rows[0].allowed, role === "service_role");
  }
  assert.deepEqual((await db.query("SELECT amount FROM credit_logs ORDER BY ctid")).rows.map(row => row.amount), [-2, -2, 2, -1]);
  // Overlapping calls share one database connection here; multi-session lock
  // contention still requires a PostgreSQL integration environment.
  await db.query("UPDATE design_extract_jobs SET status='failed' WHERE id=$1", [selection.job.id]);
  const refunds = await Promise.all(Array.from({ length: 8 }, () => settle(selection.job.id)));
  assert(refunds.every(result => result.status === "refunded")); assert.equal(await balance(), 3);
  const sam2Migration = await readFile("database/migrations/041_design_extract_sam2.sql", "utf8");
  await db.exec(sam2Migration); await db.exec(sam2Migration);
  for (const [kind, model, cost] of [["extract", "fal-ai/sam2/auto-segment", 2], ["segment", "fal-ai/sam2/image", 1]]) {
    const result = (await db.query("SELECT claim_design_extract($1,$2,0,$3,$4,NULL,$5,$6::jsonb) AS result", [owner, second, `sam2-${kind}-request`, kind, model, JSON.stringify({ image_url: "https://test.invalid/source" })])).rows[0].result;
    assert.equal(result.status, "charged"); assert.equal(result.job.model, model);
    assert.equal(result.job.charge_amount, cost); assert.equal(await balance(), 3 - cost);
    await db.query("UPDATE design_extract_jobs SET status='failed' WHERE id=$1", [result.job.id]);
    assert.equal((await settle(result.job.id)).status, "refunded"); assert.equal(await balance(), 3);
  }
  for (const [kind, model] of [["extract", "https://untrusted.test/model"], ["extract", "fal-ai/sam2/image"], ["segment", "fal-ai/sam2/auto-segment"], ["extract", null]]) {
    await assert.rejects(db.query("SELECT claim_design_extract($1,$2,0,'invalid-model-request',$3,NULL,$4,'{}'::jsonb)", [owner, second, kind, model]), /Invalid extraction model/);
    assert.equal(await balance(), 3);
  }
  assert.equal((await claim("initial-request")).status, "existing");
  for (const role of ["anon", "authenticated", "service_role"]) assert.equal((await db.query("SELECT has_function_privilege($1,$2,'EXECUTE') AS allowed", [role, signature])).rows[0].allowed, role === "service_role");
  console.log("Billing SQL verified: atomic reservations, fixed tariffs, ownership, duplicates, active-job lock, insufficient funds, revision conflicts, one-time refunds, lost receipts, and function privileges.");
} catch (error) { console.error("Billing SQL verification failed:", error.message, error.code || "", error.where || "", error.position || "", error.internalQuery || ""); process.exitCode = 1; } finally { await db.close(); }
