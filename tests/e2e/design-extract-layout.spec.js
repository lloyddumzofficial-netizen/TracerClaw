import {test,expect} from '@playwright/test';
import {loadEnvConfig} from '@next/env';loadEnvConfig(process.cwd());
async function setup(page,count,review=false,status=null){
  const user = { id: "editor-user", email: "admin@test.com", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {} };
  const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  const session = { access_token: `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600, role: "authenticated" })}.test`, refresh_token: "test", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user };
  const reference = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
  await page.addInitScript(({ key, value }) => { document.cookie = `${key}=base64-${value}; path=/; SameSite=Lax`; localStorage.setItem("cookie_consent", "declined"); }, { key: `sb-${reference}-auth-token`, value: encode(session) });
  await page.route("**/auth/v1/**", route => route.fulfill({ json: user }));
  await page.route("**/rest/v1/**", route => route.fulfill({ json: [] }));
  const source = "https://editor-assets.test/source.svg";
  const artwork = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="140"><rect width="100" height="140" fill="#FFD700"/><circle cx="50" cy="70" r="30" fill="#111"/></svg>';
  await page.route("https://editor-assets.test/**", route => route.fulfill({ contentType: "image/svg+xml", body: artwork }));
  let project = { id: "editor-tools", revision: 0, source_url: source, manifest: { version: 1, width: 800, height: 1200, layers: ["Team mark", "Print pattern"].map((name, index) => ({ id: `layer-${index}`, name, url: source, width: 100, height: 140, visible: !index, locked: false, layout: { x: 300 + index * 300, y: 0, scale: 1 }, composition: { x: index * 100, y: 0, scale: 1 } })) } };
  project.manifest.layers = Array.from({length:count},(_,i)=>({id:'layer-'+i,name:'Layer '+(i+1),url:source,width:480,height:832,visible:true,locked:false,layout:{x:300+i%4*260,y:Math.floor(i/4)*300,scale:.3},composition:{x:0,y:0,scale:1.6}}));
  const job = status ? {id:"state-job",status,kind:"split",layer_id:"layer-0",request_id:status==="submitting"?null:"existing-request",error:status==="failed"?"The provider could not complete this extraction. Your original artwork is unchanged.":null} : review ? {id:'layout-review',status:'ready',kind:'split',result:{layers:project.manifest.layers,warnings:['The AI output has a different aspect ratio from your source. Layers are centered without stretching. Check their alignment before accepting.']}} : null;
  if(status === "saving") job.result = { enhancement: { version: 1, items: [{status:"done"},{status:"done"},{status:"queued"},{status:"pending"}] } };
  if(review) project.manifest.layers=[];
  let saves = 0, generations = 0;
  await page.route("**/api/design-extract/editor-tools", route => {
    if (route.request().method() === "PATCH") {
      saves++; project = { ...project, revision: project.revision + 1, manifest: { ...project.manifest, layers: route.request().postDataJSON().layers } };
      return route.fulfill({ json: { project } });
    }
    if (route.request().method() === "POST") { generations++; return route.fulfill({ status: 400, json: { error: "No AI operations expected" } }); }
    return route.fulfill({ json: { project, job } });
  });

 return {get generations(){return generations}, setWarnings(warnings){job.result.warnings=warnings}};
}
for(const count of [4,32]) test('fixed Layers sidebar and canvas inspector fit '+count+' layers',async({page})=>{
 test.setTimeout(90000);const fixture=await setup(page,count);await page.setViewportSize({width:1440,height:1000});await page.goto('/design-extract/editor-tools');
 const sidebar=page.locator('aside').filter({has:page.getByRole('heading',{name:'Layers',exact:true})});
 const list=page.locator('[class*="layerListViewport"]').first();
 await expect(page.getByRole('textbox',{name:'Search layers',exact:true})).toBeVisible();
 await expect(page.locator('.studio-commandbar-shell[data-position="bottom"]')).toBeVisible();
 const barBounds=await page.locator('.studio-commandbar-shell').boundingBox();const canvasBounds=await page.getByRole('region',{name:'Design canvas',exact:true}).boundingBox();expect(barBounds.y).toBeGreaterThan(canvasBounds.y);expect(barBounds.y+barBounds.height).toBeLessThanOrEqual(canvasBounds.y+canvasBounds.height+1);const statusBounds=await page.locator(".studio-statusbar").boundingBox();expect(Math.abs(canvasBounds.y+canvasBounds.height-statusBounds.y)).toBeLessThanOrEqual(1);
 await expect(page.locator('.studio-projectbar')).toHaveCount(0);await expect(page.getByText('Artwork overview',{exact:true})).toHaveCount(0);
 for(const height of [1000,900,800,720,600]){
  await page.setViewportSize({width:1440,height});await page.evaluate(()=>document.fonts.ready);
  await expect.poll(()=>sidebar.evaluate(e=>{const r=e.getBoundingClientRect();return e.scrollHeight<=e.clientHeight+1&&[...e.querySelectorAll('button,input,select')].filter(b=>!b.closest('[data-layer-scroll]')).every(b=>{const v=b.getBoundingClientRect();return !v.height||v.top>=r.top-1&&v.bottom<=r.bottom+1})})).toBe(true);
  await expect(list.getByRole('button')).toHaveCount(count);
  for(const button of await sidebar.locator('[class*="exports"] button').all())await expect(button).toBeInViewport({ratio:1});
  await list.getByRole('button').first().click();
  const inspector=page.locator('[data-design-inspector]');await expect(inspector).toBeVisible();
  await expect(sidebar.getByText('Layer properties',{exact:true})).toHaveCount(0);
  await expect.poll(()=>inspector.evaluate(e=>{const p=e.closest('[role="region"]').getBoundingClientRect(),r=e.getBoundingClientRect();return r.top>=p.top&&r.bottom<=p.bottom+1&&r.right<=p.right})).toBe(true);
  await expect(inspector.getByRole('button',{name:'Download PNG',exact:true})).toBeInViewport({ratio:1});
  const before=await page.locator('[data-design-board]').evaluate(e=>getComputedStyle(e).transform);
  const box=await inspector.boundingBox();await page.mouse.move(box.x+20,box.y+10);await page.mouse.wheel(0,-250);await page.waitForTimeout(120);
  expect(await page.locator('[data-design-board]').evaluate(e=>getComputedStyle(e).transform)).toBe(before);
  await inspector.getByRole('button',{name:'Refine layer',exact:true}).click();await expect(inspector.getByRole('button',{name:'Split further · AI',exact:true})).toBeInViewport({ratio:1});
  await inspector.getByRole('button',{name:'Properties',exact:true}).click();
  if(height===900&&count===4)await page.screenshot({path:'output/design-extract-floating-inspector.png'});
 }
 await expect(list.getByRole('button')).toHaveCount(count);
 const exportsBefore=await sidebar.locator('[class*="exports"]').boundingBox();
 const canvasBefore=await page.locator('[data-design-board]').evaluate(e=>getComputedStyle(e).transform);
 const listBox=await list.boundingBox();await page.mouse.move(listBox.x+listBox.width/2,listBox.y+listBox.height/2);await page.mouse.wheel(0,10000);
 const canScroll=await list.evaluate(e=>e.scrollHeight>e.clientHeight);
 if(canScroll) await expect.poll(()=>list.evaluate(e=>e.scrollTop)).toBeGreaterThan(0);
 else expect(await list.evaluate(e=>e.scrollTop)).toBe(0);
 await expect(list.getByRole('button').last()).toBeInViewport({ratio:1});
 expect(await sidebar.evaluate(e=>e.scrollTop)).toBe(0);
 expect(await sidebar.locator('[class*="exports"]').boundingBox()).toEqual(exportsBefore);
 expect(await page.locator('[data-design-board]').evaluate(e=>getComputedStyle(e).transform)).toBe(canvasBefore);
 expect(fixture.generations).toBe(0);
});
test('extraction review fits without sidebar scrolling',async({page})=>{
 await setup(page,4,true);await page.setViewportSize({width:1440,height:1000});await page.goto('/design-extract/editor-tools');
 const sidebar=page.locator('aside').filter({has:page.getByRole('heading',{name:'Layers',exact:true})});await expect(page.getByRole('heading',{name:'Review extracted layers',exact:true})).toBeVisible();
 for(const height of [1000,800,720,600]){
  await page.setViewportSize({width:1440,height});
  await expect.poll(()=>sidebar.evaluate(e=>e.scrollHeight<=e.clientHeight+1)).toBe(true);
  await expect(page.getByRole('button',{name:'Accept layers',exact:true})).toBeInViewport({ratio:1});await expect(page.getByRole('button',{name:'Discard result',exact:true})).toBeInViewport({ratio:1});
 }
 const seen=new Set();for(let attempts=0;attempts<8;attempts++){
  for(const label of await page.getByRole('button',{name:/^Preview Layer/}).allTextContents())seen.add(label);
  const next=page.getByRole('button',{name:'Next review page',exact:true});if(await next.isDisabled())break;await next.click();
 }
 expect(seen.size).toBe(4);
});

