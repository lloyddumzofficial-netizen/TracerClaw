import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import sharp from "sharp";
import { randomFillSync } from "node:crypto";
import { jsonRequest } from "../helpers/routeTestUtils";
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), from: vi.fn(), rpc: vi.fn(), status: vi.fn(), result: vi.fn(), submit: vi.fn(), fetch: vi.fn(), upload: vi.fn(), privateRead: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ adminSupabase: { auth: { getUser: mocks.getUser }, from: mocks.from, rpc: mocks.rpc } }));
vi.mock("@/lib/rateLimit", () => ({ enforceRateLimit: async () => ({ success: true }) }));
vi.mock("@fal-ai/client", () => ({ fal: { queue: { status: mocks.status, result: mocks.result, submit: mocks.submit } } }));
vi.mock("@/server/designExtract/storage", async () => ({ ...(await vi.importActual("@/server/designExtract/storage")), uploadDesignAsset: mocks.upload, readPrivateDesignAsset: mocks.privateRead }));
vi.mock("@/server/designExtract/processing/launcher",()=>({maintainDesignWorkflows:async()=>{},wakeDesignWorkflow:async()=>{}}));
vi.mock("@/server/designExtract/submission", () => ({ submitDesignOperation: mocks.submit }));
vi.mock("@/lib/cloudflare", () => ({ bucketName: "public-bucket", s3Client: { send: vi.fn(async () => ({ Contents: [] })) }, uploadToR2: mocks.upload, deleteR2Prefix: vi.fn() }));
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: async () => "https://private-signed.test/source.png" }));
vi.mock("@/lib/ssrf", () => ({ fetchWithSSRFProtection: mocks.fetch, getAllowedProviderHosts: () => ["fal.media"], getAllowedStorageHosts: () => ["r2.test"], isOwnedStorageUrl: (url, { userId }) => url?.startsWith(`https://r2.test/users/${userId}/`) }));
import { GET, POST } from "@/app/api/design-extract/route";
import { GET as getDocument, PATCH as patchDocument, POST as postDocument } from "@/app/api/design-extract/[id]/route";
import { POST as syncDocument } from "@/app/api/design-extract/[id]/sync/route";
import { GET as getAsset } from "@/app/api/design-extract/[id]/asset/route";
import { readAsset, ownedProject, createProject, startOperation, settleOperation, reviewOperation, recoverOperation, snapshot, editLayerAsset } from "@/server/designExtract/service";
import { renameDesignProject, deleteDesignProject } from "@/server/designExtract/service";
import { maintainDesignExtract } from "@/server/designExtract/maintenance";
import { deleteR2Prefix } from "@/lib/cloudflare";
import { designError } from "@/server/designExtract/access";
import { findAutomaticTargets, prepareAutomaticMask } from "@/server/designExtract/automaticSeparation";
import { nanoColumnGuide, splitNanoElements } from "@/server/designExtract/nanoElements";
function query(data, error = null) {
  const q = {};
  for (const key of ["select", "eq", "neq", "is", "gt", "lt", "in", "order", "limit", "insert", "update", "delete"]) q[key] = vi.fn(() => q);
  q.single = q.maybeSingle = vi.fn(async () => ({ data, error }));
  q.then = (resolve, reject) => Promise.resolve({ data, error }).then(resolve, reject);
  return q;
}
const project = { id: "project-1", user_id: "admin-1", revision: 0, source_url: "https://r2.test/users/admin-1/source.png", manifest: { version: 1, width: 100, height: 100, layers: [] }, expires_at: "2099-01-01" };
beforeEach(async () => {
  vi.resetAllMocks(); vi.stubEnv("DESIGN_EXTRACT_PRIVATE_BUCKET", "design-extract-private"); vi.stubEnv("DESIGN_EXTRACT_BILLING_MODE", "beta"); vi.stubEnv("ADMIN_EMAIL", "admin@test.com"); vi.stubEnv("DESIGN_EXTRACT_ENABLED", "true");
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("FAL_KEY", "mock-key");
  mocks.fetch.mockResolvedValue({buffer:await sharp({create:{width:100,height:100,channels:4,background:"#fff"}}).png().toBuffer()});
  mocks.upload.mockImplementation(async (_bytes,key)=>"r2-private://design-extract/"+key);
  mocks.getUser.mockResolvedValue({ data: { user: { id: "admin-1", email: "admin@test.com" } } });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it("automatically saves a ready Nano Banana result on sync without submitting another job", async () => {
  vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("VERCEL", "");
  const layer = { id: "nano-graphic", name: "Graphic 1", width: 40, height: 60, url: project.source_url,
    layout: { x: 0, y: 0, scale: 1 }, composition: { x: 0, y: 0, scale: 1 } };
  const ready = { id: "nano-result", user_id: project.user_id, processor: "local", kind: "extract", status: "ready", base_revision: 0,
    input: { _desaynclaw: { autoSeparation: true, whiteElements: true, nanoElements: true } },
    result: { replaceExtraction: true, layers: [layer] } };
  const context = { params: { id: project.id } };
  mocks.from.mockReturnValueOnce(query(project)).mockReturnValueOnce(query([ready])).mockReturnValueOnce(query({ credits: 4 }));
  const reopened = await getDocument(jsonRequest({}), context);
  expect((await reopened.json()).job).toMatchObject({ status: "ready", autoAccept: true });
  expect(mocks.rpc).not.toHaveBeenCalled();

  const accepted = { ...ready, status: "accepted" };
  const updated = { ...project, revision: 1, manifest: { ...project.manifest, layers: [layer] } };
  mocks.from.mockReturnValueOnce(query(project)).mockReturnValueOnce(query([ready])).mockReturnValueOnce(query(ready))
    .mockReturnValueOnce(query(updated)).mockReturnValueOnce(query([accepted])).mockReturnValueOnce(query({ credits: 4 }));
  mocks.rpc.mockResolvedValueOnce({ data: true });
  const synced = await syncDocument(jsonRequest({}), context);
  expect(await synced.json()).toMatchObject({ job: { id: ready.id, status: "accepted" }, project: { revision: 1, manifest: { layers: [layer] } } });
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("review_design_extract", expect.objectContaining({
    expected_revision: 0, target_job: ready.id, accepted: true,
  }));
  expect(mocks.submit).not.toHaveBeenCalled();

  mocks.from.mockReturnValueOnce(query(updated)).mockReturnValueOnce(query([accepted])).mockReturnValueOnce(query({ credits: 4 }));
  expect((await (await syncDocument(jsonRequest({}), context)).json()).job.status).toBe("accepted");
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
});

it("leaves a Nano Banana replacement or stale result awaiting explicit review", async () => {
  vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("VERCEL", "");
  const ready = { id: "replacement", processor: "local", kind: "extract", status: "ready", base_revision: 0,
    input: { _desaynclaw: { autoSeparation: true, nanoElements: true } }, result: { replaceExtraction: true, layers: [{ id: "preview" }] } };
  for (const current of [{ ...project, manifest: { ...project.manifest, layers: [{ id: "saved" }] } }, { ...project, revision: 1 }]) {
    mocks.from.mockReturnValueOnce(query(current)).mockReturnValueOnce(query([ready])).mockReturnValueOnce(query({ credits: 4 }));
    const synced = await syncDocument(jsonRequest({}), { params: { id: current.id } });
    expect((await synced.json()).job).toMatchObject({ status: "ready" });
  }
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it("downloads the selected review variant when a saved layer has the same ID", async () => {
  const id = "artwork";
  const saved = { id, url: "https://r2.test/users/admin-1/saved.png" };
  const base = { width: 40, height: 40, url: "https://r2.test/users/admin-1/review-base.png" };
  const candidate = { ...saved, width: 80, height: 80, layout: { scale: 1 }, composition: { scale: 1 }, baseVariant: base };
  mocks.from.mockReturnValueOnce(query({ ...project, manifest: { ...project.manifest, layers: [saved] } }))
    .mockReturnValueOnce(query({ result: { layers: [candidate] } }));
  const response = await getAsset(new Request(`https://example.test/api/design-extract/${project.id}/asset?layer=${id}&review=base`, {
    headers: { Authorization: "Bearer mock-token" },
  }), { params: { id: project.id } });
  expect(response.status).toBe(200);
  expect(mocks.fetch).toHaveBeenCalledWith(base.url, expect.anything());
});

it("saves complete white-background Nano Banana outputs as independent layers without requesting a fill", async () => {
  vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("VERCEL", "");
  const target = { name: "Whole wordmark", box: { left: 10, top: 10, width: 60, height: 30 } };
  const seal = { name: "Seal", box: { left: 70, top: 40, width: 25, height: 25 } };
  const job = { id: "white-batch", project_id: project.id, user_id: project.user_id, processor: "local", kind: "extract",
    model: "google/nano-banana-2.1/edit", status: "saving", request_id: "wordmark-receipt", created_at: new Date().toISOString(),
    input: { image_url: project.source_url, _desaynclaw: { autoSeparation: true, whiteElements: true, guidedCutout: target, additionalTargets: [seal] } },
    result: { cutoutBatch: { stage: "queued", masks: [{ target: seal, requestId: "seal-receipt" }], missing: [] } } };
  const image = await sharp(Buffer.from('<svg width="120" height="100" xmlns="http://www.w3.org/2000/svg"><path fill="white" d="M0 0h120v100H0z"/><circle cx="60" cy="50" r="21" fill="#146450"/></svg>')).jpeg().toBuffer();
  mocks.status.mockResolvedValue({ status: "COMPLETED" });
  mocks.result.mockResolvedValue({ data: { images: [{ url: "https://test.fal.media/isolated.jpg" }] } });
  mocks.fetch.mockResolvedValue({ buffer: image });
  const saved = query(null);
  saved.maybeSingle.mockImplementation(async () => ({ data: { ...job, ...saved.update.mock.calls[0][0] } }));
  mocks.from.mockReturnValueOnce(saved);
  const result = await settleOperation(project, job);
  expect(result).toMatchObject({ status: "ready", result: { replaceExtraction: true, missing: [], layers: [
    { name: "Whole wordmark", visibility: { overview: true, composition: true }, width: 120 },
    { name: "Seal", visibility: { overview: true, composition: false }, width: 120 },
  ] } });
  expect(mocks.result.mock.calls.map(([model]) => model)).toEqual([job.model, job.model]);
  expect(mocks.submit).not.toHaveBeenCalled();
  expect(await sharp(mocks.upload.mock.calls[0][0]).metadata()).toMatchObject({ format: "png", hasAlpha: false });
});

it("processes every detected white-background target over multiple syncs without resubmitting", async () => {
  vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("VERCEL", "");
  const source = await sharp({ create: { width: 100, height: 100, channels: 3, background: "#165840" } }).png().toBuffer();
  const names = ["Wordmark", "Seal", "Landscape", "Leaf icon", "Fish illustration"];
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ output: JSON.stringify(
    names.map((name, index) => ({ name, box_2d: [index * 180, 100, index * 180 + 120, 800] })),
  ) })));
  const [first, ...additionalTargets] = await findAutomaticTargets({ bytes: source }, project.manifest, true);
  expect([first, ...additionalTargets].map(target => target.name)).toEqual(names);
  const image = await sharp(Buffer.from('<svg width="120" height="100" xmlns="http://www.w3.org/2000/svg"><path fill="white" d="M0 0h120v100H0z"/><circle cx="60" cy="50" r="21" fill="#146450"/></svg>')).png().toBuffer();
  mocks.fetch.mockImplementation(async url => ({ buffer: String(url).includes("fal.media") ? image : source }));
  mocks.status.mockResolvedValue({ status: "COMPLETED" });
  mocks.result.mockResolvedValue({ data: { images: [{ url: "https://test.fal.media/isolated.png" }] } });
  mocks.submit.mockImplementation(async () => ({ request_id: "receipt-" + mocks.submit.mock.calls.length }));
  let job = { id: "five-targets", project_id: project.id, user_id: project.user_id, processor: "local", kind: "extract",
    model: "google/nano-banana-2.1/edit", status: "saving", request_id: "primary", created_at: new Date().toISOString(),
    input: { image_url: project.source_url, _desaynclaw: { autoSeparation: true, whiteElements: true, guidedCutout: first, additionalTargets } } };
  mocks.from.mockImplementation(() => {
    const save = query(null);
    save.maybeSingle.mockImplementation(async () => {
      job = { ...job, ...save.update.mock.calls[0][0] };
      return { data: job };
    });
    return save;
  });
  job = await settleOperation(project, job);
  expect(mocks.submit).toHaveBeenCalledTimes(3);
  job = await settleOperation(project, job);
  expect(mocks.submit).toHaveBeenCalledTimes(4);
  job = await settleOperation(project, job);
  expect(job).toMatchObject({ status: "saving", result: { whiteOutput: { nextIndex: 3 } } });
  mocks.result.mockRejectedValueOnce(Object.assign(new Error("Temporary outage"), { status: 503 }));
  await expect(settleOperation(project, job)).rejects.toMatchObject({ status: 503 });
  job = await settleOperation(project, job);
  expect(job.status).toBe("ready");
  expect(job.result.layers.map(layer => layer.name)).toEqual(names);
  expect(job.result.missing).toEqual([]);
  expect(job.result.whiteOutput).toBeUndefined();
  expect(mocks.submit).toHaveBeenCalledTimes(4);
  expect(mocks.result.mock.calls.map(([, options]) => options.requestId)).toEqual([
    "primary", "receipt-1", "receipt-2", "receipt-3", "receipt-3", "receipt-4",
  ]);
});

