import { test, expect } from "@playwright/test";
import { loadEnvConfig } from "@next/env";
import sharp from "sharp";
import { selectVariant } from "../../src/lib/designExtractVariants";
loadEnvConfig(process.cwd());

async function session(page) {
  const user = { id: "improvements-admin", email: "admin@test.com", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {} };
  const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  const auth = { access_token: `${encode({ alg: "HS256" })}.${encode({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600 })}.test`, refresh_token: "test", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user };
  const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
  await page.addInitScript(({ key, value }) => { document.cookie = `${key}=base64-${value}; path=/; SameSite=Lax`; localStorage.setItem("cookie_consent", "declined"); }, { key: `sb-${ref}-auth-token`, value: encode(auth) });
  await page.route("**/auth/v1/**", route => route.fulfill({ json: user }));
  await page.route("**/rest/v1/**", route => route.fulfill({ json: [] }));
  await page.setViewportSize({ width: 1440, height: 1000 });
  const fixture = await sharp({ create: { width: 40, height: 60, channels: 4, background: { r: 241, g: 43, b: 93, alpha: .8 } } }).png().toBuffer();
  await page.route("https://improvements.test/**", route => route.fulfill({ contentType: "image/png", body: fixture }));
  return fixture;
}
const layer = { id: "element", url: "https://improvements.test/layer.png", name: "Artwork", width: 40, height: 60, visible: true, locked: false, composition: { x: 10, y: 20, scale: 1 }, layout: { x: 300, y: 0, scale: 2 } };
const document = layers => ({ id: "improvements", revision: 0, source_url: "https://improvements.test/source.png", manifest: { version: 1, width: 400, height: 600, layers } });
test('one-time layer upscale previews dimensions and disables repeat requests',async({page})=>{
  await session(page);let project=document([structuredClone(layer)]),requests=0,finish;
  const gate=new Promise(resolve=>{finish=resolve;});
  await page.route('**/api/design-extract/improvements',route=>route.fulfill({json:{project,job:null}}));
  await page.route('**/api/design-extract/improvements/upscale',async route=>{
    requests++;expect(route.request().postDataJSON()).toEqual({layerId:'element',revision:0});await gate;
    project={...project,revision:1,manifest:{...project.manifest,layers:[{...layer,width:160,height:240,url:'https://improvements.test/enhanced.png',composition:{...layer.composition,scale:.25},layout:{...layer.layout,scale:.5},upscale:{state:'done'}}]}};
    await route.fulfill({json:{project}});
  });
  await page.goto('/design-extract/improvements');await page.getByRole('button',{name:'Select Artwork',exact:true}).click();
  await expect(page.getByRole('button',{name:'Select Artwork',exact:true})).toHaveCSS('border-radius','0px');
  await expect(page.getByText('AI layers or original cutouts?',{exact:true})).toHaveCount(0);
  await expect(page.getByText('Review AI-generated details before production.',{exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Upscale image',exact:true}).locator('[data-premium-crown]')).toHaveCount(1);
  for (const name of ['Upscale image', 'Convert to SVG', 'Download PNG']) {
    const button = page.getByRole('button', { name, exact: true });
    await expect(button).toHaveCSS('background-color', 'rgb(244, 244, 241)');
    await expect(button).toHaveCSS('color', 'rgb(8, 9, 10)');
    await expect(button).toHaveCSS('border-top-width', '2px');
  }
  await expect(page.locator('#layer-upscale-details')).toHaveText('4× output · 160 × 240 px');
  await page.getByRole('button',{name:'Upscale image',exact:true}).click();
  await expect(page.getByRole('button',{name:'Upscaling image…',exact:true}).locator('[data-premium-crown]')).toHaveCount(0);
  await expect(page.getByRole('region',{name:'Image upscale progress',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Upscaling image…',exact:true})).toBeDisabled();
  finish();await expect(page.getByRole('region',{name:'Image upscale progress',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Already upscaled',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Already upscaled',exact:true}).locator('[data-premium-crown]')).toHaveCount(0);
  await page.reload();await page.getByRole('button',{name:'Select Artwork',exact:true}).click();
  await expect(page.getByRole('button',{name:'Already upscaled',exact:true})).toBeDisabled();expect(requests).toBe(1);
});

test('large layers explain the upscale limit before a request is made',async({page})=>{
  await session(page);let requests=0;
  const project=document([{...layer,width:3372,height:5086}]);
  await page.route('**/api/design-extract/improvements',route=>route.fulfill({json:{project,job:null}}));
  await page.route('**/api/design-extract/improvements/upscale',route=>{requests++;return route.fulfill({status:500,json:{error:'Unexpected request'}});});
  await page.goto('/design-extract/improvements');await page.getByRole('button',{name:'Select Artwork',exact:true}).click();
  await expect(page.getByRole('button',{name:'Already high resolution',exact:true})).toBeDisabled();
  await expect(page.locator('#layer-upscale-details')).toContainText('3372 × 5086 px');
  await expect(page.locator('#layer-upscale-details')).toContainText('exceeds supported size limits');
  await expect(page.getByRole('alert').filter({hasText:'supported size limits'})).toHaveCount(0);expect(requests).toBe(0);
});
test('operation errors fade at the lower left without moving the workspace',async({page})=>{
 await session(page);const project=document([structuredClone(layer)]);
 await page.route('**/api/design-extract/improvements',route=>route.fulfill({json:{project,job:null}}));
 await page.route('**/api/design-extract/improvements/svg',route=>route.fulfill({status:422,json:{error:'This SVG uses unsupported gradient fills. Download the original SVG.'}}));
 await page.goto('/design-extract/improvements');await page.getByRole('button',{name:'Select Artwork',exact:true}).click();
 const canvas=page.getByRole('region',{name:'Design canvas',exact:true});const before=await canvas.boundingBox();
 await page.getByRole('button',{name:'Convert to SVG',exact:true}).click();
 const notice=page.getByRole('alert').filter({hasText:'Notice'});await expect(notice).toContainText('unsupported gradient');await expect(notice).toHaveCSS('position','fixed');
 const box=await notice.boundingBox();expect(box.x).toBe(20);expect(box.y).toBeGreaterThan(500);expect(await canvas.boundingBox()).toEqual(before);
 await expect(notice).toHaveCSS('opacity','1');await expect(notice).toHaveCSS('transition-property','opacity, transform');await expect(notice).toHaveCount(0,{timeout:11000});
});

test('selected layer conversion inserts SVG and exports editable PSD shapes',async({page})=>{
  await session(page);
  let project=document([structuredClone(layer)]);
  const svg='<svg xmlns="http://www.w3.org/2000/svg" width="40" height="60" viewBox="0 0 40 60"><path fill="#f00" d="M0 0h40v30H0z"/><path fill="#00f" d="M0 30h40v30H0z"/></svg>';
  await page.route('https://improvements.test/vector.svg',route=>route.fulfill({contentType:'image/svg+xml',body:svg}));
  const png=await sharp({create:{width:40,height:60,channels:4,background:'#f00'}}).png().toBuffer();
  await page.route('**/api/design-extract/improvements/asset?*',route=>route.fulfill({contentType:route.request().url().includes('format=svg')?'image/svg+xml':'image/png',body:route.request().url().includes('format=svg')?svg:png}));
  await page.route('**/api/design-extract/improvements',route=>route.fulfill({json:{project,job:null}}));
  let finish,requests=0;
  const gate=new Promise(resolve=>{finish=resolve;});
  await page.route('**/api/design-extract/improvements/svg',async route=>{
    requests++;expect(route.request().postDataJSON()).toEqual({layerId:'element',attach:true,revision:0});await gate;
    project={...project,revision:1,manifest:{...project.manifest,version:2,layers:[{...layer,visible:false,visibility:{overview:true,composition:false}},{...layer,id:'svg-element',name:'Artwork · SVG',kind:'svg',url:'https://improvements.test/vector.svg',previewUrl:'https://improvements.test/vector.png',sourceLayerId:'element',visibility:{overview:true,composition:true},vector:{pathCount:2,knotCount:8},layout:{x:450,y:0,scale:2}}]}};
    await route.fulfill({json:{project,layerId:'svg-element'}});
  });
  await page.goto('/design-extract/improvements');
  await page.getByRole('button',{name:'Select Artwork',exact:true}).click();
  const inspector=page.getByRole('complementary',{name:'Layer properties'});
  await inspector.getByRole('button',{name:'Convert to SVG',exact:true}).click();
  await expect(inspector.getByRole('button',{name:'Converting to SVG…',exact:true})).toBeDisabled();
  const progress=page.getByRole('region',{name:'SVG conversion progress',exact:true});await expect(progress).toBeVisible();
  const label=progress.getByRole('status');await expect(label).toHaveText('Generating SVG…');await expect(label).toHaveCSS('position','static');
  const shimmer=await label.evaluate(el=>getComputedStyle(el).backgroundPosition);await expect.poll(()=>label.evaluate(el=>getComputedStyle(el).backgroundPosition)).not.toBe(shimmer);
  const sweep=progress.locator('[class*="artworkSweep"]');const initial=await sweep.evaluate(el=>getComputedStyle(el).transform);await expect.poll(()=>sweep.evaluate(el=>getComputedStyle(el).transform)).not.toBe(initial);
  finish();await expect(page.getByRole('button',{name:'Select Artwork · SVG',exact:true})).toBeVisible();await expect(progress).toHaveCount(0);
  await expect(inspector.getByRole('button',{name:'Download SVG',exact:true})).toBeEnabled();await expect(inspector.getByRole('button',{name:'Download SVG',exact:true}).locator('[data-premium-crown]')).toHaveCount(0);await expect(inspector.getByRole('button',{name:'Refine mask',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Select Artwork',exact:true})).toBeVisible();
  await page.reload();await expect(page.getByRole('button',{name:'Select Artwork · SVG',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Composition',exact:true}).click();await expect(page.getByRole('button',{name:'Select Artwork',exact:true})).toBeHidden();
  await expect(page.getByRole('button',{name:'Export layered PSD',exact:true}).locator('[data-premium-crown]')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Quick export PSD',exact:true}).locator('[data-premium-crown]')).toHaveCount(0);
  const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Quick export PSD',exact:true}).click();
  const file=await downloading;const {readFile}=await import('node:fs/promises');const {readPsd}=await import('ag-psd');const saved=readPsd(await readFile(await file.path()),{skipLayerImageData:true,skipCompositeImageData:true,skipThumbnail:true});
  const group=saved.children.find(child=>child.name==='Artwork · SVG');expect(group.children).toHaveLength(2);expect(group.children.every(child=>child.vectorMask&&child.vectorFill)).toBe(true);expect(saved.children.find(child=>child.name==='Artwork').hidden).toBe(true);expect(requests).toBe(1);
  await file.saveAs('test-results/design-extract-editable-shapes.psd');
  await page.getByRole('button',{name:'Overview',exact:true}).click();await page.getByRole('button',{name:'Select Artwork · SVG',exact:true}).click();await page.screenshot({path:'test-results/design-extract-svg-canvas.png'});
});

test('new uploads frame the source and guide together above the toolbar',async({page})=>{
  await session(page);
  let project=document([]);
  let image;
  await page.route('https://improvements.test/**',route=>route.fulfill({contentType:'image/png',body:image}));
  await page.route('**/api/design-extract/improvements**',route=>route.fulfill({json:{project,job:null}}));
  for(const [width,height,sourceWidth,sourceHeight] of [[1920,960,800,1200],[1440,900,1200,600],[1024,720,600,1200]]) {
    project={...project,manifest:{...project.manifest,width:sourceWidth,height:sourceHeight}};
    image=await sharp({create:{width:sourceWidth,height:sourceHeight,channels:4,background:'#1A1C1E'}}).png().toBuffer();
    await page.setViewportSize({width,height});
    await page.goto('/design-extract/improvements');
    const canvas=page.getByRole('region',{name:'Design canvas',exact:true});
    const guide=page.getByRole('region',{name:'Getting started with Design Extract',exact:true});
    const source=page.getByAltText('Original flat design', {exact:true}).locator('..');
    const dock=page.getByRole('toolbar',{name:'Design editing tools'});
    const assertFramed=async()=>{
      await expect(guide).toBeVisible();
      await expect.poll(async()=>{
        const [c,g,s,d]=await Promise.all([canvas.boundingBox(),guide.boundingBox(),source.boundingBox(),dock.boundingBox()]);
        return g.x>=c.x+24 && g.x+g.width<=c.x+c.width-24 && s.x>=c.x+24 && Math.abs(s.y-g.y)<2 && Math.abs(s.height-g.height)<2 && Math.max(s.y+s.height,g.y+g.height)<d.y && Math.abs((s.x+g.x+g.width)/2-(c.x+c.width/2))<2;
      }).toBe(true);
    };
    await assertFramed();
    await page.setViewportSize({width:width-80,height:height-40});
    await assertFramed();
    await page.setViewportSize({width,height});
    await assertFramed();
    await page.getByRole('button',{name:'Zoom in',exact:true}).click();
    await page.getByRole('button',{name:'Fit',exact:true}).click();
    await assertFramed();
    if(width===1920)await page.screenshot({path:'test-results/design-extract-upload-framing.png'});
  }
});

test("manual cutout stays a secondary tool with explicit selection and review", async ({ page }) => {
  await session(page);
  let project = document([]), job = null, submitted = null;
  const billing = { mode: "paid", priceVersion: "design-extract-v1", prices: { extract: 2, split: 2, segment: 1 }, balance: 5 };
  const cutout = { ...structuredClone(layer), name: "Original artwork cutout", extractionMethod: "source-pixels" };
  await page.route("**/api/design-extract/improvements**", route => {
    const request = route.request();
    if (request.url().endsWith("/sync")) {
      job = { ...job, status: "ready", result: { layers: [cutout], warnings: [] } };
      return route.fulfill({ json: { project, job, billing: { ...billing, balance: 4 } } });
    }
    if (request.method() === "POST") {
      const body = request.postDataJSON();
      if (body.action === "accept") {
        project = { ...project, revision: 1, manifest: { ...project.manifest, layers: [cutout] } };
        job = { ...job, status: "accepted" };
        return route.fulfill({ json: { project, job, billing: { ...billing, balance: 4 } } });
      }
      submitted = body;
      job = { id: "sam-cutout", kind: "segment", status: "queued", creditsRemaining: 4 };
      return route.fulfill({ json: { job } });
    }
    return route.fulfill({ json: { project, job, billing } });
  });
  await page.goto("/design-extract/improvements");
  const extract = page.getByRole("button", { name: "Manual cutout", exact: true });
  await expect(page.getByRole("button", { name: "Extract elements · 2 Claws", exact: true })).toHaveCSS("background-color", "rgb(255, 215, 0)");

  await extract.click();
  expect(submitted).toBeNull();
  const submit = page.getByRole("button", { name: "Extract selection · 1 Claw", exact: true });
  await expect(submit).toBeDisabled();
  await page.getByAltText("Original flat design", { exact: true }).click();
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect.poll(() => submitted?.kind).toBe("segment");
  expect(submitted).toMatchObject({ layerId: null, acknowledgedClaws: 1, priceVersion: "design-extract-v1" });
  expect(submitted.points).toHaveLength(1);
  await page.getByRole("button", { name: "Accept layers", exact: true }).click();
  await expect(page.getByRole("button", { name: "Quick export PSD", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Extract elements · 2 Claws", exact: true })).toHaveCount(0);
  await expect(extract).toBeEnabled();
  await page.screenshot({ path: "test-results/design-extract-economical-cutout.png" });
});

test('composition layers cannot cover underlying artwork with preview backgrounds', async ({page})=>{
 await session(page);
 const items=[{...structuredClone(layer),id:'bottom',name:'Bottom'}, {...structuredClone(layer),id:'top',name:'Top'}];
 await page.route('**/api/design-extract/improvements', route=>route.fulfill({json:{project:document(items),job:null}}));
 await page.goto('/design-extract/improvements');
 await page.getByRole('button',{name:'Composition',exact:true}).click();
 const elements=page.locator('[data-design-element][role="button"]');
 await expect(elements).toHaveCount(2);
 for(const el of await elements.all()){
  await expect(el).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
  await expect(el).toHaveCSS('background-image','none');
  await expect(el).toHaveCSS('outline-style','none');
 }
 await page.getByRole('button',{name:'Overview',exact:true}).click();
 await expect(elements.first()).not.toHaveCSS('background-image','none');
});

test('an unresponsive export worker times out and releases the editor',async({page})=>{
 const bytes=await session(page);
 await page.route('**/api/design-extract/improvements',route=>route.fulfill({json:{project:document([layer]),job:null}}));
 await page.route('**/api/design-extract/improvements/asset?*',route=>route.fulfill({contentType:'image/png',body:bytes}));
 await page.goto('/design-extract/improvements');await page.clock.install();
 await page.evaluate(()=>{window.exportWorkerState={started:0,terminated:0};window.Worker=class{constructor(){window.exportWorkerState.started++;}postMessage(){}terminate(){window.exportWorkerState.terminated++;}};});
 await page.getByRole('button',{name:'Quick export PSD',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>window.exportWorkerState.started)).toBe(1);
 await page.clock.fastForward(120000);
 await expect(page.getByText('Export timed out. Download individual layers or ZIP instead.',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>window.exportWorkerState.terminated)).toBe(1);
 await expect(page.getByRole('button',{name:'Quick export PSD',exact:true})).toBeEnabled();
});

test('leaving during export cancels downloads before a worker can start',async({page})=>{
 const bytes=await session(page);
 await page.addInitScript(()=>{const RealWorker=window.Worker;window.exportWorkerStarts=0;window.Worker=class extends RealWorker{constructor(...args){super(...args);window.exportWorkerStarts++;}};});
 await page.route('**/api/design-extract/improvements',route=>route.fulfill({json:{project:document([layer]),job:null}}));
 let release;const gate=new Promise(resolve=>release=resolve);let started;const assetStarted=new Promise(resolve=>started=resolve);
 await page.route('**/api/design-extract/improvements/asset?*',async route=>{started();await gate;await route.fulfill({contentType:'image/png',body:bytes}).catch(()=>{});});
 await page.goto('/design-extract/improvements');
 const initialWorkers=await page.evaluate(()=>window.exportWorkerStarts);
 await page.getByRole('button',{name:'Quick export PSD',exact:true}).click();await assetStarted;
 const stopped=page.waitForEvent('requestfailed',req=>req.url().includes('/improvements/asset?'));
 await page.getByRole('button',{name:'Go to Home',exact:true}).click();await stopped;release();
 await expect(page).toHaveURL('/');
 expect(await page.evaluate(()=>window.exportWorkerStarts)).toBe(initialWorkers);
});

test('canvas details stay fixed during zoom and pan', async ({ page }) => {
 await session(page);
 await page.route('**/api/design-extract/improvements', route => route.fulfill({json:{project:document([layer]),job:null}}));
 await page.goto('/design-extract/improvements');
 const details=page.locator('[data-canvas-details]');
 await expect(details).toContainText('Source artwork');
 await page.locator('[data-design-element][role="button"]').first().focus();
 await page.keyboard.press('Enter');
 await expect(details).toContainText(layer.name);
 const before=await details.boundingBox();
 for(let i=0;i<6;i++) await page.getByRole('button',{name:'Zoom out',exact:true}).click();
 for(let i=0;i<8;i++) await page.getByRole('button',{name:'Zoom in',exact:true}).click();
 const canvas=page.getByRole('region',{name:'Design canvas'});
 const bounds=await canvas.boundingBox();
 await page.keyboard.down('Space'); await page.mouse.move(bounds.x+100,bounds.y+150); await page.mouse.down(); await page.mouse.move(bounds.x+160,bounds.y+200); await page.mouse.up(); await page.keyboard.up('Space');
 expect(await details.boundingBox()).toEqual(before);
 await expect(page.locator('[data-design-board] figcaption, [data-design-board] [class*="elementLabel"]')).toHaveCount(0);
 await page.screenshot({path:'output/design-extract-fixed-details.png'});
});

test('free processing shows the owned Claw balance and standard costs without beta labels',async({page})=>{
  await session(page);
  const billing={mode:'beta',priceVersion:'design-extract-v1',prices:{extract:2,split:2,segment:1},balance:4};
  await page.route('**/api/design-extract/improvements**',route=>route.fulfill({json:{project:document([]),job:null,billing}}));
  await page.goto('/design-extract/improvements');
  await expect(page.locator('.studio-credit-pill')).toContainText('4');
  await expect(page.getByRole('button',{name:'Extract elements',exact:true})).toContainText('2 Claws');
  await expect(page.locator('.studio-topbar')).not.toContainText('AI operation costs');
  await expect(page.getByLabel('View Claw costs',{exact:true})).toHaveCount(0);
  await expect(page.getByText(/beta/i)).toHaveCount(0);
});

test("paid mode shows prices before AI actions and updates the confirmed balance", async ({ page }) => {
  await session(page);
  let project = document([]), job = null, submitted = null;
  const billing = { mode: "paid", priceVersion: "design-extract-v1", prices: { extract: 2, split: 2, segment: 1 }, balance: 5 };
  await page.route("**/api/design-extract/improvements**", route => {
    if (route.request().url().endsWith("/sync")) {
      project = { ...project, revision: 1, manifest: { ...project.manifest, layers: [structuredClone(layer)] } };
      job = { ...job, status: "accepted" };
      return route.fulfill({ json: { project, job, billing: { ...billing, balance: 3 } } });
    }
    if (route.request().method() === "POST") {
      submitted = route.request().postDataJSON();
      job = { id: "paid-job", status: "queued", kind: "extract", charge_amount: 2, billing_state: "held", creditsRemaining: 3 };
      return route.fulfill({ json: { job } });
    }
    return route.fulfill({ json: { project, job, billing } });
  });
  await page.goto("/design-extract/improvements");
  await expect(page.getByRole("button", { name: "Extract elements · 2 Claws", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Extract elements · 2 Claws", exact: true })).toContainText('2 Claws');
  await expect(page.getByRole("button", { name: "Extract elements · 2 Claws", exact: true })).toHaveCSS("background-color", "rgb(255, 215, 0)");
  await page.getByRole('toolbar',{name:'Design editing tools'}).screenshot({path:'test-results/design-extract-generation-badge.png'});
  await page.getByRole("button", { name: "Manual cutout", exact: true }).click();
  await expect(page.getByRole("button", { name: "Extract selection · 1 Claw", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cancel selection", exact: true }).click();
  await page.getByRole("button", { name: "Extract elements · 2 Claws", exact: true }).click();
  await expect.poll(() => submitted?.acknowledgedClaws).toBe(2);
  expect(submitted.kind).toBe("extract");
  expect(submitted.layerId).toBeNull();
  expect(submitted.points).toBeUndefined();
  await expect(page.getByRole("region", { name: "Selection preview", exact: true })).toHaveCount(0);
  expect(submitted.priceVersion).toBe("design-extract-v1");
  await expect(page.locator(".studio-credit-pill")).toContainText("3");
  await expect(page.getByRole("button", { name: "Quick export PSD", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Select Artwork", exact: true }).click();
  await page.getByRole("button", { name: "Refine layer", exact: true }).click();
  await expect(page.getByRole("button", { name: "Split further · AI · 2 Claws", exact: true })).toBeVisible();
});

test("slow opening stays in editor; animated default, explicit reduced motion, and paused recovery", async ({ page }) => {
  test.setTimeout(65000);
  await session(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  const project = document([]);
  let syncs = 0, submissions = 0;
  await page.route("**/api/design-extract/improvements**", async route => {
    if (route.request().url().endsWith("/sync")) { syncs++; return route.fulfill({ status: 503, json: { error: "Temporary outage" } }); }
    if (route.request().method() === "POST") submissions++;
    await new Promise(resolve => setTimeout(resolve, 1200));
    return route.fulfill({ json: { project, job: { id: "recorded", status: "queued", request_id: "existing" } } });
  });
  await page.goto("/design-extract/improvements", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("region", { name: "Design canvas", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Opening/ })).toHaveCount(0);
  await expect(page.getByText(/Sign in with an authorized/)).toHaveCount(0);
  await expect(page.getByRole("status", { name: "Loading layers" })).toBeVisible();
  const progress = page.getByLabel("Design extraction progress", { exact: true });
  await expect(progress).toBeVisible();
  const transforms = () => progress.locator('[class*="artworkSweep"]').evaluate(element => getComputedStyle(element).transform);
  const first = await transforms();
  const bar = await progress.getByRole("progressbar").locator("span").evaluate(element => getComputedStyle(element).transform);
  const spinner = await progress.locator("svg").evaluate(element => getComputedStyle(element).transform);
  const text = progress.getByRole("status");
  await expect(text).toHaveText("Waiting for AI");
  const textPosition = await text.evaluate(element => getComputedStyle(element).backgroundPosition);
  await page.waitForTimeout(250);
  expect(await transforms()).not.toBe(first);
  expect(await progress.getByRole("progressbar").locator("span").evaluate(element => getComputedStyle(element).transform)).not.toBe(bar);
  expect(await progress.locator("svg").evaluate(element => getComputedStyle(element).transform)).not.toBe(spinner);
  expect(await text.evaluate(element => getComputedStyle(element).backgroundPosition)).not.toBe(textPosition);
  await page.getByLabel("Keyboard shortcuts", { exact: true }).click();
  await page.getByLabel("Reduced Motion", { exact: true }).check();
  await expect(progress.locator('[class*="artworkSweep"]')).toHaveCSS("animation-name", "none");
  await expect(text).toHaveCSS("animation-name", "none");
  await page.getByLabel("Reduced Motion", { exact: true }).uncheck();
  await expect(progress.locator('[class*="artworkSweep"]')).not.toHaveCSS("animation-name", "none");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Resume checking", exact: true })).toBeVisible({ timeout: 40000 });
  await expect(progress).toHaveAttribute("data-paused", "true");
  await expect(text).toHaveCSS("animation-name", "none");
  await expect(page.getByRole("progressbar")).toHaveCount(0);
  expect(syncs).toBe(3); expect(submissions).toBe(0); expect(errors).toEqual([]);
  await page.screenshot({ path: "output/design-extract-paused.png" });
});

test("base and enhanced previews preserve placement and acceptance keeps the chosen version", async ({ page }) => {
  await session(page);
  let project = document([]), accepted = null;
  const base = { url: "https://improvements.test/base.png", width: 40, height: 60 };
  const enlarged = { ...base, url: "https://improvements.test/enhanced.png", width: 80, height: 120 };
  const candidate = { ...layer, ...enlarged, baseVariant: base, enhancedVariant: enlarged, acceptedVersion: "enhanced", composition: { x: 10, y: 20, scale: .5 } };
  let job = { id: "completed", kind: "split", status: "ready", result: { layers: [candidate] } };
  await page.route("**/api/design-extract/improvements", route => {
    if (route.request().method() === "POST") {
      accepted = route.request().postDataJSON();
      project = { ...project, revision: 1, manifest: { ...project.manifest, layers: [selectVariant(candidate, accepted.versions.element)] } };
      job = { ...job, status: "accepted" };
    }
    return route.fulfill({ json: { project, job } });
  });
  await page.goto("/design-extract/improvements");
  await expect(page.getByRole("button", { name: "Accept layers", exact: true })).toBeVisible();
  await page.getByLabel("Version for Artwork", { exact: true }).selectOption("base");
  const element = page.getByRole("button", { name: "Inspect generated Artwork", exact: true });
  await expect(element.locator("img")).toHaveAttribute("src", base.url);
  await page.getByRole("button", { name: "Accept layers", exact: true }).click();
  expect(accepted.versions).toEqual({ element: "base" });
  expect(project.manifest.layers[0]).toMatchObject({ url: base.url, width: 40, height: 60, composition: { x: 10, y: 20, scale: 1 } });
  await page.reload();
  await expect(page.getByRole("button", { name: "Select Artwork", exact: true }).locator("img")).toHaveAttribute("src", base.url);
});

for (const status of [503, 401, 404]) test(`opening ${status} keeps the editor and allows an inline retry`, async ({ page }) => {
  await session(page);
  let fail = true;
  await page.route("**/api/design-extract/improvements", route => fail ? route.fulfill({ status, json: { error: status === 401 ? "Sign in required" : status === 404 ? "Project not found or expired" : "Connection unavailable" } }) : route.fulfill({ json: { project: document([]), job: null } }));
  await page.goto("/design-extract/improvements");
  await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Design canvas", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Extract elements", exact: true })).toBeDisabled();
  await expect(page.getByRole("heading", { name: /Opening/ })).toHaveCount(0);
  fail = false;
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("button", { name: "Extract elements", exact: true })).toBeEnabled();
});

test("clean edges previews native pixels and submits optional cleanup without provider calls", async ({ page }) => {
  await session(page);
  const pixels = Buffer.alloc(40 * 60 * 4);
  pixels.set([255, 255, 255, 255], 0);
  for (let y = 20; y < 40; y++) for (let x = 10; x < 30; x++) pixels.set([35, 85, 140, 255], (y * 40 + x) * 4);
  const fixture = await sharp(pixels, { raw: { width: 40, height: 60, channels: 4 } }).png().toBuffer();
  let maskBody = null;
  await page.route("**/api/upload-url", route => route.fulfill({ json: { uploadUrl: "https://improvements.test/upload", publicUrl: "https://improvements.test/mask.png" } }));
  await page.route("https://improvements.test/upload", route => route.fulfill({ status: 200 }));
  await page.route("**/api/design-extract/improvements**", route => {
    if (route.request().url().includes("/asset")) return route.fulfill({ body: fixture, contentType: "image/png" });
    if (route.request().method() === "PATCH") maskBody = route.request().postDataJSON();
    return route.fulfill({ json: { project: document([structuredClone(layer)]), job: null } });
  });
  await page.goto("/design-extract/improvements");
  await page.getByRole("button", { name: "Select Artwork", exact: true }).click();
  await page.getByRole("button", { name: "Refine mask", exact: true }).click();
  const canvas = page.getByLabel("Mask brush canvas", { exact: true });
  await expect(page.getByRole("button", { name: "Apply mask", exact: true })).toBeEnabled();
  const alpha = () => canvas.evaluate(el => el.getContext("2d").getImageData(0, 0, 1, 1).data[3]);
  expect(await alpha()).toBe(255);
  await page.getByText("Clean edges", { exact: true }).click();
  await page.getByLabel("Remove specks", { exact: true }).selectOption("4");
  await expect.poll(alpha).toBe(0);
  await page.getByRole("button", { name: "Before", exact: true }).click();
  await expect.poll(alpha).toBe(255);
  await page.getByRole("button", { name: "After", exact: true }).click();
  await expect.poll(alpha).toBe(0);
  await page.getByRole("slider", { name: "Defringe", exact: true }).fill("1");
  await page.getByLabel("Remove specks", { exact: true }).selectOption("0");
  await page.getByRole("button", { name: "Before", exact: true }).click();
  await expect.poll(alpha).toBe(255);
  await page.getByLabel("Remove specks", { exact: true }).selectOption("4");
  await expect.poll(alpha).toBe(0);
  await expect(page.getByRole("button", { name: "Apply mask", exact: true })).toBeEnabled();
  await expect(page.getByText("Updating preview…", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: "test-results/design-extract-clean-edges.png" });
  await page.getByRole("button", { name: "Apply mask", exact: true }).click();
  await expect.poll(() => maskBody?.edgeCleanup).toEqual({ defringe: 1, specks: 4 });
  await page.getByRole("button", { name: "Refine mask", exact: true }).click();
  await expect(page.getByRole("button", { name: "Discard changes", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Discard changes", exact: true }).click();
  await expect(canvas).toHaveCount(0);
});

test("selection preview, native brush undo/redo, compare, and revision-checked mask submission", async ({ page }) => {
  const fixture = await session(page);
  let project = document([structuredClone(layer)]), operation = null, maskBody = null, upload = null;
  await page.route("**/api/upload-url", route => route.fulfill({ json: { uploadUrl: "https://improvements.test/upload", publicUrl: "https://improvements.test/mask.png" } }));
  await page.route("https://improvements.test/upload", route => { upload = route.request().postDataBuffer(); return route.fulfill({ status: 200 }); });
  await page.route("**/api/design-extract/improvements**", route => {
    const request = route.request();
    if (request.url().includes("/asset")) return route.fulfill({ body: fixture, contentType: "image/png" });
    if (request.method() === "PATCH") {
      maskBody = request.postDataJSON(); project = { ...project, revision: 1 };
      return route.fulfill({ json: { project } });
    }
    if (request.method() === "POST") { operation = request.postDataJSON(); return route.fulfill({ status: 422, json: { error: "Selection test complete" } }); }
    return route.fulfill({ json: { project, job: null } });
  });
  await page.goto("/design-extract/improvements");
  await page.getByRole("button", { name: "Select Artwork", exact: true }).click();
  await page.getByRole("button", { name: "Refine layer", exact: true }).click();
  await page.getByRole("button", { name: "Extract selected element", exact: true }).click();
  const element = page.getByRole("button", { name: "Select Artwork", exact: true });
  await element.click({ position: { x: 15, y: 20 } });
  expect(operation).toBeNull();
  await page.getByRole("button", { name: "Exclude", exact: true }).click();
  await element.click({ position: { x: 25, y: 30 } });
  await expect(page.locator('[class*="selectionPoint"]')).toHaveCount(2);
  await page.getByRole("button", { name: "Extract selection", exact: true }).click();
  await expect.poll(() => operation?.points?.length).toBe(2);
  expect(operation.points.map(point => point.label)).toEqual([1, 0]);
  await page.getByRole("button", { name: "Cancel selection", exact: true }).click();
  await page.getByRole("button", { name: "Dismiss notification", exact: true }).click();
  await page.getByRole("button", { name: "Refine mask", exact: true }).click();
  const canvas = page.getByLabel("Mask brush canvas", { exact: true });
  await expect(page.getByRole("button", { name: "Apply mask", exact: true })).toBeEnabled();
  const alpha = () => canvas.evaluate(element => element.getContext("2d").getImageData(20, 30, 1, 1).data[3]);
  expect(await alpha()).toBeGreaterThan(0);
  await canvas.click(); expect(await alpha()).toBe(0);
  await page.getByRole("button", { name: "Undo mask", exact: true }).click(); expect(await alpha()).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Redo mask", exact: true }).click(); expect(await alpha()).toBe(0);
  await page.getByRole("button", { name: "Restore", exact: true }).click(); await canvas.click(); expect(await alpha()).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Apply mask", exact: true }).click();
  await expect(canvas).toHaveCount(0);
  expect(maskBody).toMatchObject({ action: "mask", layerId: "element", revision: 0, softness: 0 });
  expect(await sharp(upload).metadata()).toMatchObject({ width: 40, height: 60, format: "png" });
  await page.getByRole("button", { name: "Compare", exact: true }).click();
  await expect(page.getByLabel("Source result comparison", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "100% detail", exact: true }).click();
  await expect.poll(() => page.locator("[data-design-board]").evaluate(element => new DOMMatrix(getComputedStyle(element).transform).a)).toBeCloseTo(1, 3);
  await page.screenshot({ path: "output/design-extract-comparison.png" });
});
