import { expect, test } from "@playwright/test";
import { loadEnvConfig } from "@next/env";
import sharp from "sharp";
loadEnvConfig(process.cwd());
const artwork='<svg xmlns="http://www.w3.org/2000/svg" width="700" height="1000"><rect width="700" height="1000" fill="#142a42"/><path fill="#e8c95b" d="M0 0L160 0 700 840V1000Z"/><path fill="#ddd" d="M0 210L700 730V820L0 300Z"/><text x="130" y="390" fill="white" font-size="72" font-family="Arial">TEAM NAME</text><text x="265" y="580" fill="white" font-size="180" font-family="Arial">23</text></svg>';
async function setup(page, { mode = "mockup_preserve", extracted = true, open = true, enabled = true, sample = artwork, rejection = null, warning = null, initialRevision = 1, serverRevision = initialRevision, storedFailure = false } = {}) {
  await page.setViewportSize({width:1440,height:900});
  const user={id:"edit-test-user",email:"edit@example.test",aud:"authenticated",role:"authenticated",app_metadata:{},user_metadata:{}};
  const encode=value=>Buffer.from(JSON.stringify(value)).toString("base64url");
  const reference=new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
  const session={access_token:`${encode({alg:"HS256",typ:"JWT"})}.${encode({sub:user.id,exp:Math.floor(Date.now()/1000)+3600,role:"authenticated"})}.test`,refresh_token:"test-refresh",token_type:"bearer",expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user};
  await page.addInitScript(({key,value})=>{ Object.defineProperty(navigator,"maxTouchPoints",{get:()=>0});localStorage.setItem("cookie_consent","declined"); document.cookie=`${key}=base64-${value}; path=/; SameSite=Lax`; },{key:`sb-${reference}-auth-token`,value:encode(session)});
  const project={id:"edit-test",user_id:user.id,name:"Artwork edit test",trace_type:mode,ai_prompt:mode === "mockup_erase" ? "ERASE_LOGOS" : "PRESERVE_LOGOS",artwork_revision:initialRevision,created_at:new Date().toISOString(),original_image_url:"https://edit.test/crop_source.svg",generated_image_url:extracted ? "https://edit.test/flat.png" : null,upscaled_image_url:extracted ? "https://edit.test/hd.png" : null,svg_url:null};
  let serverProject={...project,artwork_revision:serverRevision},lastSubmission=null,postAttempts=0,changeOnSubmit=false;
  await page.route("**/auth/v1/**",r=>r.fulfill({json:user}));
  await page.route("**/rest/v1/**",r=>r.fulfill({json:r.request().url().includes("/projects")?project:{credits:10}}));
  await page.route("**/api/proxy?*",r=>r.fulfill({contentType:"image/svg+xml",body:sample}));
  await page.route("**/edit.test/**",r=>r.fulfill({contentType:"image/svg+xml",body:sample}));
  let edit=storedFailure ? {id:"prior-edit",project_id:project.id,base_revision:serverRevision,source_url:serverProject.generated_image_url,status:"refunded",result_url:null,error_code:"EDIT_OUTSIDE_SELECTION",instructions:[{id:1,prompt:"Replace the selected text with DesaynClaw.",shapes:[{kind:"rect",x:.15,y:.3,width:.65,height:.12}]}],created_at:new Date().toISOString()} : null;
  let submissions=0,applies=0,simulatedRejection=rejection,lastRequestKey=null;
  await page.route("**/api/projects/edit-test/artwork-edits**",async route=>{
    const request=route.request();const url=new URL(request.url());
    if(url.pathname.endsWith("/apply")) { applies++;serverProject={...serverProject,artwork_revision:serverProject.artwork_revision+1,generated_image_url:"https://edit.test/edited.png",upscaled_image_url:null,svg_url:null};return route.fulfill({json:{project:serverProject}}); }
    if(request.method()==="POST") {
      const body=request.postDataJSON();lastSubmission=body;postAttempts++;
      if(changeOnSubmit){changeOnSubmit=false;serverProject={...serverProject,artwork_revision:serverProject.artwork_revision+1,generated_image_url:"https://edit.test/new-flat.png",upscaled_image_url:null,svg_url:null};}
      if(body.sourceRevision!==serverProject.artwork_revision || (body.sourceUrl && body.sourceUrl!==serverProject.generated_image_url))return route.fulfill({status:409,json:{code:"SOURCE_CHANGED",error:"SOURCE_CHANGED"}});
      if(lastRequestKey===body.requestKey)return route.fulfill({status:202,json:{edit}});
      submissions++;
      lastRequestKey=body.requestKey;
      edit={id:`edit-${submissions}`,project_id:project.id,base_revision:serverProject.artwork_revision,source_url:serverProject.generated_image_url,status:"processing",instructions:body.instructions,created_at:new Date().toISOString()};
      return route.fulfill({status:202,json:{edit}});
    }
    if(edit && url.pathname.endsWith(`/${edit.id}`)) { edit=simulatedRejection ? {...edit,status:"refunded",result_url:null,error_code:simulatedRejection} : {...edit,status:"ready",result_url:"https://edit.test/edited.png",error_code:warning}; return route.fulfill({json:{edit}}); }
    return route.fulfill({json:{enabled,project:serverProject,edits:edit?[edit]:[]}});
  });
  await page.goto("/workspace/edit-test");
  if (open) await page.getByRole("button",{name:"Edit artwork",exact:true}).click();
  return {project,get submissions(){return submissions;},get applies(){return applies;},get lastSubmission(){return lastSubmission;},get postAttempts(){return postAttempts;},allowSuccess(){simulatedRejection=null;},changeSource(){serverProject={...serverProject,artwork_revision:serverProject.artwork_revision+1,generated_image_url:"https://edit.test/new-flat.png",upscaled_image_url:null,svg_url:null};},bumpRevision(){serverProject={...serverProject,artwork_revision:serverProject.artwork_revision+1};},changeOnNextSubmit(){changeOnSubmit=true;}};
}
async function rectangle(page, y = .3) {
  const image=page.getByAltText("Artwork to edit",{exact:true});await expect(image).toBeVisible();
  const b=await image.boundingBox();
  await page.mouse.move(b.x+b.width*.15,b.y+b.height*y);await page.mouse.down();await page.mouse.move(b.x+b.width*.8,b.y+b.height*(y+.12),{steps:8});await page.mouse.up();
}