it("reviews a broad production detection and replaces it with the independent side artwork", async () => {
  const ornament = { name: "Center ornament", box_2d: [200, 470, 920, 530] };
  const sides = { name: "Gold and green swirls", box_2d: [0, 0, 1000, 1000] };
  const left = { name: "Left side artwork", box_2d: [0, 0, 1000, 420] };
  const right = { name: "Right side artwork", box_2d: [0, 580, 1000, 1000] };
  const reply = elements => Response.json({ output: JSON.stringify({ multipart: true, elements }) });
  const vision = vi.fn().mockResolvedValueOnce(reply([ornament, sides])).mockResolvedValueOnce(reply([left, right, ornament]));
  vi.stubGlobal("fetch", vision);
  const targets = await findAutomaticTargets({ bytes: Buffer.from("preview") }, { width: 300, height: 400 }, false, true);
  expect(targets.map(target => target.name)).toEqual([left.name, right.name, ornament.name]);
  expect(JSON.parse(vision.mock.calls[1][1].body).prompt).toContain("Inspect the left and right halves independently");
  expect(JSON.parse(vision.mock.calls[0][1].body).prompt).toContain("up to 31");
  const singleVision = vi.fn().mockImplementation(async () => reply([{ name: "Complete wordmark", box_2d: [240, 240, 760, 760] }]));
  vi.stubGlobal("fetch", singleVision);
  const single = await findAutomaticTargets({ bytes: Buffer.from("preview") }, { width: 300, height: 400 }, false, true);
  expect(single.map(target => target.name)).toEqual(["Complete wordmark"]);
  expect(singleVision).toHaveBeenCalledTimes(2);
});

it.each([
  { sideFails: false, fillFails: false },
  { sideFails: true, fillFails: false },
  { sideFails: true, fillFails: true },
  { sideFails: false, fillFails: false, flat: true },
])("checkpoints print layers and saves the backdrop ($sideFails, $fillFails, $flat)", async ({ sideFails, fillFails, flat }) => {
  vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("VERCEL", "");
  const asset = (body, width = 100, height = 100) => sharp(Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${body}</svg>`,
  )).png().toBuffer();
  const texture = '<defs><linearGradient id="base"><stop stop-color="#101010"/><stop offset="1" stop-color="#535353"/></linearGradient></defs>';
  const source = await asset((flat ? "" : texture) +
    `<rect width="100" height="100" fill="${flat ? "#101010" : "url(#base)"}"/><rect x="0" y="18" width="22" height="50" fill="#db9c32"/><rect x="78" y="18" width="22" height="50" fill="#17674b"/><rect x="47" y="31" width="6" height="34" fill="#db9c32"/>`);
  const sourceUrl = "r2-private://design-extract/users/admin-1/design-extract/project-1/source.png";
  const assets = new Map([[sourceUrl, source]]);
  mocks.privateRead.mockImplementation(async url => assets.get(url));
  mocks.upload.mockImplementation(async (bytes, key) => {
    const url = "r2-private://design-extract/" + key;
    assets.set(url, bytes);
    return url;
  });
  const element = (name, left, width, inkLeft, inkWidth, top, height) => ({
    name, box: { left, top: top - 5, width, height: height + 10 }, tightBox: { left: inkLeft, top, width: inkWidth, height },
  });
  const definitions = [
    element("Left side", 0, 28, 0, 22, 18, 50),
    element("Right side", 72, 28, 78, 22, 18, 50),
    element("Center ornament", 42, 16, 47, 6, 31, 34),
  ];
  const targets = [];
  for (const [index, target] of definitions.entries()) {
    const prepared = await prepareAutomaticMask(source, target, "users/admin-1/design-extract/input-" + index, mocks.upload);
    targets.push(prepared.target);
    const { preview, box, tightBox } = prepared.target;
    const pad = preview.padding;
    assets.set(`https://test.fal.media/region-${index}.png`, await asset(
      index === 1 && sideFails ? `<rect width="100%" height="100%" fill="#fff"/>`
        : `<rect x="${tightBox.left - box.left + pad.left}" y="${tightBox.top - box.top + pad.top}" width="${tightBox.width}" height="${tightBox.height}" fill="#fff"/>`,
      preview.width + pad.left + pad.right, preview.height + pad.top + pad.bottom,
    ));
  }
  let job = {
    id: "production-job", project_id: project.id, user_id: project.user_id, processor: "local", kind: "extract", status: "saving",
    model: "bria/guided-remove-background", request_id: "region-0", created_at: new Date().toISOString(),
    input: { image_url: sourceUrl, _desaynclaw: { autoSeparation: true, productionLayers: true, guidedCutout: targets[0], additionalTargets: targets.slice(1) } },
    result: { cutoutBatch: { stage: "queued", masks: targets.slice(1).map((target, index) => ({ target, requestId: "region-" + (index + 1) })), missing: [] } },
  };
  mocks.from.mockImplementation(() => {
    const save = query(null);
    save.maybeSingle.mockImplementation(async () => ({ data: { ...job, ...save.update.mock.calls[0][0] } }));
    return save;
  });
  mocks.status.mockResolvedValue({ status: "COMPLETED" });
  mocks.submit.mockImplementation(async model => ({ request_id: model === job.model ? "region-retry" : "background-fill" }));
  mocks.result.mockImplementation(async (_model, { requestId }) => {
    if (fillFails && requestId === "background-fill") throw Object.assign(new Error("No fill"), { status: 422 });
    return { data: { image: { url: `https://test.fal.media/${requestId}.png` } } };
  });
  mocks.fetch.mockImplementation(async url => ({ buffer: assets.get(url) }));
  job = await settleOperation(project, job);
  expect(job.result.productionOutput.nextIndex).toBe(1);
  expect(job.result.layers).toMatchObject([{ name: "Left side", composition: { x: 0, y: 18, scale: 1 } }]);
  const left = job.result.layers[0];
  const { data } = await sharp(assets.get(left.url)).raw().toBuffer({ resolveWithObject: true });
  expect([...data.subarray(0, 4)]).toEqual([219, 156, 50, 255]);
  job = await settleOperation(project, job);
  if (sideFails) {
    expect(job.result.productionOutput.retry).toMatchObject({ stage: "queued", requestId: "region-retry" });
    assets.set("https://test.fal.media/region-retry.png", await asset('<rect width="100%" height="100%" fill="#fff"/>', 30, 30));
    job = await settleOperation(project, JSON.parse(JSON.stringify(job)));
    expect(job.result.missing).toEqual(["Right side"]);
  }
  job = await settleOperation(project, job);
  expect(job.result.backgroundFill.stage).toBe("preparing");
  job = await settleOperation(project, job);
  if (!flat) {
    const { width, height } = job.result.backgroundFill.preview;
    assets.set("https://test.fal.media/background-fill.png", await asset('<rect width="100%" height="100%" fill="#101010"/>', width, height));
    job = await settleOperation(project, job);
    job = await settleOperation(project, job);
  }
  expect(job.status).toBe("ready");
  if (fillFails) {
    expect(job.result.layers.map(layer => layer.name)).toEqual(["Left side", "Center ornament"]);
    expect(job.result.warnings.join(" ")).toContain("background fill could not be saved");
    expect(mocks.submit).toHaveBeenCalledTimes(2);
  } else {
    expect(job.result.layers.map(layer => layer.name)).toEqual(
      ["Background · Filled", "Left side", ...(sideFails ? [] : ["Right side"]), "Center ornament"],
    );
    expect(Boolean(job.result.layers[0].needsReview)).toBe(sideFails);
    const background = await sharp(assets.get(job.result.layers[0].url)).raw().toBuffer();
    expect([...background.subarray((30 * 100 + 5) * 4, (30 * 100 + 5) * 4 + 4)]).toEqual([16, 16, 16, 255]);
    expect([...background.subarray(0, 4)]).toEqual([16, 16, 16, 255]);
    expect(mocks.submit).toHaveBeenCalledTimes(flat ? 0 : sideFails ? 2 : 1);
  }
});

it("opens saved refinement projects without offering another paid refinement when disabled", async () => {
  vi.stubEnv("DESIGN_REFINED_ENABLED", "false");
  const saved = { ...project, manifest: { ...project.manifest, workspaceMode: "refine", layers: [{ id: "saved-option" }] } };
  const completed = { id: "refined-job", kind: "refine", status: "accepted" };
  mocks.from.mockReturnValueOnce(query([completed])).mockReturnValueOnce(query({ credits: 4 }));
  const result = await snapshot(saved);
  expect(result.project.manifest.layers).toEqual([{ id: "saved-option" }]);
  expect(result.job).toEqual(completed);
  expect(result.billing.prices).not.toHaveProperty("refine");
  await expect(startOperation(saved, { kind: "refine", idempotencyKey: "old-refinement" })).rejects.toThrow("Design Refined is unavailable");
  expect(mocks.submit).not.toHaveBeenCalled();
});

it("keeps separated tall panels in full-height Nano Banana columns", async () => {
  const image = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="420"><rect width="240" height="420" fill="#141414"/><path fill="#d99b37" d="M0 0H91L56 420H0Z M150 0H240V420H185Z"/><path d="M120 60V360" stroke="#198566" stroke-width="6"/></svg>')).png().toBuffer();
  expect(await sharp(await nanoColumnGuide(image)).metadata()).toMatchObject({ width: 1536, height: 1536 });
  const sheet = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="300" height="300" fill="#fff"/><path fill="#9c7645" d="M8 0H70V300H8Z M230 0H290V300H230Z"/><path d="M150 20V280" stroke="#23594f" stroke-width="5"/></svg>')).png().toBuffer();
  const { elements, clipped } = await splitNanoElements(sheet, "columns");
  expect(elements.map(({ slot, height }) => [slot, height])).toEqual([[1, 300], [2, 278], [3, 300]]);
  expect(clipped).toBe(0);
});

it("uses the nearby white gutter when a Nano Banana tile drifts across the nominal grid", async () => {
  const sheet = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="300" height="300" fill="#fff"/><rect x="10" y="20" width="93" height="45" fill="#136847"/><circle cx="158" cy="45" r="24" fill="#253856"/><path d="M215 170L258 111L275 160Z" fill="#f9ad24"/></svg>')).png().toBuffer();
  const { elements, clipped } = await splitNanoElements(sheet);
  expect(elements.map(({ slot }) => slot)).toEqual([1, 2, 6]);
  expect(clipped).toBe(0);
  const pixels = await sharp(elements[0].bytes).raw().toBuffer();
  let green = 0;
  for (let i = 0; i < pixels.length; i += 3) if (pixels[i] === 19 && pixels[i + 1] === 104 && pixels[i + 2] === 71) green++;
  expect(green).toBe(93 * 45);
});

it("keeps the reserved background as a full rectangle and treats other assets as graphics", async () => {
  const sheet = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="300" height="300" fill="#fff"/><circle cx="50" cy="50" r="24" fill="#bc7f23"/><rect x="222" y="211" width="56" height="78" fill="#185789"/></svg>')).png().toBuffer();
  const { elements, clipped } = await splitNanoElements(sheet, "grid", 56 / 78);
  expect(elements).toMatchObject([{ slot: 1 }, { slot: 9, background: true, width: 56, height: 78 }]);
  expect(elements[0]).not.toHaveProperty("background");
  expect(clipped).toBe(0);
  expect([...(await sharp(elements[1].bytes).raw().toBuffer()).subarray(0, 3)]).toEqual([24, 87, 137]);
});

it("recovers complete subjects and the background when readable white gaps do not form a fixed grid", async () => {
  const sheet = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="300" height="300" fill="#fff"/><path fill="#32688f" d="M10 12H78L95 110H15Z"/><rect x="113" y="20" width="69" height="55" fill="#e2aa30"/><path fill="#207ca7" d="M10 272C30 211 95 197 157 265L144 282H16Z"/><rect x="211" y="146" width="89" height="154" fill="#12658a"/></svg>')).png().toBuffer();
  const { elements, clipped } = await splitNanoElements(sheet, "grid", 89 / 154);
  expect(elements.filter(item => !item.background)).toHaveLength(3);
  expect(elements.find(item => item.background)).toMatchObject({ width: 89, height: 154 });
  expect(clipped).toBe(0);
});

it("reserves and submits a refinement batch once when its request key is retried", async () => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("DESIGN_REFINED_ENABLED", "true");
  const sourceUrl = "r2-private://design-extract/users/admin-1/design-extract/project-1/source.png";
  const refined = { ...project, source_url: sourceUrl, manifest: { ...project.manifest, workspaceMode: "refine" } };
  const model = "google/nano-banana-2.1/edit";
  const job = { id: "refine-job", project_id: project.id, user_id: project.user_id, base_revision: 0,
    kind: "refine", model, processor: "local", status: "submitting", billing_state: "held", charge_amount: 2, input: { image_url: sourceUrl } };
  const queued = { ...job, status: "queued", request_id: "existing-fal-request" };
  mocks.privateRead.mockResolvedValue((await mocks.fetch()).buffer);
  mocks.rpc.mockResolvedValueOnce({ data: true }).mockResolvedValueOnce({ data: { status: "charged", job, credits_remaining: 8 } }).mockResolvedValueOnce({ data: true });
  mocks.from.mockReturnValueOnce(query(null)).mockReturnValueOnce(query(job)).mockReturnValueOnce(query(queued)).mockReturnValueOnce(query(queued));
  mocks.submit.mockResolvedValueOnce({ request_id: queued.request_id });
  const body = { kind: "refine", idempotencyKey: "refine-once", revision: 0, acknowledgedClaws: 2, priceVersion: "design-extract-v1" };
  await expect(startOperation(refined, body)).resolves.toMatchObject({ request_id: queued.request_id, creditsRemaining: 8 });
  await expect(startOperation(refined, body)).resolves.toMatchObject({ request_id: queued.request_id });
  expect(mocks.rpc.mock.calls.filter(([name]) => name === "claim_design_extract_v2")).toHaveLength(1);
  expect(mocks.submit).toHaveBeenCalledExactlyOnceWith(model, { input: expect.objectContaining({ num_images: 3, resolution: "1K", thinking_level: "minimal" }) });
});

