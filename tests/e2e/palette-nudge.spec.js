import { expect, test } from "@playwright/test";
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

test("compact palette callout points to its actual button and follows viewport changes", async ({ page }) => {
  await page.setViewportSize({ width:1440,height:900 });
  const source='<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="#152a42"/><path fill="#eac951" d="M0 0L600 700V800L0 100Z"/></svg>';
  const user={id:"palette-test-user",email:"palette@example.test",aud:"authenticated",role:"authenticated",app_metadata:{},user_metadata:{}};
  const encode=value=>Buffer.from(JSON.stringify(value)).toString("base64url");
  const reference=new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
  const session={access_token:`${encode({alg:"HS256",typ:"JWT"})}.${encode({sub:user.id,exp:Math.floor(Date.now()/1000)+3600,role:"authenticated"})}.test`,refresh_token:"test-refresh",token_type:"bearer",expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user};
  await page.addInitScript(({key,value})=>{Object.defineProperty(navigator,"maxTouchPoints",{get:()=>0});localStorage.setItem("cookie_consent","declined");document.cookie=`${key}=base64-${value}; path=/; SameSite=Lax`;},{key:`sb-${reference}-auth-token`,value:encode(session)});
  await page.route("**/auth/v1/**",r=>r.fulfill({json:user}));
  await page.route("**/rest/v1/**",r=>r.fulfill({json:r.request().url().includes("/projects")?{id:"palette-test",trace_type:"mockup_preserve",ai_prompt:"PRESERVE_LOGOS",original_image_url:"https://palette.test/crop_source.svg",generated_image_url:"https://palette.test/flat.png",upscaled_image_url:"https://palette.test/hd.png",svg_url:null}:{credits:10}}));
  await page.route("**/api/proxy?*",r=>r.fulfill({contentType:"image/svg+xml",body:source}));
  await page.route("**/palette.test/**",r=>r.fulfill({contentType:"image/svg+xml",body:source}));
  await page.route("**/api/projects/*/artwork-edits",r=>r.fulfill({json:{enabled:false,edits:[]}}));
  await page.route("**/api/trace-step3",r=>r.fulfill({json:{svg_url:"https://palette.test/final.svg"}}));
  await page.goto("/workspace/palette-test");
  await page.getByRole("button",{name:/Retry SVG/}).click();
  await page.getByRole("button",{name:"Close comparison",exact:true}).click();
  const nudge=page.locator(".palette-ready-nudge");
  const target=page.locator('[data-palette-preview-anchor="true"]');
  await expect(nudge).toHaveAttribute("data-ready","true");
  await expect(target).toHaveAttribute("data-palette-nudge-target","true");
  for (const [width,height] of [[1440,900],[1366,768]]) {
    await page.setViewportSize({width,height});
    await expect.poll(()=>nudge.evaluate(el=>{
      const rect=el.getBoundingClientRect(),button=document.querySelector('[data-palette-preview-anchor="true"]').getBoundingClientRect();
      return Math.abs((rect.top+parseFloat(el.style.getPropertyValue("--nudge-arrow-y")))-(button.top+button.height/2));
    })).toBeLessThanOrEqual(1);
    await expect.poll(async()=>{const a=await target.boundingBox(),b=await nudge.boundingBox();return Math.abs(a.x-(b.x+b.width)-10);} ).toBeLessThanOrEqual(1);
    const box=await nudge.boundingBox();expect(box.width).toBeLessThanOrEqual(265);expect(box.height).toBeLessThanOrEqual(100);
    expect(await nudge.evaluate(el=>getComputedStyle(el,"::before").content)).toBe('""');
    await page.screenshot({path:`test-results/palette-pointer-${height}.png`,animations:"disabled"});
  }
  await page.getByRole("button",{name:"Dismiss Palette Studio ready notice"}).click();
  await expect(nudge).toHaveCount(0);
  await expect(target).not.toHaveAttribute("data-palette-nudge-target");
});