async function expectVisibleOutlineMotion(button, label) {
  const before=await sharp(await button.screenshot({animations:"allow"})).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  await expect.poll(async()=>{
    const after=await sharp(await button.screenshot({animations:"allow"})).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    if(before.info.width!==after.info.width || before.info.height!==after.info.height) return 0;
    let changed=0;const {width,height}=before.info;
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      if(x>=4 && x<width-4 && y>=4 && y<height-4)continue;
      const p=(y*width+x)*4;
      if(Math.abs(before.data[p]-after.data[p])+Math.abs(before.data[p+1]-after.data[p+1])+Math.abs(before.data[p+2]-after.data[p+2])>60)changed++;
    }
    return changed;
  },{message:`Visible rainbow pixels must move: ${label}`,timeout:6000,intervals:[250,500,1000]}).toBeGreaterThan(40);
}
test("area instructions require confirmation, produce a separate preview, and apply explicitly",async({page})=>{
  const state=await setup(page);
  await rectangle(page);
  await page.getByLabel("Area instruction 1",{exact:true}).fill("Remove TEAM NAME and continue the blue background.");
  await page.getByRole("button",{name:"Save instruction",exact:true}).click();
  await page.screenshot({path:"test-results/artwork-edit-comment.png"});
  await page.getByRole("button",{name:"Review edits",exact:true}).click();
  await expect(page.getByText("Confirm your instructions",{exact:true})).toBeVisible();
  expect(state.submissions).toBe(0);expect(state.applies).toBe(0);
  await page.screenshot({path:"test-results/artwork-edit-confirm.png"});
  await page.getByRole("button",{name:"Generate edit · 1 Claw",exact:true}).click();
  await expect(page.getByRole("button",{name:"Apply edit",exact:true})).toBeVisible({timeout:20000});
  expect(state.submissions).toBe(1);expect(state.applies).toBe(0);
  await expect(page.getByText("Before · Original",{exact:true})).toBeVisible();
  await expect(page.getByText("After · Edited",{exact:true})).toBeVisible();
  const slider=page.getByRole("slider",{name:"Compare original and edited artwork",exact:true});
  const bounds=await slider.boundingBox();
  await page.mouse.move(bounds.x+bounds.width*.5,bounds.y+bounds.height*.5);
  await page.mouse.down();await page.mouse.move(bounds.x+bounds.width*.75,bounds.y+bounds.height*.5,{steps:6});await page.mouse.up();
  await expect(slider).toHaveValue("75");
  await slider.focus();await page.keyboard.press("Home");await expect(slider).toHaveValue("0");
  await expect(page.getByAltText("Edited artwork preview",{exact:true})).toHaveAttribute("style",/inset\(0(?:px)? 0(?:px)? 0(?:px)? 0%\)/);
  await page.keyboard.press("End");await expect(slider).toHaveValue("100");
  await expect(page.getByAltText("Edited artwork preview",{exact:true})).toHaveAttribute("style",/100%/);
  await page.keyboard.press("ArrowLeft");await expect(slider).toHaveValue("99");
  await slider.fill("50");
  await page.screenshot({path:"test-results/artwork-garment-style-comparison.png"});
  const previewSize=await page.getByAltText("Artwork to edit",{exact:true}).boundingBox();
  await page.getByLabel("Inspect edited area",{exact:true}).selectOption("1");
  await expect.poll(async()=>(await page.getByAltText("Artwork to edit",{exact:true}).boundingBox()).width).toBeGreaterThan(previewSize.width);
  await page.getByRole("slider",{name:"Compare original and edited artwork",exact:true}).fill("75");
  await expect(page.getByAltText("Edited artwork preview",{exact:true})).toHaveAttribute("style",/inset\(0(?:px)? 0(?:px)? 0(?:px)? 75%\)/);
  await expect(slider).toHaveAttribute("aria-valuetext","75% Before, 25% After");
  await page.getByRole("checkbox",{name:"Compare with original",exact:true}).uncheck();
  await expect(slider).toHaveCount(0);
  await expect(page.getByAltText("Edited artwork preview",{exact:true})).toHaveAttribute("style",/clip-path: none/);
  await page.getByRole("checkbox",{name:"Compare with original",exact:true}).check();
  await expect(slider).toHaveValue("75");
  await page.getByLabel("Inspect edited area",{exact:true}).selectOption("");
  await page.getByRole("button",{name:"Close artwork editor"}).click();
  await page.getByRole("button",{name:"Edit artwork",exact:true}).click();
  await expect(page.getByRole("button",{name:"Apply edit",exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Apply edit",exact:true}).click();
  await expect(page.getByRole("dialog",{name:"Edit artwork",exact:true})).toHaveCount(0);
  expect(state.applies).toBe(1);
});

test("a rejected boundary-spilling edit explains its refund and cannot be applied",async({page})=>{
  const state=await setup(page,{rejection:"EDIT_OUTSIDE_SELECTION"});
  await rectangle(page);
  await page.getByLabel("Area instruction 1",{exact:true}).fill("Recolor the letters red without moving them.");
  await page.getByRole("button",{name:"Save instruction",exact:true}).click();
  await page.getByRole("button",{name:"Review edits",exact:true}).click();
  await page.getByRole("button",{name:"Generate edit · 1 Claw",exact:true}).click();
  await expect(page.getByText(/We rejected this preview to avoid a cropped or misaligned edit/)).toBeVisible();
  await expect(page.getByText(/Your Claw has been refunded. Your source artwork is unchanged/)).toBeVisible();
  await expect(page.getByRole("button",{name:"Apply edit",exact:true})).toHaveCount(0);
  expect(state.submissions).toBe(1);expect(state.applies).toBe(0);
  const oldKey=state.lastSubmission.requestKey;
  await expect(page.getByRole("heading",{name:"Edit not applied",exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:"Generate edit · 1 Claw",exact:true})).toHaveCount(0);
  await page.getByRole("button",{name:"Close artwork editor",exact:true}).click();
  await page.getByRole("button",{name:"Edit artwork",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Edit not applied",exact:true})).toBeVisible();
  expect(state.submissions).toBe(1);
  await page.getByRole("button",{name:"Review instructions",exact:true}).click();
  await expect(page.getByLabel("Instruction 1",{exact:true})).toHaveValue("Recolor the letters red without moving them.");
  await expect(page.locator('[data-selection-outline="1"]')).toBeVisible();
  await page.getByRole("button",{name:"Review edits",exact:true}).click();
  expect(state.submissions).toBe(1);
  state.allowSuccess();
  await page.getByRole("button",{name:"Generate edit · 1 Claw",exact:true}).click();
  await expect(page.getByRole("button",{name:"Apply edit",exact:true})).toBeVisible();
  expect(state.submissions).toBe(2);expect(state.lastSubmission.requestKey).not.toBe(oldKey);
});

test("a boundary warning keeps the preview visible and requires review again after reopening",async({page})=>{
  const state=await setup(page,{warning:"EDIT_BOUNDARY_REVIEW"});
  await rectangle(page);
  await page.getByLabel("Area instruction 1",{exact:true}).fill("Replace the selected text with Desaynclaw. Match its style and position.");
  await page.getByRole("button",{name:"Save instruction",exact:true}).click();
  await page.getByRole("button",{name:"Review edits",exact:true}).click();
  await expect(page.getByText(/including one that needs correction or is discarded/)).toBeVisible();
  await page.getByRole("button",{name:"Generate edit · 1 Claw",exact:true}).click();
  await expect(page.getByRole("status",{name:"Preview edge warning"})).toBeVisible();
  await expect(page.getByAltText("Edited artwork preview",{exact:true})).toBeVisible();
  const apply=page.getByRole("button",{name:"Apply edit",exact:true});
  await expect(apply).toBeDisabled();
  expect(state.submissions).toBe(1);expect(state.applies).toBe(0);
  await page.getByRole("checkbox",{name:"I checked the spelling and selection edges."}).check();
  await expect(apply).toBeEnabled();
  await page.getByRole("button",{name:"Close artwork editor",exact:true}).click();
  await page.getByRole("button",{name:"Edit artwork",exact:true}).click();
  await expect(apply).toBeDisabled();
  await expect(page.getByRole("status",{name:"Preview edge warning"})).toBeVisible();
  await page.screenshot({path:"test-results/artwork-preview-edge-warning.png"});
  await page.getByRole("checkbox",{name:"I checked the spelling and selection edges."}).check();
  await apply.click();
  await expect(page.getByRole("dialog",{name:"Edit artwork",exact:true})).toHaveCount(0);
  expect(state.applies).toBe(1);expect(state.submissions).toBe(1);
});

test("reopening a stored failed generation shows its reason and refund without silently generating again",async({page})=>{
  const state=await setup(page,{storedFailure:true});
  await expect(page.getByRole("heading",{name:"Edit not applied",exact:true})).toBeVisible();
  await expect(page.getByText("Your Claw has been refunded. Your source artwork is unchanged.",{exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:"Generate edit · 1 Claw",exact:true})).toHaveCount(0);
  await page.screenshot({path:"test-results/artwork-restored-refund-status.png"});
  expect(state.submissions).toBe(0);expect(state.applies).toBe(0);
});

test("fresh extraction with an outdated browser revision can edit without a page reload",async({page})=>{
  const state=await setup(page,{initialRevision:0,serverRevision:1});
  await rectangle(page);
  await page.getByLabel("Area instruction 1",{exact:true}).fill("Make the lettering red.");
  await page.getByRole("button",{name:"Save instruction",exact:true}).click();
  await page.getByRole("button",{name:"Review edits",exact:true}).click();
  await page.getByRole("button",{name:"Generate edit · 1 Claw",exact:true}).click();
  await expect(page.getByRole("button",{name:"Apply edit",exact:true})).toBeVisible();
  expect(state.lastSubmission.sourceRevision).toBe(1);
  expect(state.submissions).toBe(1);
});

test("a real source change refreshes the image and blocks submission without losing the previous draft",async({page})=>{
  const state=await setup(page);await rectangle(page);
  await page.getByLabel("Area instruction 1",{exact:true}).fill("Keep this instruction while checking the latest source.");
  await page.getByRole("button",{name:"Save instruction",exact:true}).click();
  await page.getByRole("button",{name:"Review edits",exact:true}).click();
  state.changeSource();
  await page.getByRole("button",{name:"Generate edit · 1 Claw",exact:true}).click();
  await expect(page.getByRole("dialog",{name:"Edit artwork",exact:true}).getByRole("alert")).toContainText("updated");
  expect(state.submissions).toBe(0);expect(state.lastSubmission).toBe(null);
  await expect(page.getByAltText("Artwork to edit",{exact:true})).toHaveAttribute("src",/new-flat/);
  expect(await page.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith('artwork-edit:v1:')).map(key=>JSON.parse(localStorage.getItem(key))).some(value=>value.instructions?.some(item=>item.prompt==='Keep this instruction while checking the latest source.')))).toBe(true);
});

test("a revision-only refresh keeps the same-image selection and saved instruction for review",async({page})=>{
  const state=await setup(page);await rectangle(page);
  await page.getByLabel("Area instruction 1",{exact:true}).fill("Make the lettering black, keeping the same position.");
  await page.getByRole("button",{name:"Save instruction",exact:true}).click();
  await page.getByRole("button",{name:"Review edits",exact:true}).click();
  state.bumpRevision();
  await page.getByRole("button",{name:"Generate edit · 1 Claw",exact:true}).click();
  await expect(page.getByRole("dialog",{name:"Edit artwork",exact:true}).getByRole("alert")).toContainText("Your selections are kept");
  expect(state.postAttempts).toBe(0);
  await expect(page.locator('[data-instruction-id="1"]')).toHaveAttribute("data-status","Saved");
  await expect(page.locator('[data-selection-outline="1"]')).toBeVisible();
  await page.getByRole("button",{name:"Review edits",exact:true}).click();
  await page.getByRole("button",{name:"Generate edit · 1 Claw",exact:true}).click();
  await expect(page.getByRole("button",{name:"Apply edit",exact:true})).toBeVisible();
  expect(state.submissions).toBe(1);expect(state.lastSubmission.sourceRevision).toBe(2);
  expect(state.lastSubmission.instructions[0].prompt).toBe("Make the lettering black, keeping the same position.");
});

test("a source race at the paid POST refreshes once and never resubmits automatically",async({page})=>{
  const state=await setup(page);await rectangle(page);
  await page.getByLabel("Area instruction 1",{exact:true}).fill("Make the lettering black.");
  await page.getByRole("button",{name:"Save instruction",exact:true}).click();
  await page.getByRole("button",{name:"Review edits",exact:true}).click();
  state.changeOnNextSubmit();
  await page.getByRole("button",{name:"Generate edit · 1 Claw",exact:true}).click();
  await expect(page.getByRole("dialog",{name:"Edit artwork",exact:true}).getByRole("alert")).toContainText("updated");
  await expect(page.getByAltText("Artwork to edit",{exact:true})).toHaveAttribute("src",/new-flat/);
  expect(state.postAttempts).toBe(1);expect(state.submissions).toBe(0);expect(state.applies).toBe(0);
});
test("five instruction limit, brush erase, drafts, and keyboard interaction",async({page})=>{
  await setup(page);await rectangle(page);
  await page.getByLabel("Area instruction 1",{exact:true}).fill("Change the text to DESAYNCLAW.");
  await page.getByRole("button",{name:"Brush",exact:true}).click();
  let b=await page.getByAltText("Artwork to edit",{exact:true}).boundingBox();
  await page.mouse.move(b.x+b.width*.5,b.y+b.height*.65);await page.mouse.down();await page.mouse.move(b.x+b.width*.6,b.y+b.height*.65,{steps:8});await page.mouse.up();
  await page.getByRole("button",{name:"Erase selection",exact:true}).click();
  await page.mouse.move(b.x+b.width*.5,b.y+b.height*.65);await page.mouse.down();await page.mouse.up();
  for(let n=2;n<=5;n++) await page.getByRole("button",{name:"Add instruction",exact:true}).click();
  await expect(page.getByRole("button",{name:"Add instruction",exact:true})).toBeDisabled();
  await page.screenshot({path:"test-results/artwork-edit-instructions.png"});
  await page.keyboard.press("Escape");
  await page.getByRole("button",{name:"Edit artwork",exact:true}).click();
  await expect(page.getByText("5/5",{exact:true})).toBeVisible();
  await expect(page.getByLabel("Instruction 1",{exact:true})).toHaveValue("Change the text to DESAYNCLAW.");
  await page.getByRole("button",{name:"Review edits",exact:true}).click();
  await expect(page.getByRole("dialog",{name:"Edit artwork",exact:true}).getByRole("alert")).toContainText("Instruction 2");
});

test("sidebar edit button has a clockwise rainbow outline and white SVG-style centre", async ({ page }) => {
  await setup(page,{open:false});
  const sidebar=page.locator(".workspace-properties-panel");
  const button=sidebar.getByRole("button",{name:"Edit artwork",exact:true});
  await expect(button).toBeEnabled();
  const gradient=await button.evaluate(el=>getComputedStyle(el).backgroundImage);
  expect(gradient).toContain("conic-gradient");
  const centre=await button.locator('.pp-edit-artwork-label').evaluate(el=>({background:getComputedStyle(el).backgroundImage,color:getComputedStyle(el).color}));
  expect(centre.background).toContain('linear-gradient(rgb(255, 255, 255), rgb(226, 227, 228))');
  expect(centre.color).toBe('rgb(9, 10, 11)');
  expect(await button.evaluate(el=>getComputedStyle(el).animationName)).toContain('aiOutlineOrbit');
  const angle=await button.evaluate(el=>getComputedStyle(el).getPropertyValue('--edit-ai-angle'));
  await expect.poll(()=>button.evaluate(el=>getComputedStyle(el).getPropertyValue('--edit-ai-angle'))).not.toBe(angle);
  await expectVisibleOutlineMotion(button,'Edit artwork, standard motion');
  await page.emulateMedia({reducedMotion:'reduce'});
  expect(await button.evaluate(el=>getComputedStyle(el).animationDuration)).toBe('4s');
  expect(await button.evaluate(el=>getComputedStyle(el).animationIterationCount)).toBe('infinite');
  await expectVisibleOutlineMotion(button,'Edit artwork, reduced motion');
  await page.emulateMedia({reducedMotion:'no-preference'});
  for (const height of [900,768]) {
    await page.setViewportSize({width:1440,height});
    const box=await sidebar.boundingBox();
    const agent=await sidebar.locator(".pp-agent-card").boundingBox();
    expect(agent.y+agent.height,`agent card at ${height}px`).toBeLessThanOrEqual(box.y+box.height+1);
  }
  await page.setViewportSize({width:1440,height:900});
  await page.screenshot({path:"test-results/artwork-sidebar-ready.png"});
});

test("sidebar edit button is grey until flat extraction completes", async ({ page }) => {
  await setup(page,{open:false,extracted:false});
  const close=page.getByRole("button",{name:"Close crop modal",exact:true});
  if (await close.isVisible()) await close.click();
  const button=page.locator(".workspace-properties-panel").getByRole("button",{name:"Edit artwork",exact:true});
  await expect(button).toBeDisabled();
  expect(await button.evaluate(el=>getComputedStyle(el).animationName)).not.toContain('aiOutlineOrbit');
  await expect(button).toHaveAttribute("title","Available after flat extraction finishes");
});

test("Clean Pattern Only has no artwork editor entry", async ({ page }) => {
  await setup(page,{mode:"mockup_erase",open:false});
  await expect(page.locator(".workspace-properties-panel")).toBeVisible();
  await expect(page.getByRole("button",{name:"Edit artwork",exact:true})).toHaveCount(0);
});

test("disabled feature remains visible but cannot submit editing jobs", async ({ page }) => {
  await setup(page,{open:false,enabled:false});
  await expect(page.getByRole("button",{name:"Edit artwork",exact:true})).toBeDisabled();
});

test("redrawing uses one region, exposes real resize handles, and undo restores it", async ({ page }) => {
  const state=await setup(page);
  await rectangle(page);
  await page.getByRole("button",{name:"Close comment box",exact:true}).click();
  const image=await page.getByAltText("Artwork to edit",{exact:true}).boundingBox();
  for(let n=0;n<8;n++){
    await page.mouse.move(image.x+image.width*(n%2 ? .2 : .1),image.y+image.height*(n%2 ? .28 : .22));
    await page.mouse.down();await page.mouse.move(image.x+image.width*(.5+n*.02),image.y+image.height*.4,{steps:3});await page.mouse.up();
    await page.getByRole("button",{name:"Close comment box",exact:true}).click();
  }
  await expect(page.locator('[data-selection-outline]')).toHaveCount(1);
  const values=await page.evaluate(()=>{
    const key=Object.keys(localStorage).find(key=>key.startsWith('artwork-edit:v1:'));
    return JSON.parse(localStorage.getItem(key)).instructions;
  });
  expect(values).toHaveLength(1);expect(values[0].shapes).toHaveLength(1);
  const handle=page.locator('[data-selection-handle="se"]');
  const before=await handle.boundingBox();
  await handle.hover();await page.mouse.down();await page.mouse.move(before.x+before.width/2-35,before.y+before.height/2-20,{steps:5});await page.mouse.up();
  await page.getByRole("button",{name:"Close comment box",exact:true}).click();
  const after=await handle.boundingBox();expect(after.x).toBeLessThan(before.x-25);
  await page.getByRole("button",{name:"Undo",exact:true}).click();
  const restored=await handle.boundingBox();expect(restored.x).toBeCloseTo(before.x,0);
  await page.getByLabel("Instruction 1",{exact:true}).fill("Remove the selected text.");
  await page.screenshot({path:"test-results/artwork-selection-refined.png"});
  expect(state.submissions).toBe(0);
  await page.getByRole("button",{name:"Clear area",exact:true}).click();
  await expect(page.locator('[data-selection-outline]')).toHaveCount(0);
});

test("Save instruction and Review edits share the animated white AI outline", async ({ page }) => {
  await setup(page);await rectangle(page);
  await page.getByLabel("Area instruction 1",{exact:true}).fill("Remove this text and restore the background.");
  for (const name of ["Save instruction","Review edits"]) {
    const button=page.getByRole("button",{name,exact:true});
    await expect(button).toBeEnabled();
    expect(await button.evaluate(el=>getComputedStyle(el).backgroundImage)).toContain('conic-gradient');
    expect(await button.evaluate(el=>getComputedStyle(el).animationName)).toContain('aiOutlineOrbit');
    const angle=await button.evaluate(el=>getComputedStyle(el).getPropertyValue('--edit-ai-angle'));
    await expect.poll(()=>button.evaluate(el=>getComputedStyle(el).getPropertyValue('--edit-ai-angle'))).not.toBe(angle);
    await expectVisibleOutlineMotion(button,`${name}, standard motion`);
    await page.emulateMedia({reducedMotion:'reduce'});
    expect(await button.evaluate(el=>getComputedStyle(el).animationDuration)).toBe('4s');
    expect(await button.evaluate(el=>getComputedStyle(el).animationIterationCount)).toBe('infinite');
    await expectVisibleOutlineMotion(button,`${name}, reduced motion`);
    await page.emulateMedia({reducedMotion:'no-preference'});
  }
  await page.screenshot({path:'test-results/artwork-ai-outline-actions.png'});
  await page.getByRole("button",{name:"Save instruction",exact:true}).click();
  await page.getByRole("button",{name:"Review edits",exact:true}).click();
  await expect(page.getByText("Confirm your instructions",{exact:true})).toBeVisible();
});

test("instruction composer stays inside the canvas after drawing at the edge and resizing", async ({ page }) => {
  const state=await setup(page);
  const image=await page.getByAltText("Artwork to edit",{exact:true}).boundingBox();
  await page.mouse.move(image.x+image.width*.7,image.y+image.height*.8);
  await page.mouse.down();
  await page.mouse.move(image.x+image.width*.97,image.y+image.height*.97,{steps:5});
  await page.mouse.up();
  const composer=page.getByRole("region",{name:"Instruction 1 editor",exact:true});
  const prompt=page.getByLabel("Area instruction 1",{exact:true});
  await expect(prompt).toBeFocused();
  await prompt.fill("Remove the selected text and continue the surrounding pattern.");
  for(const height of [900,768]) {
    await page.setViewportSize({width:1366,height});
    await expect.poll(()=>composer.evaluate(node=>{
      const box=node.getBoundingClientRect(),canvas=node.parentElement.getBoundingClientRect();
      return box.left>=canvas.left+11 && box.right<=canvas.right-11 && box.top>=canvas.top+11 && box.bottom<=canvas.bottom-11;
    })).toBe(true);
  }
  expect(await prompt.evaluate(node=>getComputedStyle(node).outlineStyle)).toBe("none");
  await page.screenshot({path:"test-results/artwork-composer-refined.png"});
  await page.getByRole("button",{name:"Close comment box",exact:true}).click();
  await expect(composer).toHaveCount(0);
  await expect(page.getByLabel("Instruction 1",{exact:true})).toHaveValue("Remove the selected text and continue the surrounding pattern.");
  expect(state.submissions).toBe(0);
});

test("selection can move, resize an edge, undo, and use shortcuts without changing typed instructions", async ({ page }) => {
  const state=await setup(page);await rectangle(page);
  await expect(page.locator('[data-selection-handle]')).toHaveCount(8);
  await page.getByRole("button",{name:"Change colour",exact:true}).click();
  const prompt=page.getByLabel("Area instruction 1",{exact:true});
  await expect(prompt).toHaveValue(/\[colour\]/);
  await prompt.press("b");
  await expect(page.getByRole("button",{name:"Rectangle",exact:true})).toHaveAttribute("aria-pressed","true");
  await prompt.fill("Make the selected lettering black. Keep its shape.");
  await prompt.press("Escape");
  const readShape=()=>page.evaluate(()=>JSON.parse(localStorage.getItem(Object.keys(localStorage).find(key=>key.startsWith("artwork-edit:v1:")))).instructions[0].shapes[0]);
  const before=await readShape();
  const image=await page.getByAltText("Artwork to edit",{exact:true}).boundingBox();
  await page.mouse.move(image.x+image.width*(before.x+before.width/2),image.y+image.height*(before.y+before.height/2));
  await page.mouse.down();await page.mouse.move(image.x+image.width*(before.x+before.width/2+.03),image.y+image.height*(before.y+before.height/2+.1),{steps:8});await page.mouse.up();
  await page.getByRole("button",{name:"Close comment box",exact:true}).click();
  const moved=await readShape();
  expect(moved.x).toBeCloseTo(before.x+.03,2);expect(moved.y).toBeCloseTo(before.y+.1,2);
  expect(moved.width).toBe(before.width);expect(moved.height).toBe(before.height);
  const edge=await page.locator('[data-selection-handle="e"]').boundingBox();
  await page.mouse.move(edge.x+edge.width/2,edge.y+edge.height/2);await page.mouse.down();
  await page.mouse.move(edge.x+edge.width/2-25,edge.y+edge.height/2+30,{steps:6});await page.mouse.up();
  await page.getByRole("button",{name:"Close comment box",exact:true}).click();
  const resized=await readShape();
  expect(resized.width).toBeLessThan(moved.width-.04);expect(resized.height).toBeCloseTo(moved.height,5);expect(resized.y).toBe(moved.y);
  await page.getByRole("button",{name:"Rectangle",exact:true}).focus();
  await page.keyboard.press("Control+z");expect((await readShape()).width).toBe(moved.width);
  await page.keyboard.press("b");await expect(page.getByRole("button",{name:"Brush",exact:true})).toHaveAttribute("aria-pressed","true");
  await page.keyboard.press("r");await expect(page.getByRole("button",{name:"Rectangle",exact:true})).toHaveAttribute("aria-pressed","true");
  await page.getByRole("button",{name:"Edit instruction 1",exact:true}).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog",{name:"Edit artwork",exact:true})).toBeVisible();
  await expect(page.getByRole("region",{name:"Instruction 1 editor",exact:true})).toHaveCount(0);
  expect(state.submissions).toBe(0);
});

test("saving advances automatically through five instructions without a sidebar click", async ({ page }) => {
  const state=await setup(page);
  for(let id=1;id<=5;id++) {
    await rectangle(page,.04+(id-1)*.18);
    await page.getByLabel(`Area instruction ${id}`,{exact:true}).fill(`Change area ${id} to black.`);
    await page.getByRole("button",{name:"Save instruction",exact:true}).click();
    await expect(page.getByRole("region",{name:`Instruction ${id} editor`,exact:true})).toHaveCount(0);
  }
  await expect(page.getByRole("button",{name:"Add instruction",exact:true})).toBeDisabled();
  await expect(page.getByRole("dialog",{name:"Edit artwork",exact:true}).getByRole("status")).toContainText("All five instructions are ready");
  const items=await page.evaluate(()=>JSON.parse(localStorage.getItem(Object.keys(localStorage).find(key=>key.startsWith("artwork-edit:v1:")))).instructions);
  expect(items).toHaveLength(5);
  expect(items.every(item=>item.shapes.length===1)).toBe(true);
  await page.screenshot({path:"test-results/artwork-auto-next-sidebar.png"});
  await page.getByRole("button",{name:"Review edits",exact:true}).click();
  await expect(page.getByText("Confirm your instructions",{exact:true})).toBeVisible();
  expect(state.submissions).toBe(0);
});

test("one saved instruction can be reviewed without submitting the empty automatic next slot", async ({ page }) => {
  const state=await setup(page);await rectangle(page);
  await page.getByLabel("Area instruction 1",{exact:true}).fill("Remove the selected lettering.");
  await page.getByLabel("Area instruction 1",{exact:true}).press("Control+Enter");
  await expect(page.getByText("Selection 02",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Review edits",exact:true}).click();
  await expect(page.getByText("Confirm your instructions",{exact:true})).toBeVisible();
  await expect(page.getByRole("dialog",{name:"Edit artwork",exact:true}).getByRole("alert")).toHaveCount(0);
  await page.getByRole("button",{name:"Generate edit · 1 Claw",exact:true}).click();
  await expect(page.getByRole("button",{name:"Apply edit",exact:true})).toBeVisible({timeout:20000});
  expect(state.submissions).toBe(1);
});

test("saved selection borders retain black and white contrast on light, dark, bright and patterned artwork at different zooms", async ({ page }) => {
  const colours=["#fff","#08090a","#ffdd00","#f02727","#00a89b"];
  const sample=`<svg xmlns="http://www.w3.org/2000/svg" width="700" height="1000"><defs><pattern id="busy" width="12" height="12" patternUnits="userSpaceOnUse"><rect width="12" height="12" fill="#111"/><path d="M0 0H6V6H0ZM6 6H12V12H6Z" fill="white"/></pattern></defs>${[...colours,"url(#busy)"].map((colour,i)=>`<rect y="${i*1000/6}" width="700" height="${1000/6+1}" fill="${colour}"/>`).join("")}</svg>`;
  const state=await setup(page,{sample});
  const image=page.getByAltText("Artwork to edit",{exact:true});
  await expect.poll(()=>image.evaluate(node=>node.naturalWidth)).toBe(700);
  const initial=await image.boundingBox();
  await page.mouse.move(initial.x+initial.width*.2,initial.y+initial.height*.03);await page.mouse.down();
  await page.mouse.move(initial.x+initial.width*.7,initial.y+initial.height*.97,{steps:10});await page.mouse.up();
  await expect(page.getByRole("button",{name:"Edit instruction 1",exact:true})).toContainText("Editing");
  await page.getByLabel("Area instruction 1",{exact:true}).fill("Change only this area.");
  await page.getByRole("button",{name:"Save instruction",exact:true}).click();
  await expect(page.getByRole("button",{name:"Edit instruction 1",exact:true})).toContainText("Saved");
  for (const zoom of [100,75]) {
    if(zoom===75)await page.getByRole("dialog",{name:"Edit artwork",exact:true}).getByRole("button",{name:"Zoom out",exact:true}).click();
    const viewport=page.locator('[data-artwork-viewport]');
    const bounds=await image.boundingBox(),container=await viewport.boundingBox();
    const pixels=await sharp(await viewport.screenshot()).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    const outline=await page.locator('[data-selection-outline="1"]').boundingBox();
    const x=Math.round(outline.x-container.x);
    for(let band=0;band<6;band++) {
      const y=Math.round(bounds.y+bounds.height*(band+.5)/6-container.y);
      let light=0,dark=0;
      for(let dy=-10;dy<=10;dy++)for(let dx=-4;dx<=4;dx++) {
        const offset=((y+dy)*pixels.info.width+x+dx)*4;
        const rgb=[pixels.data[offset],pixels.data[offset+1],pixels.data[offset+2]];
        // Thin subpixel strokes are antialiased at reduced zoom; require a
        // clearly light rendered edge rather than only fully white pixels.
        if(rgb.every(value=>value>110))light++;
        if(rgb.every(value=>value<100))dark++;
      }
      expect(light,`white contrast, band ${band}, zoom ${zoom}`).toBeGreaterThan(5);
      expect(dark,`black contrast, band ${band}, zoom ${zoom}`).toBeGreaterThan(5);
    }
    await page.screenshot({path:`test-results/artwork-selection-contrast-${zoom}.png`});
  }
  expect(state.submissions).toBe(0);
});

test("hairline marching ants visibly move in normal and reduced motion without changing geometry", async ({ page }) => {
  await setup(page);await rectangle(page);
  await page.getByLabel("Area instruction 1",{exact:true}).fill("Keep this area unchanged.");
  await page.getByRole("button",{name:"Save instruction",exact:true}).click();
  const line=page.locator('[data-selection-outline="1"] > rect').nth(1);
  const before=await line.boundingBox();
  expect(await line.getAttribute("stroke-width")).toBe("1");
  for(const reducedMotion of ["no-preference","reduce"]) {
    await page.emulateMedia({reducedMotion});
    expect(await line.evaluate(node=>getComputedStyle(node).animationIterationCount)).toBe("infinite");
    const first=await sharp(await line.screenshot({animations:"allow"})).ensureAlpha().raw().toBuffer();
    await expect.poll(async()=>{
      const second=await sharp(await line.screenshot({animations:"allow"})).ensureAlpha().raw().toBuffer();
      let changed=0;
      for(let i=0;i<first.length;i+=4)if(Math.abs(first[i]-second[i])+Math.abs(first[i+1]-second[i+1])+Math.abs(first[i+2]-second[i+2])>30)changed++;
      return changed;
    },{timeout:5000,intervals:[100,180,300]}).toBeGreaterThan(30);
    expect(await line.boundingBox()).toEqual(before);
  }
});

test("rectangle live preview leaves saved masks and draft storage untouched until pointer-up", async ({ page }) => {
  const state=await setup(page);
  for(let id=1;id<=4;id++) {
    await rectangle(page);await page.getByLabel(`Area instruction ${id}`,{exact:true}).fill(`Update area ${id}.`);
    await page.getByRole("button",{name:"Save instruction",exact:true}).click();
  }
  const image=await page.getByAltText("Artwork to edit",{exact:true}).boundingBox();
  await page.mouse.move(image.x+image.width*.05,image.y+image.height*.5);await page.mouse.down();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await page.evaluate(()=>{
    window.drawingMutations=0;window.drawingReads=0;
    window.drawingObserver=new MutationObserver(records=>window.drawingMutations+=records.length);
    window.drawingObserver.observe(document.querySelector('[aria-label="Draw editing areas"]'),{subtree:true,attributes:true,childList:true});
    window.originalImageBounds=HTMLImageElement.prototype.getBoundingClientRect;
    HTMLImageElement.prototype.getBoundingClientRect=function(...args){if(this.alt==="Artwork to edit")window.drawingReads++;return window.originalImageBounds.apply(this,args);};
    window.drawingDraft=localStorage.getItem(Object.keys(localStorage).find(key=>key.startsWith("artwork-edit:v1:")));
  });
  await page.mouse.move(image.x+image.width*.85,image.y+image.height*.85,{steps:80});
  const preview=page.locator('[data-rectangle-preview]');
  await expect(preview).toBeVisible();
  expect(Number(await preview.locator("rect").first().getAttribute("width"))).toBeGreaterThan(700);
  const stats=await page.evaluate(()=>{
    const data={mutations:window.drawingMutations,reads:window.drawingReads,sameDraft:window.drawingDraft===localStorage.getItem(Object.keys(localStorage).find(key=>key.startsWith("artwork-edit:v1:")))};
    window.drawingObserver.disconnect();HTMLImageElement.prototype.getBoundingClientRect=window.originalImageBounds;return data;
  });
  expect(stats).toEqual({mutations:0,reads:0,sameDraft:true});
  await page.mouse.up();await expect(preview).toBeHidden();
  await expect(page.getByLabel("Area instruction 5",{exact:true})).toBeVisible();
  await expect(page.getByRole("dialog",{name:"Edit artwork",exact:true})).not.toHaveAttribute("data-artwork-drawing");
  expect(state.submissions).toBe(0);
});

test("floating composer creates canvas room without entering the sidebar or covering the selection", async ({ page }) => {
  const state=await setup(page);await page.setViewportSize({width:1050,height:768});
  const image=page.getByAltText("Artwork to edit",{exact:true});
  await expect.poll(()=>image.evaluate(node=>node.naturalWidth)).toBe(700);
  const bounds=await image.boundingBox();
  await page.mouse.move(bounds.x+bounds.width*.02,bounds.y+bounds.height*.02);await page.mouse.down();
  await page.mouse.move(bounds.x+bounds.width*.98,bounds.y+bounds.height*.98,{steps:12});await page.mouse.up();
  const composer=page.getByRole("region",{name:"Instruction 1 editor",exact:true});
  await expect(composer).toHaveAttribute("data-side","floating");
  const prompt=page.getByLabel("Area instruction 1",{exact:true});
  await prompt.fill("Change the lettering to black.");
  const overlaps=async()=>{
    const box=await composer.boundingBox(),area=await page.locator('[data-selection-outline="1"]').boundingBox();
    return box.x<area.x+area.width && box.x+box.width>area.x && box.y<area.y+area.height && box.y+box.height>area.y;
  };
  expect(await overlaps()).toBe(false);
  await page.screenshot({path:"test-results/artwork-composer-canvas-room.png"});
  await page.setViewportSize({width:1800,height:768});
  await expect(composer).toHaveAttribute("data-side","floating");
  await expect(prompt).toHaveValue("Change the lettering to black.");
  expect(await overlaps()).toBe(false);
  await page.screenshot({path:"test-results/artwork-composer-no-overlap.png"});
  await page.getByRole("button",{name:"Save instruction",exact:true}).click();
  await expect(page.getByText("Selection 02",{exact:true})).toBeVisible();
  expect(state.submissions).toBe(0);
});

test("overlap warnings block review and saved instructions become unsaved when changed", async ({ page }) => {
  const state=await setup(page);await rectangle(page);
  await page.getByLabel("Area instruction 1",{exact:true}).fill("Recolour the text.");
  const card=id=>page.locator(`[data-instruction-id="${id}"]`);
  await expect(card(1)).toHaveAttribute("data-status","Draft");
  await page.getByRole("button",{name:"Save instruction",exact:true}).click();
  await expect(card(1)).toHaveAttribute("data-status","Saved");
  await rectangle(page,.36);
  await page.getByLabel("Area instruction 2",{exact:true}).fill("Remove the number.");
  await expect(page.getByText("Selections 01 and 02 overlap.",{exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:"Review edits",exact:true})).toBeDisabled();
  await expect(page.locator('[data-selection-outline="1"]')).toHaveAttribute("data-conflict","true");
  await page.getByRole("button",{name:"Save instruction",exact:true}).click();
  await card(1).getByRole("button").first().click();
  await page.getByLabel("Area instruction 1",{exact:true}).fill("Make the lettering black.");
  await expect(card(1)).toHaveAttribute("data-status","Unsaved changes");
  await page.getByRole("button",{name:"Close artwork editor",exact:true}).click();
  await page.getByRole("button",{name:"Edit artwork",exact:true}).click();
  await expect(card(1)).toHaveAttribute("data-status","Unsaved changes");
  await card(1).getByRole("button").first().click();
  await page.screenshot({path:"test-results/artwork-preflight-overlap.png"});
  await page.getByRole("button",{name:"Delete instruction 2",exact:true}).click();
  await expect(page.getByText("Selections 01 and 02 overlap.",{exact:true})).toHaveCount(0);
  await page.getByRole("button",{name:"Review edits",exact:true}).click();
  await expect(page.getByRole("dialog",{name:"Edit artwork",exact:true}).getByRole("alert")).toContainText("Save instruction 1");
  await card(1).getByRole("button").first().click();
  await page.getByRole("button",{name:"Save instruction",exact:true}).click();
  await expect(card(1)).toHaveAttribute("data-status","Saved");
  await page.getByRole("button",{name:"Review edits",exact:true}).click();
  await expect(page.getByText("Confirm your instructions",{exact:true})).toBeVisible();
  expect(state.submissions).toBe(0);
});

test("brush overlap check respects eraser holes and flags an entirely erased area", async ({ page }) => {
  await setup(page);await rectangle(page);
  await page.getByLabel("Area instruction 1",{exact:true}).fill("Recolour the text.");
  await page.getByRole("button",{name:"Save instruction",exact:true}).click();
  await page.getByRole("button",{name:"Brush",exact:true}).click();
  const image=await page.getByAltText("Artwork to edit",{exact:true}).boundingBox();
  await page.mouse.move(image.x+image.width*.4,image.y+image.height*.35);await page.mouse.down();
  await page.mouse.move(image.x+image.width*.55,image.y+image.height*.35,{steps:8});await page.mouse.up();
  await expect(page.getByText("Selections 01 and 02 overlap.",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Erase selection",exact:true}).click();
  await page.getByLabel("Brush size",{exact:true}).fill("25");
  await page.mouse.move(image.x+image.width*.4,image.y+image.height*.35);await page.mouse.down();
  await page.mouse.move(image.x+image.width*.55,image.y+image.height*.35,{steps:8});await page.mouse.up();
  await expect(page.getByText("Selections 01 and 02 overlap.",{exact:true})).toHaveCount(0);
  await expect(page.getByText(/Selection 2 has no editable pixels/)).toBeVisible();
});