describe("Design Extract admin gate", () => {
  it("confirms picker availability independently of the project list and still requires admin access", async () => {
    const request = new Request("http://localhost/api/design-extract?scope=access", { headers: { Authorization: "Bearer test-token" } });
    const confirmed = await GET(request);
    expect(confirmed.status).toBe(200);
    expect(await confirmed.json()).toEqual({ enabled: true });
    expect(confirmed.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.from).not.toHaveBeenCalled();

    mocks.getUser.mockResolvedValue({ data: { user: { id: "other", email: "other@test.com" } } });
    expect((await GET(request)).status).toBe(403);
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("never exposes untrusted upstream error messages or credentials", async () => {
    const response = designError(Object.assign(new Error("Provider rejected Key secret-token at https://private.test/image.png"), { status: 403 }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Design Extract request failed. Please retry." });
  });
  it("returns manager cards with thumbnails, names, and the correct workspace type", async () => {
    mocks.from.mockReturnValue(query([{ id: "layers-1", created_at: "2026-11-17", source_url: "https://r2.test/artwork.png", manifest: { name: "Jersey elements", layers: [] } }]));
    const response = await GET(jsonRequest({}));
    expect(response.status).toBe(200);
    expect((await response.json()).projects).toEqual([{ id: "layers-1", created_at: "2026-11-17", original_image_url: "https://r2.test/artwork.png", name: "Jersey elements", trace_type: "design_extract" }]);
  });
  it("reports unavailable auth service instead of incorrectly signing the user out", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: { name: "AuthRetryableFetchError", status: 0 } });
    const response = await GET(jsonRequest({}));
    expect(response.status).toBe(503);
    expect((await response.json()).error).toContain("Cannot reach the sign-in service");
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("requires sign-in and lets a regular account access only its own projects", async () => {
    expect((await GET(jsonRequest({}, { token: null }))).status).toBe(401);
    vi.stubEnv("DESIGN_EXTRACT_BILLING_MODE", "paid");
    mocks.getUser.mockResolvedValue({ data: { user: { id: "other", email: "other@test.com" } } });
    const list = query([]);
    mocks.from.mockReturnValueOnce(list).mockReturnValueOnce(query(null));
    expect(await (await GET(jsonRequest({}))).json()).toMatchObject({ enabled: true, projects: [] });
    expect(list.eq).toHaveBeenCalledWith("user_id", "other");
    expect((await getDocument(jsonRequest({}), { params: { id: project.id } })).status).toBe(404);
  });
  it("keeps manual provider reconciliation admin-only", async () => {
    vi.stubEnv("DESIGN_EXTRACT_BILLING_MODE", "paid");
    mocks.getUser.mockResolvedValue({ data: { user: { id: project.user_id, email: "member@test.com" } } });
    mocks.from.mockReturnValueOnce(query(project));
    const response = await postDocument(jsonRequest({ action: "reconcile", jobId: "job-1", requestId: "other-request" }), { params: { id: project.id } });
    expect(response.status).toBe(403);
    expect(mocks.status).not.toHaveBeenCalled();
  });
  it("fails closed when the flag is off or production billing is free", async () => {
    vi.stubEnv("DESIGN_EXTRACT_ENABLED", "false"); expect((await GET(jsonRequest({}))).status).toBe(404);
    expect((await POST(jsonRequest({ imageUrl: "https://r2.test/users/admin-1/source.png" }))).status).toBe(404);
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
    vi.stubEnv("DESIGN_EXTRACT_ENABLED", "true");
    vi.stubEnv("VERCEL_ENV", "production");
    expect((await GET(jsonRequest({}))).status).toBe(503);
  });
  it("checks project ownership and expiry", async () => {
    const q = query(null); mocks.from.mockReturnValue(q);
    await expect(ownedProject("other-project", "admin-1")).rejects.toMatchObject({ status: 404 });
    expect(q.eq).toHaveBeenCalledWith("user_id", "admin-1");
    mocks.from.mockReturnValue(query({ ...project, expires_at: "2000-01-01" }));
    await expect(ownedProject(project.id, project.user_id)).rejects.toMatchObject({ status: 404 });
  });
  it("rejects unauthorized sources and corrupt files before creating projects", async () => {
    await expect(createProject("admin-1", "https://evil.test/image.png")).rejects.toMatchObject({ status: 400 });
    expect(mocks.fetch).not.toHaveBeenCalled();
    mocks.fetch.mockResolvedValue({ buffer: Buffer.from("not an image") });
    await expect(createProject("admin-1", project.source_url)).rejects.toThrow();
    expect(mocks.upload).not.toHaveBeenCalled();
  });
});

it("previews and saves disconnected same-color artwork as one native layer without an AI request", async () => {
  const width = 6, height = 3;
  const pixels = Buffer.alloc(width * height * 4);
  for (let offset = 0; offset < pixels.length; offset += 4) pixels.set([12, 54, 80, 255], offset);
  for (const x of [0, 1, 4]) pixels.set([210, 140, 70, 196], (width + x) * 4);
  mocks.fetch.mockResolvedValue({ buffer: await sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer() });
  const current = { ...project, manifest: { ...project.manifest, width, height } };
  const body = { revision: 0, selectionBox: { left: 1, top: 0, right: 5, bottom: 2 }, points: [{ x: 1, y: 1, label: 1 }], tolerance: 0 };
  const context = { params: { id: project.id } };
  mocks.from.mockReturnValueOnce(query(current)).mockReturnValueOnce(query([]));
  const preview = await patchDocument(jsonRequest({ ...body, action: "color-preview" }), context);
  expect(preview.status).toBe(200);
  expect(preview.headers.get("cache-control")).toBe("private, no-store");
  const previewPixels = await sharp(Buffer.from(await preview.arrayBuffer())).raw().toBuffer();
  expect([...previewPixels]).toEqual([210, 140, 70, 196, 12, 54, 80, 0, 12, 54, 80, 0, 210, 140, 70, 196]);
  expect(mocks.upload).not.toHaveBeenCalled();

  const mutation = query({ ...current, revision: 1 });
  mocks.from.mockReturnValueOnce(query(current)).mockReturnValueOnce(query([])).mockReturnValueOnce(mutation);
  const saved = await patchDocument(jsonRequest({ ...body, action: "color-cutout" }), context);
  expect(saved.status).toBe(200);
  expect(mutation.eq).toHaveBeenCalledWith("revision", 0);
  expect(mutation.update.mock.calls[0][0].manifest.layers).toMatchObject([{ width: 4, height: 1, composition: { x: 1, y: 1, scale: 1 }, nativeFrame: { width, height, left: 1, top: 1 }, maskSourceUrl: current.source_url }]);
  expect(await sharp(mocks.upload.mock.calls[0][0]).raw().toBuffer()).toEqual(previewPixels);
  expect(mocks.rpc).not.toHaveBeenCalled();
  expect(mocks.submit).not.toHaveBeenCalled();
});
describe("durable operations", () => {
  it.each([["automatic-white", false], ["automatic", false], ["review", false], ["automatic-white", true]])("submits only Nano Banana for %s (production: %s)", async (extractionMode, production) => {
    vi.stubEnv("NODE_ENV", production ? "production" : "development");
    vi.stubEnv("VERCEL", production ? "1" : "");
    vi.stubEnv("VERCEL_ENV", production ? "production" : "");
    vi.stubEnv("DESIGN_EXTRACT_QUALITY_PILOT", production ? "false" : "true");
    if (production) {
      vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://redis.test"); vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "test");
      mocks.getUser.mockResolvedValue({ data: { user: { id: project.user_id, email: "member@test.com" } } });
    }
    vi.stubEnv("DESIGN_EXTRACT_PROCESSOR", "legacy"); vi.stubEnv("DESIGN_EXTRACT_BILLING_MODE", "paid");
    const source = "r2-private://design-extract/users/admin-1/design-extract/project-1/source.png";
    const job = { id: "auto", kind: "extract", status: "submitting", model: "fal-ai/sam2/auto-segment", user_id: project.user_id, project_id: project.id,
      input: { image_url: source, _desaynclaw: { autoSeparation: true, whiteElements: true, nanoElements: true } } };
    const prepare = query({ ...job, model: "google/nano-banana-2.1/edit" });
    mocks.from.mockReturnValueOnce(query({ ...project, source_url: source })).mockReturnValueOnce(query(null))
      .mockReturnValueOnce(query(job)).mockReturnValueOnce(prepare).mockReturnValueOnce(query({ ...job, status: "queued" }));
    mocks.rpc.mockResolvedValueOnce({ data: { status: "charged", job, credits_remaining: 3 } });
    mocks.privateRead.mockResolvedValueOnce(await sharp({ create: { width: 100, height: 100, channels: 4, background: "#456789" } }).png().toBuffer());
    const directFetch = vi.fn();
    vi.stubGlobal("fetch", directFetch);
    mocks.submit.mockResolvedValueOnce({ request_id: "first-cutout-receipt" });
    const response = await postDocument(jsonRequest({ kind: "extract", extractionMode, idempotencyKey: "nano-auto-request",
      priceVersion: "design-extract-v1", acknowledgedClaws: 2 }), { params: { id: project.id } });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ job: { status: "queued", creditsRemaining: 3, automaticSeparation: true } });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith(production ? "claim_design_extract" : "claim_design_extract_v2", expect.objectContaining({
      operation_kind: "extract", ...(production ? {} : { operation_processor: "local" }),
    }));
    expect(directFetch).not.toHaveBeenCalled();
    expect(prepare.update.mock.calls[0][0]).toMatchObject({ model: "google/nano-banana-2.1/edit" });
    expect(mocks.submit).toHaveBeenCalledExactlyOnceWith("google/nano-banana-2.1/edit", { input: expect.objectContaining({
      image_urls: ["https://private-signed.test/source.png"], prompt: expect.stringContaining("solid pure white #FFFFFF"), num_images: 1, resolution: "4K",
    }) });
  });

  it("saves independent white-background graphics and omits tiles crossed by other artwork", async () => {
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("VERCEL", "");
    const job = { id: "nano-sheet", processor: "local", project_id: project.id, user_id: project.user_id,
      model: "google/nano-banana-2.1/edit", kind: "extract", status: "saving", request_id: "recorded-nano-receipt",
      created_at: new Date().toISOString(), input: { _desaynclaw: { autoSeparation: true, nanoElements: true, whiteElements: true } } };
    const atlas = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="300" height="300" fill="#fafafa"/><rect x="20" y="24" width="20" height="38" fill="#2d7550"/><rect x="45" y="24" width="18" height="38" fill="#2d7550"/><circle cx="150" cy="45" r="26" fill="#942e3f"/><rect x="180" y="120" width="45" height="50" fill="#111"/></svg>')).png().toBuffer();
    mocks.status.mockResolvedValue({ status: "COMPLETED" });
    mocks.result.mockResolvedValue({ data: { images: [{ url: "https://test.fal.media/sheet.png" }] } });
    mocks.fetch.mockResolvedValue({ buffer: atlas });
    const saved = query(null);
    saved.maybeSingle.mockImplementation(async () => ({ data: { ...job, ...saved.update.mock.calls[0][0] } }));
    mocks.from.mockReturnValueOnce(saved);
    const ready = await settleOperation(project, job);
    expect(ready.result.layers.map(layer => layer.name)).toEqual(["Graphic 1", "Graphic 2"]);
    expect(ready.result.warnings.join(" ")).toContain("overlapped");
    expect(mocks.result).toHaveBeenCalledExactlyOnceWith(job.model, { requestId: job.request_id });
    expect(mocks.submit).not.toHaveBeenCalled();
    const first = sharp(mocks.upload.mock.calls[0][0]);
    expect(await first.metadata()).toMatchObject({ hasAlpha: false, width: 55, height: 50 });
    expect([...(await first.raw().toBuffer()).subarray(0, 3)]).toEqual([255, 255, 255]);
  });
  it("collects whole cutouts once and fills their union before exposing the replacement for review", async () => {
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("VERCEL", ""); vi.stubEnv("DESIGN_EXTRACT_QUALITY_PILOT", "true");
    vi.stubEnv("DESIGN_EXTRACT_PROCESSOR", "legacy");
    const sourceUrl = "r2-private://design-extract/users/admin-1/design-extract/project-1/source.png";
    const first = { name: "Whole wordmark", box: { left: 4, top: 5, width: 30, height: 20 }, preview: { width: 30, height: 20 } };
    const second = { name: "Emblem", box: { left: 58, top: 53, width: 30, height: 20 }, preview: { width: 30, height: 20 } };
    const job = { id: "automatic-batch", processor: "local", model: "bria/guided-remove-background", kind: "extract", status: "saving", request_id: "first-cutout",
      project_id: project.id, user_id: project.user_id, base_revision: 0,
      input: { image_url: sourceUrl, _desaynclaw: { autoSeparation: true, guidedCutout: first, additionalTargets: [second] } } };
    const source = await sharp({ create: { width: 100, height: 100, channels: 4, background: "#456789" } }).png().toBuffer();
    const assets = new Map([[sourceUrl, source]]);
    mocks.privateRead.mockImplementation(async url => assets.get(url));
    mocks.upload.mockImplementation(async (bytes, key) => {
      const url = "r2-private://design-extract/" + key;
      assets.set(url, bytes);
      return url;
    });
    const claim = query(job), receipt = query(job), saveCutouts = query(job), initFill = query(job), fillClaim = query(job), fillReceipt = query(job), finish = query(job);
    const next = q => q.maybeSingle.mockImplementation(async () => ({ data: { ...job, ...q.update.mock.calls[0][0] } }));
    for (const stage of [claim, receipt, saveCutouts, initFill, fillClaim, fillReceipt, finish]) next(stage);
    mocks.from.mockReturnValueOnce(claim).mockReturnValueOnce(receipt).mockReturnValueOnce(query(null)).mockReturnValueOnce(saveCutouts).mockReturnValueOnce(initFill)
      .mockReturnValueOnce(fillClaim).mockReturnValueOnce(fillReceipt).mockReturnValueOnce(finish);
    mocks.status.mockResolvedValue({ status: "COMPLETED" });
    mocks.submit.mockResolvedValueOnce({ request_id: "second-cutout" }).mockResolvedValueOnce({ request_id: "background-fill" });
    const maskSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="30" height="20"><rect x="4" y="5" width="7" height="10"/><rect x="13" y="5" width="7" height="10"/></svg>');
    const mask = await sharp(maskSvg).png().toBuffer();
    mocks.fetch.mockResolvedValue({ buffer: mask });
    mocks.result.mockResolvedValue({ data: { image: { url: "https://test.fal.media/cutout.png" } } });
    const queued = await settleOperation(project, job);
    expect(queued.result.cutoutBatch).toMatchObject({ stage: "queued", masks: [{ requestId: "second-cutout" }] });
    expect(await settleOperation(project, job)).toEqual(job);
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    const savedCutouts = await settleOperation(project, queued);
    expect(savedCutouts.result.layers.map(layer => layer.name)).toEqual(["Whole wordmark", "Emblem"]);
    expect(savedCutouts.result.backgroundFill).toEqual({ stage: "preparing" });
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    expect(saveCutouts.eq).toHaveBeenCalledWith("result->cutoutBatch->>stage", "queued");
    expect(savedCutouts.result.replaceExtraction).toBe(true);
    const [wordmark] = savedCutouts.result.layers;
    const pixels = await sharp(assets.get(wordmark.url)).raw().toBuffer();
    expect([...pixels.subarray(0, 4)]).toEqual([69, 103, 137, 255]);
    expect(pixels[7 * 4 + 3]).toBe(0);
    const filledPending = await settleOperation(project, savedCutouts);
    expect(initFill.eq).toHaveBeenCalledWith("result->backgroundFill->>stage", "preparing");
    const filling = await settleOperation(project, filledPending);
    const { box, preview } = filling.result.backgroundFill;
    const inpaint = await sharp({ create: { width: preview.width, height: preview.height, channels: 3, background: "#123456" } }).png().toBuffer();
    mocks.fetch.mockResolvedValue({ buffer: inpaint });
    const ready = await settleOperation(project, {
      ...filling, result: { ...filling.result, backgroundFill: { ...filling.result.backgroundFill, startedAt: Date.now() - 6 * 60_000 } },
    });
    const background = ready.result.layers.find(layer => layer.filledGuidedBackground);
    expect(ready.status).toBe("ready");
    const composite = await sharp(assets.get(background.url)).raw().toBuffer();
    for (const { x, y } of [{ x: 10, y: 12 }, { x: 64, y: 60 }]) expect([...composite.subarray((y * 100 + x) * 4, (y * 100 + x) * 4 + 4)]).toEqual([18, 52, 86, 255]);
    expect([...composite.subarray(99 * 100 * 4, 99 * 100 * 4 + 4)]).toEqual([69, 103, 137, 255]);
    expect(box.width).toBeGreaterThan(70);
    expect(mocks.submit.mock.calls.map(([model]) => model)).toEqual(["bria/guided-remove-background", "fal-ai/ideogram/object-removal"]);
    const existing = { ...project, manifest: { ...project.manifest, layers: [{ ...wordmark, id: "old-layer" }] } };
    mocks.from.mockReturnValueOnce(query(ready));
    mocks.rpc.mockResolvedValueOnce({ data: {} });
    await reviewOperation(existing, ready.id, true);
    expect(mocks.rpc).toHaveBeenLastCalledWith("review_design_extract", expect.objectContaining({
      expected_revision: 0, accepted: true,
      next_manifest: expect.objectContaining({ layers: [
        expect.objectContaining({ id: background.id }), expect.objectContaining({ name: "Whole wordmark" }), expect.objectContaining({ name: "Emblem" }),
      ] }),
    }));
    const interrupted = { ...filling, status: "failed", error: "Provider returned no usable layers", billing_state: "held" };
    const newer = { ...interrupted, id: "newer", result: null, billing_state: "refunded" };
    const lookup = query(interrupted);
    mocks.from.mockReturnValueOnce(query([newer])).mockReturnValueOnce(lookup).mockReturnValueOnce(query({ credits: 3 }));
    expect((await snapshot(project)).job).toMatchObject({ id: newer.id, recordedBackgroundJobId: interrupted.id });
    expect(lookup.eq).toHaveBeenCalledWith("base_revision", 0);
    const finishRecovery = query({ ...ready, billing_state: "held" });
    mocks.from.mockReturnValueOnce(query(interrupted)).mockReturnValueOnce(finishRecovery)
      .mockReturnValueOnce(query(project)).mockReturnValueOnce(query(ready));
    mocks.rpc.mockResolvedValueOnce({ data: {} }).mockResolvedValueOnce({ data: { status: "settled" } });
    expect(await recoverOperation(project, interrupted.id)).toMatchObject({ status: "accepted", billing_state: "settled" });
    expect(finishRecovery.eq).toHaveBeenCalledWith("status", "failed");
    expect(finishRecovery.update).toHaveBeenCalledWith(expect.objectContaining({ status: "ready", error: null }));
    expect(mocks.status).toHaveBeenLastCalledWith("fal-ai/ideogram/object-removal", { requestId: "background-fill", logs: false });
    expect(mocks.submit).toHaveBeenCalledTimes(2);

    const missingMigration = () => query(null, { code: "23514", message: 'violates check constraint "design_extract_jobs_processor_check"' });
    const legacyFill = { ...interrupted, processor: "legacy" };
    const restoreLegacyFill = query(null);
    const savedLegacyFill = () => ({ ...legacyFill, ...restoreLegacyFill.update.mock.calls[0][0] });
    restoreLegacyFill.maybeSingle.mockImplementation(async () => ({ data: savedLegacyFill() }));
    const reviewLegacyFill = query(null);
    reviewLegacyFill.single.mockImplementation(async () => ({ data: savedLegacyFill() }));
    mocks.from.mockReturnValueOnce(query(legacyFill)).mockReturnValueOnce(missingMigration())
      .mockReturnValueOnce(restoreLegacyFill).mockReturnValueOnce(query(project)).mockReturnValueOnce(reviewLegacyFill);
    mocks.rpc.mockResolvedValueOnce({ data: {} }).mockResolvedValueOnce({ data: { status: "settled" } });
    await expect(recoverOperation(project, legacyFill.id)).resolves.toMatchObject({
      status: "accepted", billing_state: "settled",
      result: { layers: [{ name: "Background · Filled" }, { name: "Whole wordmark" }, { name: "Emblem" }] },
    });
    expect(restoreLegacyFill.update.mock.calls[0][0]).not.toHaveProperty("processor");
    expect(mocks.submit).toHaveBeenCalledTimes(2);

    const cutoutsOnly = { ...queued, status: "failed", error: "Provider returned no usable layers", billing_state: "refunded" };
    const isolated = query(cutoutsOnly);
    isolated.maybeSingle.mockImplementation(async () => ({ data: { ...cutoutsOnly, ...isolated.update.mock.calls[0][0] } }));
    mocks.fetch.mockResolvedValue({ buffer: mask });
    mocks.from.mockReturnValueOnce(query(cutoutsOnly)).mockReturnValueOnce(isolated);
    mocks.rpc.mockResolvedValueOnce({ data: { status: "refunded" } });
    await expect(recoverOperation(project, cutoutsOnly.id)).resolves.toMatchObject({
      status: "ready", processor: "local", billing_state: "refunded",
      result: { layers: [{ name: "Whole wordmark" }, { name: "Emblem" }], warnings: [expect.stringContaining("A filled background was never saved")] },
    });
    const legacy = { ...cutoutsOnly, processor: "legacy" };
    const restoreLegacy = query(legacy);
    const restored = () => ({ ...legacy, ...restoreLegacy.update.mock.calls[0][0] });
    restoreLegacy.maybeSingle.mockImplementation(async () => ({ data: restored() }));
    const reviewLegacy = query(null);
    reviewLegacy.single.mockImplementation(async () => ({ data: restored() }));
    mocks.from.mockReturnValueOnce(query(legacy)).mockReturnValueOnce(missingMigration())
      .mockReturnValueOnce(query(project)).mockReturnValueOnce(restoreLegacy)
      .mockReturnValueOnce(query(project)).mockReturnValueOnce(reviewLegacy);
    mocks.rpc.mockResolvedValueOnce({ data: {} }).mockResolvedValueOnce({ data: { status: "refunded" } });
    await expect(recoverOperation(project, legacy.id)).resolves.toMatchObject({ status: "accepted", billing_state: "refunded" });
    expect(restoreLegacy.update).toHaveBeenCalledWith(expect.objectContaining({ status: "ready" }));
    expect(restoreLegacy.update.mock.calls[0][0]).not.toHaveProperty("processor");
    expect(mocks.rpc).toHaveBeenCalledWith("review_design_extract", expect.objectContaining({
      expected_revision: 0, accepted: true,
      next_manifest: expect.objectContaining({ layers: [expect.objectContaining({ name: "Whole wordmark" }), expect.objectContaining({ name: "Emblem" })] }),
    }));
    const withArtwork = { ...project, manifest: { ...project.manifest, layers: restored().result.layers } };
    mocks.from.mockReturnValueOnce(query(legacy)).mockReturnValueOnce(missingMigration()).mockReturnValueOnce(query(withArtwork));
    await expect(recoverOperation(withArtwork, legacy.id)).rejects.toThrow("project's saved layers");
    expect(mocks.submit).toHaveBeenCalledTimes(2);
  });
  it("prevents hosted sync from advancing isolated local jobs", async () => {
    vi.stubEnv("VERCEL", "1");
    const local = { processor: "local", status: "queued", model: "bria/guided-remove-background", request_id: "saved-request" };
    expect(await settleOperation(project, local)).toEqual(local);
    expect(mocks.status).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("keeps valid local cutouts available for review when the background fill fails", async () => {
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("VERCEL", "");
    const job = { id: "failed-fill", project_id: project.id, processor: "local", status: "saving", request_id: "saved-cutout",
      input: { _desaynclaw: { autoSeparation: true } }, result: { layers: [{ id: "saved" }], backgroundFill: { stage: "queued", requestId: "saved-fill" } } };
    const mutation = query(job);
    mutation.maybeSingle.mockImplementation(async () => ({ data: { ...job, ...mutation.update.mock.calls[0][0] } }));
    mocks.from.mockReturnValueOnce(mutation);
    mocks.status.mockResolvedValueOnce({ status: "COMPLETED" });
    mocks.result.mockResolvedValueOnce({ data: {} });
    const ready = await settleOperation(project, job);
    expect(ready).toMatchObject({ status: "ready", result: { layers: [{ id: "saved" }], warnings: [expect.stringContaining("background fill could not be saved")] } });
    expect(ready.result).not.toHaveProperty("backgroundFill");
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("claims the background fill once and keeps the job in saving until the provider returns", async () => {
    const job = { id: "fill-job", project_id: project.id, user_id: project.user_id, status: "saving", request_id: "original-cutout",
      result: { layers: [{ id: "logo" }], backgroundFill: { stage: "pending", imageUrl: "image", maskUrl: "mask" } } };
    const claimed = { ...job, result: { ...job.result, backgroundFill: { ...job.result.backgroundFill, stage: "submitting", startedAt: Date.now() } } };
    const queued = { ...job, result: { ...job.result, backgroundFill: { ...claimed.result.backgroundFill, stage: "queued", requestId: "fill-receipt" } } };
    const acquire = query(claimed), receipt = query(queued), stale = query(null);
    mocks.from.mockReturnValueOnce(acquire).mockReturnValueOnce(receipt).mockReturnValueOnce(stale).mockReturnValueOnce(query(queued));
    mocks.submit.mockResolvedValueOnce({ request_id: "fill-receipt" });
    expect(await settleOperation(project, job)).toEqual(queued);
    expect(await settleOperation(project, job)).toEqual(queued);
    expect(acquire.eq).toHaveBeenCalledWith("result->backgroundFill->>stage", "pending");
    expect(receipt.eq).toHaveBeenCalledWith("result->backgroundFill->>stage", "submitting");
    expect(mocks.submit).toHaveBeenCalledExactlyOnceWith("fal-ai/ideogram/object-removal", { input: { image_url: "image", mask_url: "mask" } });
  });
  it("clears the unaccepted partial result when a background fill fails so the reservation can be refunded", async () => {
    const job = { id: "fill-job", project_id: project.id, user_id: project.user_id, status: "saving", request_id: "original-cutout", billing_state: "held",
      result: { layers: [{ id: "logo" }], backgroundFill: { stage: "queued", startedAt: Date.now(), requestId: "fill-receipt" } } };
    const bad = query({ ...job, status: "failed", result: null });
    mocks.from.mockReturnValueOnce(bad);
    mocks.status.mockResolvedValueOnce({ status: "COMPLETED" });
    mocks.result.mockResolvedValueOnce({ data: {} });
    mocks.rpc.mockResolvedValueOnce({ data: { status: "refunded" } });
    await expect(settleOperation(project, job)).resolves.toMatchObject({ status: "failed", result: null, billing_state: "refunded" });
    expect(bad.update).toHaveBeenCalledWith(expect.objectContaining({ status: "failed", result: null }));
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("uses the existing one-Claw segment reservation for one private Bria crop", async () => {
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("VERCEL", ""); vi.stubEnv("DESIGN_EXTRACT_QUALITY_PILOT", "true");
    vi.stubEnv("DESIGN_EXTRACT_PROCESSOR", "legacy"); vi.stubEnv("DESIGN_EXTRACT_BILLING_MODE", "paid");
    const source = "r2-private://design-extract/users/admin-1/design-extract/project-1/source.png";
    const settings = { name: "Gold crown", box: { left: 10, top: 12, width: 31, height: 41 } };
    const job = { id: "guide", kind: "segment", model: "fal-ai/sam2/image", user_id: project.user_id, project_id: project.id,
      status: "submitting", input: { image_url: source, _desaynclaw: { guidedCutout: settings } }, billing_state: "held", charge_amount: 1 };
    const checkpoint = query({ ...job, model: "bria/guided-remove-background" });
    mocks.from.mockReturnValueOnce(query(null)).mockReturnValueOnce(query(job)).mockReturnValueOnce(checkpoint).mockReturnValueOnce(query({ ...job, status: "queued" }));
    mocks.rpc.mockResolvedValueOnce({ data: { status: "charged", job, credits_remaining: 3 } });
    mocks.privateRead.mockResolvedValueOnce(await sharp({ create: { width: 100, height: 100, channels: 4, background: "#f1ae77" } }).png().toBuffer());
    mocks.submit.mockResolvedValueOnce({ request_id: "one-guided-receipt" });
    const body = { kind: "segment", extractionMode: "guided", targetName: " Gold crown ", selectionBox: { left: 10, top: 12, right: 40, bottom: 52 },
      idempotencyKey: "guided-request-key", priceVersion: "design-extract-v1", acknowledgedClaws: 1 };
    expect((await startOperation({ ...project, source_url: source }, body)).creditsRemaining).toBe(3);
    expect(mocks.rpc.mock.calls[0][1]).toMatchObject({ operation_kind: "segment", provider_model: "fal-ai/sam2/image" });
    expect(await sharp(mocks.upload.mock.calls[0][0]).metadata()).toMatchObject({ width: 31, height: 41 });
    expect(checkpoint.update.mock.calls[0][0]).toMatchObject({ model: "bria/guided-remove-background",
      input: { image_url: source, _desaynclaw: { guidedCutout: { ...settings, preview: { width: 31, height: 41 } } } } });
    expect(mocks.submit).toHaveBeenCalledExactlyOnceWith("bria/guided-remove-background", { input: {
      image_url: "https://private-signed.test/source.png", prompt: "Keep only Gold crown. Include all parts belonging to that design in the same cutout.", autocrop: false,
    } });
  });
  it("reserves once, records the real SAM model, and sends only the pilot preview and boxes", async () => {
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("VERCEL", ""); vi.stubEnv("DESIGN_EXTRACT_QUALITY_PILOT", "true");
    vi.stubEnv("GEMINI_API_KEY", "mock-key"); vi.stubEnv("DESIGN_EXTRACT_PROCESSOR", "legacy"); vi.stubEnv("DESIGN_EXTRACT_BILLING_MODE", "paid");
    const source = "r2-private://design-extract/users/admin-1/design-extract/project-1/source.png";
    const privateProject = { ...project, source_url: source };
    const originalJob = { id: "pilot", kind: "extract", model: "fal-ai/sam2/auto-segment", user_id: project.user_id, project_id: project.id, status: "submitting",
      input: { image_url: source, _desaynclaw: { qualityPilot: true } }, billing_state: "held", charge_amount: 2 };
    const prepared = { ...originalJob, model: "fal-ai/sam-3-1/image" };
    const claim = query(originalJob), checkpoint = query(prepared);
    mocks.from.mockReturnValueOnce(query(null)).mockReturnValueOnce(claim).mockReturnValueOnce(checkpoint).mockReturnValueOnce(query({ ...prepared, status: "queued" }));
    mocks.rpc.mockResolvedValueOnce({ data: { status: "charged", job: originalJob, credits_remaining: 3 } });
    mocks.privateRead.mockResolvedValueOnce(await sharp({ create: { width: 100, height: 100, channels: 4, background: "#f1ae77" } }).png().toBuffer());
    const gemini = vi.fn(async () => Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: '[{"name":"Whole wordmark","box_2d":[100,200,400,800]}]' }] } }] }));
    vi.stubGlobal("fetch", gemini);
    mocks.submit.mockResolvedValueOnce({ request_id: "one-pilot-receipt" });
    const body = { kind: "extract", extractionMode: "pilot", idempotencyKey: "pilot-request-key", priceVersion: "design-extract-v1", acknowledgedClaws: 2 };
    expect((await startOperation(privateProject, body)).creditsRemaining).toBe(3);
    expect(claim.is).toHaveBeenCalledWith("dispatch_started_at", null);
    expect(gemini).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(checkpoint.update.mock.calls[0][0]).toMatchObject({ model: "fal-ai/sam-3-1/image", input: { image_url: source, _desaynclaw: { preview: { width: 100, height: 100 } } } });
    expect(mocks.submit).toHaveBeenCalledExactlyOnceWith("fal-ai/sam-3-1/image", { input: {
      image_url: "https://private-signed.test/source.png", prompt: "", apply_mask: false, output_format: "png", return_multiple_masks: true, max_masks: 1, include_scores: true,
      box_prompts: [{ x_min: 20, y_min: 10, x_max: 79, y_max: 39, object_id: 1 }],
    } });
    mocks.from.mockReturnValueOnce(query(originalJob));
    await startOperation(privateProject, body);
    expect(gemini).toHaveBeenCalledTimes(1);
    expect(mocks.submit).toHaveBeenCalledTimes(1);
  });
  it("leaves the artwork intact and settles the reservation when Gemini rejects the request", async () => {
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("VERCEL", ""); vi.stubEnv("DESIGN_EXTRACT_QUALITY_PILOT", "true");
    vi.stubEnv("GEMINI_API_KEY", "mock-key"); vi.stubEnv("DESIGN_EXTRACT_PROCESSOR", "legacy"); vi.stubEnv("DESIGN_EXTRACT_BILLING_MODE", "paid");
    const source = "r2-private://design-extract/users/admin-1/design-extract/project-1/source.png";
    const job = { id: "pilot-402", kind: "extract", model: "fal-ai/sam2/auto-segment", user_id: project.user_id, project_id: project.id,
      status: "submitting", input: { image_url: source, _desaynclaw: { qualityPilot: true } }, billing_state: "held", charge_amount: 2 };
    const failed = { ...job, status: "failed" };
    mocks.from.mockReturnValueOnce(query(null)).mockReturnValueOnce(query(job)).mockReturnValueOnce(query(failed));
    mocks.rpc.mockResolvedValueOnce({ data: { status: "charged", job, credits_remaining: 3 } }).mockResolvedValueOnce({ data: { status: "refunded" } });
    mocks.privateRead.mockResolvedValueOnce(await sharp({ create: { width: 100, height: 100, channels: 4, background: "#f1ae77" } }).png().toBuffer());
    const gemini = vi.fn(async () => new Response(null, { status: 402 }));
    vi.stubGlobal("fetch", gemini);
    const body = { kind: "extract", extractionMode: "pilot", idempotencyKey: "pilot-402-key", priceVersion: "design-extract-v1", acknowledgedClaws: 2 };
    await expect(startOperation({ ...project, source_url: source }, body)).resolves.toMatchObject({ status: "failed", billing_state: "refunded" });
    expect(gemini).toHaveBeenCalledTimes(1);
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenLastCalledWith("settle_design_extract_billing", { target_user: project.user_id, target_job: job.id });
  });
  it("cannot submit locally scoped pilot or cutout-review jobs in a Vercel runtime", async () => {
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("VERCEL", "1"); vi.stubEnv("DESIGN_EXTRACT_QUALITY_PILOT", "true");
    for (const extractionMode of ["pilot", "review", "automatic"]) {
      await expect(startOperation(project, { kind: "extract", extractionMode, idempotencyKey: "pilot-not-public" })).rejects.toMatchObject({ status: 400 });
    }
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("rejects project creation without private storage before reading or reserving anything", async () => {
    vi.stubEnv("DESIGN_EXTRACT_PRIVATE_BUCKET", "");
    await expect(createProject(project.user_id, project.source_url)).rejects.toMatchObject({status:503});
    expect(mocks.fetch).not.toHaveBeenCalled(); expect(mocks.upload).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("accepts a sub-20MiB JPEG whose normalized PNG exceeds 20MiB and reads it under the internal cap", async () => {
    const jpg = await sharp(randomFillSync(Buffer.alloc(3000*3000*3)), {raw:{width:3000,height:3000,channels:3}}).jpeg({quality:88}).toBuffer();
    expect(jpg.length).toBeLessThan(20*1024*1024);
    mocks.fetch.mockResolvedValueOnce({buffer:jpg});
    mocks.from.mockReturnValue(query(project));
    mocks.upload.mockResolvedValue("r2-private://design-extract/users/admin-1/design-extract/project-1/source.png");
    await createProject(project.user_id, project.source_url);
    const normalized = mocks.upload.mock.calls[0][0];
    expect(normalized.length).toBeGreaterThan(20*1024*1024);
    expect(normalized.length).toBeLessThanOrEqual(100*1024*1024);
    expect(mocks.fetch.mock.calls[0][1].maxBytes).toBe(20*1024*1024);
    mocks.fetch.mockResolvedValueOnce({buffer:normalized});
    expect(await readAsset(project.source_url)).toBe(normalized);
    expect(mocks.fetch.mock.calls[1][1].maxBytes).toBe(100*1024*1024);
    expect((await sharp(normalized).metadata()).width).toBe(3000);
    expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.submit).not.toHaveBeenCalled();
  }, 15000);
  it("checks the acknowledged paid price before reserving credits", async () => {
    vi.stubEnv("DESIGN_EXTRACT_BILLING_MODE", "paid"); mocks.from.mockReturnValue(query(null));
    await expect(startOperation(project, { kind: "extract", idempotencyKey: "paid-request-key", priceVersion: "design-extract-v1", acknowledgedClaws: 0 })).rejects.toMatchObject({ status: 409 });
    expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("requires private source storage for paid generation", async () => {
    vi.stubEnv("DESIGN_EXTRACT_BILLING_MODE", "paid"); vi.stubEnv("DESIGN_EXTRACT_PRIVATE_BUCKET", ""); mocks.from.mockReturnValue(query(null));
    await expect(startOperation(project, { kind: "extract", idempotencyKey: "paid-request-key", priceVersion: "design-extract-v1", acknowledgedClaws: 2 })).rejects.toMatchObject({ status: 503 });
    expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("reserves a paid job once and sends only a temporary source link to the provider", async () => {
    vi.stubEnv("DESIGN_EXTRACT_BILLING_MODE", "paid"); vi.stubEnv("DESIGN_EXTRACT_PRIVATE_BUCKET", "design-extract-private");
    const privateProject = { ...project, source_url: "r2-private://design-extract/users/admin-1/design-extract/project-1/source.png" };
    const job = { id: "paid-job", project_id: project.id, user_id: project.user_id, base_revision: 0, status: "submitting", model: "fal-ai/qwen-image-layered", input: { image_url: privateProject.source_url }, kind: "extract", billing_state: "held", charge_amount: 2 };
    mocks.from.mockReturnValueOnce(query(null)).mockReturnValueOnce(query({ ...job, dispatch_started_at: "2026-11-18T00:00:00Z" })).mockReturnValueOnce(query({ ...job, status: "queued" }));
    mocks.rpc.mockResolvedValueOnce({ data: { status: "charged", job, credits_remaining: 3 } });
    mocks.submit.mockResolvedValueOnce({ request_id: "paid-provider-receipt" });
    const result = await startOperation(privateProject, { kind: "extract", idempotencyKey: "paid-request-key", priceVersion: "design-extract-v1", acknowledgedClaws: 2 });
    expect(result.creditsRemaining).toBe(3);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.submit).toHaveBeenCalledExactlyOnceWith("fal-ai/qwen-image-layered", expect.objectContaining({ input: expect.objectContaining({ image_url: "https://private-signed.test/source.png" }) }));
  });
  it("resumes a paid reservation after a lost claim receipt without reserving again", async () => {
    const privateProject = { ...project, source_url: "r2-private://design-extract/users/admin-1/design-extract/project-1/source.png" };
    const job = { id: "lost-claim", project_id: project.id, user_id: project.user_id, base_revision: 0, status: "submitting", model: "fal-ai/qwen-image-layered", input: { image_url: privateProject.source_url, _desaynclaw: { enhanceLayers: 1 } }, billing_state: "held", charge_amount: 2 };
    vi.stubEnv("DESIGN_EXTRACT_PRIVATE_BUCKET", "design-extract-private");
    const claim = query({ ...job, dispatch_started_at: "2026-11-18T00:00:00Z" });
    mocks.from.mockReturnValueOnce(claim).mockReturnValueOnce(query({ ...job, status: "queued" }));
    mocks.submit.mockResolvedValue({ request_id: "existing-reservation-receipt" });
    mocks.rpc.mockResolvedValue({ data: { status: "held" } });
    expect((await settleOperation(privateProject, job)).status).toBe("queued");
    expect(claim.is).toHaveBeenCalledWith("dispatch_started_at", null);
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    expect(mocks.submit.mock.calls[0][1].input).not.toHaveProperty("_desaynclaw");
    expect(mocks.rpc.mock.calls.every(([name]) => name === "settle_design_extract_billing")).toBe(true);
  });
  it("does not repeat dispatch after another poller wins the marker or a provider receipt is lost", async () => {
    const privateProject = { ...project, source_url: "r2-private://design-extract/users/admin-1/design-extract/project-1/source.png" };
    const job = { id: "dispatch-race", project_id: project.id, user_id: project.user_id, base_revision: 0, status: "submitting", model: "fal-ai/qwen-image-layered", input: { image_url: privateProject.source_url }, billing_state: "held", charge_amount: 2 };
    const started = { ...job, dispatch_started_at: "2026-11-18T00:00:00Z" };
    vi.stubEnv("DESIGN_EXTRACT_PRIVATE_BUCKET", "design-extract-private");
    mocks.from.mockReturnValueOnce(query(null)).mockReturnValueOnce(query(started));
    mocks.rpc.mockResolvedValue({ data: { status: "held" } });
    await settleOperation(privateProject, job);
    await settleOperation(privateProject, started);
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("automatically settles initial layers through the atomic review RPC on sync only", async () => {
    const layer = { id: "layer", width: 20, height: 30, url: project.source_url, composition: { x: 0, y: 0, scale: 1 } };
    const job = { id: "initial", kind: "extract", status: "ready", base_revision: 0, result: { layers: [layer] } };
    const saved = { ...project, revision: 1, manifest: { ...project.manifest, layers: [layer] } };
    mocks.from.mockReturnValueOnce(query([job])).mockReturnValueOnce(query(job)).mockReturnValueOnce(query(saved)).mockReturnValueOnce(query([{ ...job, status: "accepted" }])).mockReturnValueOnce(query({credits:4}));
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    const result = await snapshot(project, true);
    expect(result.project.revision).toBe(1);
    expect(result.job.status).toBe("accepted");
    expect(mocks.rpc).toHaveBeenCalledWith("review_design_extract", expect.objectContaining({ target_job: "initial", expected_revision: 0, accepted: true }));
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("opens a read-only snapshot without touching the provider", async () => {
    mocks.from.mockReturnValue(query([{ id: "pending", status: "queued", request_id: "recorded" }]));
    expect((await snapshot(project)).job.request_id).toBe("recorded");
    expect(mocks.status).not.toHaveBeenCalled(); expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("checks access on sync and advances only the recorded request", async () => {
    const context = { params: Promise.resolve({ id: project.id }) };
    expect((await syncDocument(jsonRequest({}, { token: null }), context)).status).toBe(401);
    const job = { id: "existing", status: "queued", model: "model", request_id: "recorded" };
    mocks.from.mockReturnValueOnce(query(project)).mockReturnValueOnce(query([job])).mockReturnValue(query([]));
    mocks.status.mockResolvedValue({ status: "IN_PROGRESS" });
    const synced = await syncDocument(jsonRequest({}), context);
    expect(synced.status).toBe(200);
    expect((await synced.json()).job.status).toBe("processing");
    expect(mocks.status).toHaveBeenCalledWith("model", { requestId: "recorded", logs: false });
    expect(mocks.submit).not.toHaveBeenCalled();
    mocks.status.mockClear();
    mocks.from.mockReturnValueOnce(query(project)).mockReturnValueOnce(query([job]));
    const opened = await getDocument(jsonRequest({}), context);
    expect(opened.status).toBe(200); expect(opened.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.status).not.toHaveBeenCalled();
  });
  it("requires the current revision and an owned mask before reading assets", async () => {
    await expect(editLayerAsset(project, { revision: 99 })).rejects.toMatchObject({ status: 409 });
    const layer = { id: "layer", url: project.source_url };
    mocks.from.mockReturnValue(query([]));
    await expect(editLayerAsset({ ...project, manifest: { ...project.manifest, layers: [layer] } }, { revision: 0, layerId: "layer", maskUrl: "https://evil.test/mask.png" })).rejects.toMatchObject({ status: 403 });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("saves native mask pixels under the project prefix and commits using revision protection", async () => {
    const source = await sharp({ create: { width: 4, height: 1, channels: 4, background: { r: 21, g: 117, b: 203, alpha: 1 } } }).png().toBuffer();
    const mask = await sharp(Buffer.from([0, 255, 128, 0]), { raw: { width: 4, height: 1, channels: 1 } }).png().toBuffer();
    const item = { id: "layer", url: project.source_url, width: 4, height: 1, composition: { x: 20, y: 30, scale: 2 }, layout: { x: 300, y: 0, scale: 1 } };
    const stored = query({ ...project, revision: 1 });
    mocks.from.mockReturnValueOnce(query([])).mockReturnValueOnce(stored);
    mocks.fetch.mockImplementation(url => Promise.resolve({ buffer: url.endsWith("mask.png") ? mask : source }));
    mocks.upload.mockImplementation((_, key) => Promise.resolve(`https://r2.test/${key}`));
    await editLayerAsset({ ...project, manifest: { ...project.manifest, layers: [item] } }, { action: "mask", layerId: "layer", revision: 0, maskUrl: "https://r2.test/users/admin-1/mask.png" });
    const saved = stored.update.mock.calls[0][0].manifest.layers[0];
    expect(saved).toMatchObject({ width: 2, height: 1, composition: { x: 22, y: 30, scale: 2 }, layout: { x: 301, y: 0, scale: 1 }, acceptedVersion: "mask" });
    expect(saved.url).toContain("users/admin-1/design-extract/project-1/masks/");
    expect(saved.baseVariant.url).toBe(item.url);
    expect(saved.edgeCleanup).toEqual({ defringe: 0, specks: 0 });
    expect(saved.maskedVariant.edgeCleanup).toEqual(saved.edgeCleanup);
    expect(stored.eq).toHaveBeenCalledWith("revision", 0);
    const rgba = await sharp(mocks.upload.mock.calls[0][0]).raw().toBuffer();
    expect([...rgba]).toEqual([21, 117, 203, 255, 21, 117, 203, 128]);
  });
  it("persists optional cleanup and preserves the reversible mask base", async () => {
    const pixels = Buffer.alloc(8 * 8 * 4);
    pixels.set([255, 255, 255, 255], 0);
    for (let y = 3; y < 6; y++) for (let x = 3; x < 6; x++) pixels.set([20, 80, 130, 255], (y * 8 + x) * 4);
    const source = await sharp(pixels, { raw: { width: 8, height: 8, channels: 4 } }).png().toBuffer();
    const mask = await sharp({ create: { width: 8, height: 8, channels: 3, background: "white" } }).png().toBuffer();
    const item = { id: "layer", url: project.source_url, width: 8, height: 8, composition: { x: 20, y: 30, scale: 2 }, layout: { x: 300, y: 0, scale: 1 } };
    const stored = query({ ...project, revision: 1 });
    mocks.from.mockReturnValueOnce(query([])).mockReturnValueOnce(stored);
    mocks.fetch.mockImplementation(url => Promise.resolve({ buffer: url.endsWith("mask.png") ? mask : source }));
    mocks.upload.mockImplementation((_, key) => Promise.resolve(`https://r2.test/${key}`));
    await editLayerAsset({ ...project, manifest: { ...project.manifest, layers: [item] } }, { action: "mask", layerId: "layer", revision: 0, maskUrl: "https://r2.test/users/admin-1/mask.png", edgeCleanup: { defringe: 0, specks: 4 } });
    const saved = stored.update.mock.calls[0][0].manifest.layers[0];
    expect(saved).toMatchObject({ width: 3, height: 3, edgeCleanup: { defringe: 0, specks: 4 }, composition: { x: 26, y: 36, scale: 2 } });
    expect(saved.maskedVariant.edgeCleanup).toEqual(saved.edgeCleanup);
    expect((await sharp(mocks.upload.mock.calls[1][0]).raw().toBuffer())[3]).toBe(255);
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("sends multiple numeric Include/Exclude prompts and rejects invalid points", async () => {
    const points = [{ x: 10, y: 20, label: 1 }, { x: 90, y: 30, label: 0 }];
    mocks.from.mockReturnValueOnce(query(null)).mockReturnValueOnce(query({ id: "segment" })).mockReturnValue(query({ id: "segment", status: "queued" }));
    mocks.submit.mockResolvedValue({ request_id: "recorded-request" });
    await startOperation(project, { kind: "segment", points, idempotencyKey: "selection-1234" });
    expect(mocks.submit.mock.calls[0][0]).toBe("fal-ai/sam2/image");
    expect(mocks.submit.mock.calls[0][1].input.prompts).toEqual(points);
    mocks.from.mockReturnValue(query(null));
    await expect(startOperation(project, { kind: "segment", points: [{ x: 10, y: 10, label: 0 }], idempotencyKey: "invalid-1234" })).rejects.toMatchObject({ status: 400 });
  });
  it.each(["extract", "split"])("uses automatic SAM 2 for %s without manual points or generative prompts", async kind => {
    const layer = { id: "selected", url: "https://r2.test/users/admin-1/layer.png", width: 20, height: 30 };
    const source = kind === "split" ? { ...project, manifest: { ...project.manifest, layers: [layer] } } : project;
    const claim = query({ id: "prompt-job" });
    mocks.from.mockReturnValueOnce(query(null)).mockReturnValueOnce(claim).mockReturnValue(query({ id: "prompt-job", status: "queued" }));
    mocks.submit.mockResolvedValueOnce({ request_id: "provider-request" });
    await startOperation(source, { kind, layerId: kind === "split" ? layer.id : undefined, idempotencyKey: "request-12345", prompt: "Ignore the source and draw a different logo" });
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    const [model, { input }] = mocks.submit.mock.calls[0];
    expect(model).toBe("fal-ai/sam2/auto-segment");
    expect(input).toMatchObject({ image_url: expect.stringContaining("private-signed.test"), output_format: "png", points_per_side: 32, pred_iou_thresh: .88, stability_score_thresh: .95, min_mask_region_area: 100 });
    expect(input).not.toHaveProperty("prompts");
    expect(input).not.toHaveProperty("point_prompts");
    expect(input).not.toHaveProperty("prompt");
    expect(claim.insert).toHaveBeenCalledWith(expect.objectContaining({ input: { ...input, image_url: expect.stringContaining("r2-private://design-extract/"), _desaynclaw: { enhanceLayers: 0, maskExtraction: 1 } }, model }));
    expect(input).not.toHaveProperty("_desaynclaw");
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it("keeps point-guided source-pixel cutouts independent of reconstruction conditioning", async () => {
    mocks.from.mockReturnValueOnce(query(null)).mockReturnValueOnce(query({ id: "cutout-job" })).mockReturnValue(query({ id: "cutout-job", status: "queued" }));
    mocks.submit.mockResolvedValueOnce({ request_id: "provider-request" });
    await startOperation(project, { kind: "segment", point: { x: 12, y: 18 }, idempotencyKey: "request-12345" });
    expect(mocks.submit).toHaveBeenCalledExactlyOnceWith("fal-ai/sam2/image", { input: {
      image_url: "https://private-signed.test/source.png", apply_mask: false, output_format: "png",
      prompts: [{ x: 12, y: 18, label: 1 }],
    } });
  });
  it("sends a selection box and its correction points to SAM 3 as one object", async () => {
    mocks.from.mockReturnValueOnce(query(null)).mockReturnValueOnce(query({ id: "cutout-job" })).mockReturnValue(query({ id: "cutout-job", status: "queued" }));
    mocks.submit.mockResolvedValueOnce({ request_id: "provider-request" });
    await startOperation(project, { kind: "segment", selectionBox: { left: 8, top: 10, right: 45, bottom: 55 }, points: [{ x: 12, y: 18, label: 1 }, { x: 14, y: 20, label: 0 }], idempotencyKey: "boxed-cutout" });
    expect(mocks.submit).toHaveBeenCalledExactlyOnceWith("fal-ai/sam-3/image", { input: {
      image_url: "https://private-signed.test/source.png", apply_mask: false, output_format: "png",
      box_prompts: [{ x_min: 8, y_min: 10, x_max: 45, y_max: 55, object_id: 1 }],
      point_prompts: [{ x: 12, y: 18, label: 1, object_id: 1 }, { x: 14, y: 20, label: 0, object_id: 1 }],
    } });
    mocks.from.mockReturnValue(query(null));
    await expect(startOperation(project, { kind: "segment", selectionBox: { left: 8, top: 10, right: 8, bottom: 55 }, idempotencyKey: "invalid-box" })).rejects.toMatchObject({ status: 400 });
    expect(mocks.submit).toHaveBeenCalledTimes(1);
  });
  it("returns existing idempotent job without charging or dispatching", async () => {
    const job = { id: "existing", kind: "extract", status: "queued" }; mocks.from.mockReturnValue(query(job));
    expect(await startOperation(project, { kind: "extract", idempotencyKey: "request-12345" })).toEqual(job);
    expect(mocks.submit).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("refuses to reuse an idempotency key for another operation", async () => {
    mocks.from.mockReturnValue(query({ id: "existing", kind: "extract", status: "queued" }));
    await expect(startOperation(project, { kind: "split", layerId: "other", idempotencyKey: "request-12345" })).rejects.toMatchObject({ status: 409 });
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("retains claim on uncertain submission rather than automatically submitting twice", async () => {
    mocks.from.mockReturnValueOnce(query(null)).mockReturnValueOnce(query({ id: "job-1" }));
    mocks.submit.mockRejectedValue(new Error("Network interrupted"));
    await expect(startOperation(project, { kind: "extract", idempotencyKey: "request-12345" })).rejects.toMatchObject({ status: 503 });
    expect(mocks.submit).toHaveBeenCalledTimes(1);
  });
  it("rejects concurrent operation claims", async () => {
    mocks.from.mockReturnValueOnce(query(null)).mockReturnValueOnce(query(null, { code: "23505" }));
    await expect(startOperation(project, { kind: "extract", idempotencyKey: "request-12345" })).rejects.toMatchObject({ status: 409 });
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("persists trimmed RGBA layers before making results ready", async () => {
    const pixels = Buffer.alloc(4 * 4 * 4); pixels.set([255, 0, 0, 255], (1 * 4 + 2) * 4);
    const png = await sharp(pixels, { raw: { width: 4, height: 4, channels: 4 } }).png().toBuffer();
    mocks.status.mockResolvedValue({ status: "COMPLETED" });
    mocks.result.mockResolvedValue({ data: { images: [{ url: "https://fal.media/layer.png", width: 4, height: 4 }] } });
    mocks.fetch.mockResolvedValue({ buffer: png }); mocks.upload.mockResolvedValue("https://r2.test/output.png");
    const q = query({ id: "job-1", status: "ready" }); mocks.from.mockReturnValue(q);
    await settleOperation(project, { id: "job-1", kind: "extract", status: "saving", request_id: "req", model: "model", input: { _desaynclaw: { enhanceLayers: 0 } }, created_at: new Date().toISOString() });
    const ready = q.update.mock.calls.find(([value]) => value.status === "ready")[0];
    expect(ready.result.enhancement).toBeUndefined();
    expect(ready.result.layers[0]).toMatchObject({ width: 1, height: 1, composition: { x: 50, y: 25, scale: 25 } });
    const meta = await sharp(mocks.upload.mock.calls[0][0]).metadata(); expect(meta.hasAlpha).toBe(true);
    expect(mocks.upload.mock.invocationCallOrder[0]).toBeLessThan(q.update.mock.invocationCallOrder.find(order => order > mocks.upload.mock.invocationCallOrder[0]));
  });
  it("saves a SAM 3 box cutout from the mask asset with native source RGB", async () => {
    const source = await sharp({ create: { width: 4, height: 4, channels: 4, background: { r: 21, g: 117, b: 203, alpha: 1 } } }).png().toBuffer();
    const maskPixels = Buffer.alloc(16); maskPixels[6] = 128;
    const mask = await sharp(maskPixels, { raw: { width: 4, height: 4, channels: 1 } }).png().toBuffer();
    mocks.status.mockResolvedValue({ status: "COMPLETED" });
    mocks.result.mockResolvedValue({ data: { image: { url: "https://fal.media/preview.png" }, masks: [{ url: "https://fal.media/mask.png" }] } });
    mocks.fetch.mockImplementation(url => Promise.resolve({ buffer: url.includes("fal.media") ? mask : source }));
    mocks.upload.mockResolvedValue("https://r2.test/cutout.png");
    const q = query({ id: "cutout-job", status: "ready" }); mocks.from.mockReturnValue(q);
    await settleOperation({ ...project, manifest: { ...project.manifest, width: 4, height: 4 } }, { id: "cutout-job", kind: "segment", model: "fal-ai/sam-3/image", status: "saving", request_id: "sam-request", input: { image_url: project.source_url, apply_mask: false, box_prompts: [{ x_min: 1, y_min: 0, x_max: 3, y_max: 2 }] }, created_at: new Date().toISOString() });
    const ready = q.update.mock.calls.find(([value]) => value.status === "ready")[0];
    expect(ready.result.enhancement).toBeUndefined();
    expect(ready.result.layers[0]).toMatchObject({ width: 1, height: 1, extractionMethod: "source-pixels", composition: { x: 2, y: 1, scale: 1 } });
    expect([...await sharp(mocks.upload.mock.calls[0][0]).raw().toBuffer()]).toEqual([21, 117, 203, 128]);
    expect(mocks.fetch.mock.calls.map(([url]) => url)).toContain("https://fal.media/mask.png");
    expect(mocks.fetch.mock.calls.map(([url]) => url)).not.toContain("https://fal.media/preview.png");
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("automatically separates disconnected model elements with aligned PNGs and isolated native masks", async () => {
    const pixels = Buffer.alloc(100 * 80 * 4);
    for (const [left, top] of [[4, 4], [70, 50]]) for (let y = top; y < top + 8; y++) for (let x = left; x < left + 8; x++) pixels.set([180, 40, 210, 128], (y * 100 + x) * 4);
    const png = await sharp(pixels, { raw: { width: 100, height: 80, channels: 4 } }).png().toBuffer();
    mocks.status.mockResolvedValue({ status: "COMPLETED" });
    mocks.result.mockResolvedValue({ data: { images: [{ url: "https://fal.media/elements.png" }] } });
    mocks.fetch.mockResolvedValue({ buffer: png });
    mocks.upload.mockImplementation((_, key) => Promise.resolve(`https://r2.test/${key}`));
    const q = query({ id: "elements-job", status: "ready" }); mocks.from.mockReturnValue(q);
    await settleOperation({ ...project, manifest: { ...project.manifest, width: 100, height: 80 } }, { id: "elements-job", kind: "extract", status: "saving", request_id: "qwen-request", model: "fal-ai/qwen-image-layered", input: { _desaynclaw: { enhanceLayers: 0, separateElements: 1 } }, created_at: new Date().toISOString() });
    const ready = q.update.mock.calls.find(([value]) => value.status === "ready")[0];
    expect(ready.result.layers).toHaveLength(2);
    expect(ready.result.layers[0]).toMatchObject({ name: "Element 1", width: 8, height: 8, nativeFrame: { width: 100, height: 80, left: 4, top: 4 }, composition: { x: 4, y: 4, scale: 1 } });
    expect(ready.result.layers[1]).toMatchObject({ composition: { x: 70, y: 50, scale: 1 } });
    expect(new Set(ready.result.layers.map(item => item.id)).size).toBe(2);
    const nativeBase = await sharp(mocks.upload.mock.calls[1][0]).raw().toBuffer();
    expect(nativeBase[(4 * 100 + 4) * 4 + 3]).toBe(128);
    expect(nativeBase[(50 * 100 + 70) * 4 + 3]).toBe(0);
    expect(ready.result.enhancement).toBeUndefined();
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("saves more than four automatic SAM masks as native aligned layers without another AI request", async () => {
    const source = await sharp({ create: { width: 10, height: 10, channels: 4, background: { r: 21, g: 117, b: 203, alpha: 1 } } }).png().toBuffer();
    const masks = [];
    for (let index = 0; index < 5; index++) {
      const mask = Buffer.alloc(100); mask[index * 20 + index] = 255;
      masks.push(await sharp(mask, { raw: { width: 10, height: 10, channels: 1 } }).png().toBuffer());
    }
    mocks.status.mockResolvedValue({ status: "COMPLETED" });
    mocks.result.mockResolvedValue({ data: { individual_masks: masks.map((_, index) => ({ url: `https://fal.media/mask-${index}.png` })) } });
    mocks.fetch.mockImplementation(url => { const match = /mask-(\d+)\.png/.exec(url); return Promise.resolve({ buffer: match ? masks[Number(match[1])] : source }); });
    mocks.upload.mockImplementation((_, key) => Promise.resolve(`https://r2.test/${key}`));
    const q = query({ id: "automatic-job", status: "ready" }); mocks.from.mockReturnValue(q);
    await settleOperation({ ...project, manifest: { ...project.manifest, width: 10, height: 10 } }, { id: "automatic-job", kind: "extract", status: "saving", request_id: "sam-request", model: "fal-ai/sam2/auto-segment", input: { image_url: project.source_url, _desaynclaw: { enhanceLayers: 0, maskExtraction: 1 } }, created_at: new Date().toISOString() });
    const ready = q.update.mock.calls.find(([value]) => value.status === "ready")[0];
    expect(ready.result.layers).toHaveLength(6);
    expect(ready.result.layers.every(item => item.extractionMethod === "source-pixels")).toBe(true);
    expect(ready.result.layers.at(-1).name).toBe("Remaining artwork");
    expect(ready.result.layers[0]).toMatchObject({ composition: { x: 0, y: 0, scale: 1 }, nativeFrame: { width: 10, height: 10 } });
    expect(ready.result.layers[0].maskSourceUrl).toBe(ready.result.layers[0].maskBaseUrl);
    expect([...await sharp(mocks.upload.mock.calls[0][0]).raw().toBuffer()]).toEqual([21, 117, 203, 255]);
    expect(ready.result.enhancement).toBeUndefined();
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("checkpoints extracted candidates for enhancement before issuing any upscale request", async () => {
    const png = await sharp({ create: { width: 4, height: 4, channels: 4, background: { r: 20, g: 180, b: 80, alpha: .5 } } }).png().toBuffer();
    mocks.status.mockResolvedValue({ status: "COMPLETED" });
    mocks.result.mockResolvedValue({ data: { images: [{ url: "https://fal.media/layer.png" }] } });
    mocks.fetch.mockResolvedValue({ buffer: png }); mocks.upload.mockResolvedValue("https://r2.test/base-layer.png");
    const q = query({ id: "enhance-job", status: "saving" }); mocks.from.mockReturnValue(q);
    await settleOperation(project, { id: "enhance-job", project_id: project.id, kind: "extract", status: "saving", request_id: "qwen-request", model: "model", input: { _desaynclaw: { enhanceLayers: 1 } } });
    const persisted = q.update.mock.calls[0][0];
    expect(persisted).not.toHaveProperty("status", "ready");
    expect(persisted.result).toMatchObject({ layers: [{ width: 4, height: 4 }], enhancement: { version: 1, revision: 0, items: [{ status: "skipped", plan: null }] } });
    expect(q.is).toHaveBeenCalledWith("result", null);
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(mocks.upload.mock.invocationCallOrder[0]).toBeLessThan(q.update.mock.invocationCallOrder[0]);
  });
  it("resumes an enhancement checkpoint without polling or regenerating Qwen", async () => {
    const job = { id: "enhance-job", project_id: project.id, status: "saving", request_id: "qwen-request", result: { layers: [], warnings: [], enhancement: { version: 1, model: "fal-ai/esrgan", revision: 2, items: [] } } };
    const q = query({ ...job, status: "ready" }); mocks.from.mockReturnValue(q);
    expect(await settleOperation(project, job)).toMatchObject({ status: "ready" });
    expect(q.eq).toHaveBeenCalledWith("result->enhancement->>revision", "2");
    expect(mocks.status).not.toHaveBeenCalled();expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("keeps real model size rounding as a review warning instead of discarding valid layers", async () => {
    const png = await sharp({ create: { width: 480, height: 832, channels: 4, background: { r: 20, g: 180, b: 80, alpha: .5 } } }).png().toBuffer();
    mocks.status.mockResolvedValue({ status: "COMPLETED" });
    mocks.result.mockResolvedValue({ data: { images: [{ url: "https://fal.media/layer.png" }] } });
    mocks.fetch.mockResolvedValue({ buffer: png }); mocks.upload.mockResolvedValue("https://r2.test/output.png");
    const q = query({ id: "rounded-job", status: "ready" }); mocks.from.mockReturnValue(q);
    await settleOperation({ ...project, manifest: { ...project.manifest, width: 796, height: 1327 } }, { id: "rounded-job", kind: "extract", status: "saving", request_id: "req", model: "model", created_at: new Date().toISOString() });
    const ready = q.update.mock.calls.find(([value]) => value.status === "ready")[0];
    expect(ready.result).toMatchObject({ nativeWidth: 480, nativeHeight: 832 });
    expect(ready.result.layers[0]).toMatchObject({ width: 480, height: 832, composition: { y: 0, scale: 1327 / 832 } });
    expect(ready.result.layers[0].composition.x).toBeCloseTo((796 - 480 * (1327 / 832)) / 2);
    expect(ready.result.warnings).toEqual([expect.stringContaining("without stretching")]);
    expect(q.update.mock.calls.some(([value]) => value.status === "failed")).toBe(false);
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("recovers a completed failed result without submitting another generation", async () => {
    const png = await sharp({ create: { width: 4, height: 4, channels: 4, background: { r: 10, g: 20, b: 30, alpha: .5 } } }).png().toBuffer();
    const failed = { id: "failed-job", project_id: project.id, user_id: project.user_id, status: "failed", kind: "extract", base_revision: 0, request_id: "existing-request", model: "model", created_at: new Date().toISOString() };
    const lookup = query(failed);
    mocks.from.mockReturnValueOnce(lookup).mockReturnValueOnce(query({ ...failed, status: "saving" })).mockReturnValue(query({ id: failed.id, status: "ready" }));
    mocks.status.mockResolvedValue({ status: "COMPLETED" }); mocks.result.mockResolvedValue({ data: { images: [{ url: "https://fal.media/layer.png" }] } });
    mocks.fetch.mockResolvedValue({ buffer: png }); mocks.upload.mockResolvedValue("https://r2.test/recovered.png");
    expect(await recoverOperation(project, failed.id)).toMatchObject({ status: "ready" });
    expect(lookup.eq).toHaveBeenCalledWith("user_id", project.user_id);
    expect(mocks.result).toHaveBeenCalledWith("model", { requestId: "existing-request" });
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("does not recover output into a project changed since the request", async () => {
    mocks.from.mockReturnValue(query({ id: "failed", request_id: "req", base_revision: 0 }));
    await expect(recoverOperation({ ...project, revision: 1 }, "failed")).rejects.toMatchObject({ status: 409 });
    expect(mocks.status).not.toHaveBeenCalled(); expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("keeps incomplete provider results failed instead of submitting again", async () => {
    mocks.from.mockReturnValue(query({ id: "failed", request_id: "req", base_revision: 0, model: "model" }));
    mocks.status.mockResolvedValue({ status: "IN_PROGRESS" });
    await expect(recoverOperation(project, "failed")).rejects.toMatchObject({ status: 409 });
    expect(mocks.result).not.toHaveBeenCalled(); expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("retains the specific transparency failure instead of a generic output error", async () => {
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: "white" } }).png().toBuffer();
    mocks.status.mockResolvedValue({ status: "COMPLETED" }); mocks.result.mockResolvedValue({ data: { images: [{ url: "https://fal.media/layer.png" }] } });
    mocks.fetch.mockResolvedValue({ buffer: png });
    const q = query({ status: "failed" }); mocks.from.mockReturnValue(q);
    await settleOperation(project, { id: "opaque", status: "saving", request_id: "req", model: "model" });
    expect(q.update).toHaveBeenCalledWith(expect.objectContaining({ status: "failed", error: expect.stringContaining("without transparency") }));
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it("keeps existing layers on transient provider errors", async () => {
    mocks.status.mockRejectedValue(new Error("Temporary outage"));
    await expect(settleOperation(project, { id: "job", status: "queued", request_id: "req" })).rejects.toThrow("Temporary outage");
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("exposes saving before downloading provider assets", async () => {
    mocks.status.mockResolvedValue({ status: "COMPLETED" }); mocks.from.mockReturnValue(query(null));
    expect((await settleOperation(project, { id: "job", status: "queued", request_id: "request" })).status).toBe("saving");
    expect(mocks.result).not.toHaveBeenCalled(); expect(mocks.upload).not.toHaveBeenCalled();
  });
  it("does not dispatch an out-of-bounds segmentation point", async () => {
    mocks.from.mockReturnValue(query(null));
    const layer = { id: "selected", width: 20, height: 30, url: "https://r2.test/layer.png" };
    await expect(startOperation({ ...project, manifest: { ...project.manifest, layers: [layer] } }, { kind: "segment", layerId: "selected", point: { x: 20, y: 0 }, idempotencyKey: "request-12345" })).rejects.toMatchObject({ status: 400 });
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("accepts through an atomic revision-checked RPC", async () => {
    mocks.from.mockReturnValue(query({ id: "job", status: "ready", kind: "extract", result: { layers: [] } })); mocks.rpc.mockResolvedValue({ data: null });
    await reviewOperation(project, "job", true);
    expect(mocks.rpc).toHaveBeenCalledWith("review_design_extract", expect.objectContaining({ target_user: "admin-1", expected_revision: 0, accepted: true }));
  });
});
describe("retention", () => {
  it("renames manager cards without changing layer content", async () => {
    const q = query(project); mocks.from.mockReturnValue(q);
    await renameDesignProject(project, "  Jersey layers  ");
    expect(q.update).toHaveBeenCalledWith(expect.objectContaining({ manifest: { ...project.manifest, name: "Jersey layers" }, revision: 1 }));
    await expect(renameDesignProject(project, " ")).rejects.toMatchObject({ status: 400 });
  });
  it("blocks deletion during processing and restores the original expiry", async () => {
    const restore = query(null);
    mocks.from.mockReturnValueOnce(query(project)).mockReturnValueOnce(query([{ id: "active-job" }])).mockReturnValueOnce(restore);
    await expect(deleteDesignProject(project)).rejects.toMatchObject({ status: 409 });
    expect(deleteR2Prefix).not.toHaveBeenCalled();
    expect(restore.update).toHaveBeenCalledWith({ expires_at: project.expires_at });
  });
  it("deletes the full owned prefix before deleting an expired project record", async () => {
    const deleted = query(null);
    mocks.from.mockReturnValueOnce(query([project])).mockReturnValueOnce(query([])).mockReturnValueOnce(query([])).mockReturnValueOnce(deleted).mockReturnValueOnce(query([])).mockReturnValueOnce(query([]));
    await maintainDesignExtract();
    expect(deleteR2Prefix).toHaveBeenCalledWith("users/admin-1/design-extract/project-1/", { allowedPrefixes: ["users/admin-1/design-extract/project-1/"] });
    expect(deleteR2Prefix.mock.invocationCallOrder[0]).toBeLessThan(deleted.delete.mock.invocationCallOrder[0]);
  });
  it("retains the project row if storage deletion fails so cleanup can retry", async () => {
    mocks.from.mockReturnValue(query([project])); deleteR2Prefix.mockRejectedValueOnce(new Error("Storage unavailable"));
    await expect(maintainDesignExtract()).rejects.toThrow("Storage unavailable"); expect(mocks.from).toHaveBeenCalledTimes(1);
  });
  it("refunds a failed paid job before deleting its expired project", async () => {
    const job = { id: "paid-failed", user_id: project.user_id, billing_state: "held", status: "failed" };
    const deleted = query(null);
    mocks.from.mockReturnValueOnce(query([project])).mockReturnValueOnce(query([job])).mockReturnValueOnce(query([])).mockReturnValueOnce(deleted).mockReturnValueOnce(query([])).mockReturnValueOnce(query([]));
    mocks.rpc.mockResolvedValue({ data: { status: "refunded" } });
    await maintainDesignExtract();
    expect(mocks.rpc).toHaveBeenCalledWith("settle_design_extract_billing", { target_user: project.user_id, target_job: job.id });
    expect(mocks.rpc.mock.invocationCallOrder[0]).toBeLessThan(deleted.delete.mock.invocationCallOrder[0]);
  });
  it("retains financial evidence if refund confirmation is interrupted", async () => {
    const job = { id: "paid-failed", user_id: project.user_id, billing_state: "held", status: "failed" };
    const jobs = query([job]);
    mocks.from.mockReturnValueOnce(query([project])).mockReturnValueOnce(jobs);
    mocks.rpc.mockResolvedValue({ error: { code: "timeout" } });
    await expect(maintainDesignExtract()).rejects.toMatchObject({ status: 503 });
    expect(jobs.delete).not.toHaveBeenCalled();
  });
});

it.each([false,true])('bounds legacy job lifetime and keeps available output: %s',async usable=>{
 const job={id:'deadline',project_id:project.id,user_id:project.user_id,status:'processing',processor:'legacy',created_at:new Date(Date.now()-46*60000).toISOString(),request_id:'recorded',billing_state:'held',...(usable&&{result:{layers:[{id:'saved'}]}})};
 const updated={...job,status:usable?'ready':'failed'};const writes=query(updated);mocks.from.mockReturnValue(writes);mocks.rpc.mockResolvedValue({data:{status:usable?'settled':'refunded'}});
 expect(await settleOperation(project,job)).toMatchObject({status:updated.status,billing_state:usable?'settled':'refunded'});
 expect(writes.update).toHaveBeenCalledWith(expect.objectContaining({status:updated.status}));expect(mocks.status).not.toHaveBeenCalled();expect(mocks.submit).not.toHaveBeenCalled();
});
it('never resubmits an old uncertain provider claim when the deadline expires',async()=>{
 const job={id:'uncertain',status:'submitting',processor:'legacy',created_at:new Date(Date.now()-46*60000).toISOString(),dispatch_started_at:new Date().toISOString(),billing_state:'held'};mocks.rpc.mockResolvedValue({data:{status:'held'}});
 expect(await settleOperation(project,job)).toMatchObject({status:'submitting',billing_state:'held'});expect(mocks.from).not.toHaveBeenCalled();expect(mocks.submit).not.toHaveBeenCalled();
});

it.each(['segment','split'])('keeps %s output aligned with a moved and scaled parent',async kind=>{
 const source=await sharp({create:{width:4,height:4,channels:4,background:{r:21,g:117,b:203,alpha:1}}}).png().toBuffer();
 const coverage=Buffer.alloc(16);coverage[6]=255;const mask=await sharp(coverage,{raw:{width:4,height:4,channels:1}}).png().toBuffer();
 const parent={id:'parent',url:project.source_url,width:4,height:4,composition:{x:70,y:90,scale:2},layout:{x:300,y:0,scale:1}};
 mocks.status.mockResolvedValue({status:'COMPLETED'});mocks.result.mockResolvedValue({data:{masks:[{url:'https://fal.media/mask.png'}],individual_masks:[{url:'https://fal.media/mask.png'}]}});
 mocks.fetch.mockImplementation(url=>Promise.resolve({buffer:url.includes('fal.media')?mask:source}));mocks.upload.mockResolvedValue('https://r2.test/element.png');const q=query({id:'parent-cut',status:'ready'});mocks.from.mockReturnValue(q);
 await settleOperation({...project,manifest:{...project.manifest,layers:[parent]}},{id:'parent-cut',kind,layer_id:'parent',model:kind==='segment'?'fal-ai/sam2/image':'fal-ai/sam2/auto-segment',status:'saving',request_id:'existing-request',input:{image_url:project.source_url,apply_mask:false},created_at:new Date().toISOString()});
 const saved=q.update.mock.calls.find(([value])=>value.status==='ready')[0];
 expect(saved.result.layers[0]).toMatchObject({width:1,height:1,composition:{x:74,y:92,scale:2}});
 expect(mocks.submit).not.toHaveBeenCalled();
});
