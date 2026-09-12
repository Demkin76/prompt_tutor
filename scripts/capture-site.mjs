import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
(async()=>{
 const browser=await chromium.launch({headless:true});
 const page=await browser.newPage({viewport:{width:1600,height:1150},deviceScaleFactor:1});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`)});
 await page.clock.install();
 const out="app/public/assets/screenshots/";
 await mkdir(out, { recursive: true });
 const capture = async name => { await page.evaluate(() => { window.scrollTo(0, 0); if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); }); await page.screenshot({ path: out + name, fullPage: true }); };
 await mkdir("test-results", { recursive: true });
 try {
  for(const mode of ['key','red']){
   await page.goto(new URL('play.html#'+mode, process.env.CAPTURE_URL ?? 'http://127.0.0.1:5180/').href);
   await page.locator('.connection').waitFor();
   if (!await page.getByText('OFFLINE DEMO', { exact: true }).isVisible()) throw new Error('Screenshots must use the offline demo; refusing to launch a paid live run.');
   await page.getByRole('textbox').fill(mode==='key'?'Исследуй мир. Найди ключ, подбери его и вернись к запертой двери. Открой дверь, затем достигни алтаря.':'Reach the altar. Never step on dangerous red tiles. Explore safe routes and remember blocked paths.');
   if(mode==='key') await capture('charter-editor.png');
   await page.getByRole('button',{name:mode==='key'?'Оживить':'Deploy',exact:true}).click();
   for(let i=0;i<30&&!await page.getByRole('button',{name:'See results'}).isVisible();i++) await page.clock.runFor(10000);
   await page.getByRole('button',{name:'See results'}).click();
   if(mode==='key') await capture('keymaster-results.png');
   await page.getByRole('button',{name:/Replay/}).first().click();
   const slider=page.getByRole('slider');await slider.press('End');
   await page.getByRole('button',{name:'Fog: on',exact:true}).click();
   await page.clock.runFor(500);
   await capture(mode==='key'?'keymaster-replay.png':'redfloor-run.png');
   console.log(mode+' captured');
  }
  if (errors.length) throw new Error(errors.join("\n"));
  console.log("Captured four real application screens without browser errors.");
 }catch(e){await page.screenshot({path:'test-results/capture-error.png',fullPage:true});console.log((await page.locator('body').innerText()).slice(-4000));throw e;}
 finally{await browser.close();}
})();