for(const status of ['processing','submitting','failed'])test('sidebar recovery controls fit during '+status,async({page})=>{
 await setup(page,4,false,status);await page.setViewportSize({width:1440,height:600});await page.goto('/design-extract/editor-tools');
 const sidebar=page.locator('aside').filter({has:page.getByRole('heading',{name:'Layers',exact:true})});await expect(sidebar).toBeVisible();await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(150);
 const bounds=await sidebar.evaluate(e=>({client:e.clientHeight,scroll:e.scrollHeight}));console.log(status,bounds);expect(bounds.scroll).toBeLessThanOrEqual(bounds.client+1);
 if(status==='failed'){
  await expect(page.getByRole('button',{name:'Recover existing result',exact:true})).toBeInViewport({ratio:1});
  await page.getByRole('button',{name:'Show saved layers',exact:true}).click();await expect(sidebar.locator('[class*="layerList"] button').first()).toBeVisible();
  await page.getByRole('button',{name:'View extraction issue',exact:true}).click();await expect(page.getByRole('button',{name:'Recover existing result',exact:true})).toBeInViewport({ratio:1});
 }
 if(status==='submitting')await expect(page.getByRole('button',{name:'Reconnect existing request',exact:true})).toBeInViewport({ratio:1});
});

test('automatic enhancement shows progress inside the target artwork and keeps export disabled',async({page})=>{
 const fixture=await setup(page,4,false,"saving");await page.setViewportSize({width:1440,height:600});await page.goto('/design-extract/editor-tools');
 await expect(page.getByRole('region',{name:'Design canvas',exact:true})).toHaveAttribute('aria-busy','true');
 await expect(page.getByRole('status').filter({hasText:'Enhancing your layers'}).first()).toBeVisible();
 await expect(page.getByText('2 of 4 layers finished.',{exact:false})).toBeVisible();
 await expect(page.getByRole('button',{name:'Quick export PSD',exact:true})).toBeDisabled();
 const sidebar=page.locator('aside').filter({has:page.getByRole('heading',{name:'Layers',exact:true})});
 await expect.poll(()=>sidebar.evaluate(e=>e.scrollHeight<=e.clientHeight+1)).toBe(true);
 await page.reload();await expect(page.getByText('2 of 4 layers finished.',{exact:false})).toBeVisible();expect(fixture.generations).toBe(0);
 await page.screenshot({path:'output/design-extract-enhancing.png'});
});

test('multiple enhancement fallbacks remain clear and fit in the review sidebar',async({page})=>{
 const fixture=await setup(page,4,true);fixture.setWarnings([
  'The AI output has a different aspect ratio from your source. Check alignment.',
  ...[1,2,3,4].map(i=>`Layer ${i}: Enhancement could not be confirmed. The original extracted layer was kept.`),
 ]);
 await page.setViewportSize({width:1440,height:600});await page.goto('/design-extract/editor-tools');
 await expect(page.getByText('4 layers kept at original quality. Check alignment.',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Accept layers',exact:true})).toBeInViewport({ratio:1});
 await expect(page.getByRole('button',{name:'Discard result',exact:true})).toBeInViewport({ratio:1});
 const sidebar=page.locator('aside').filter({has:page.getByRole('heading',{name:'Layers',exact:true})});expect(await sidebar.evaluate(e=>e.scrollHeight<=e.clientHeight+1)).toBe(true);
 expect(fixture.generations).toBe(0);
});
