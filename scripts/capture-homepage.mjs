import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const baseUrl = process.env.CAPTURE_URL ?? 'http://127.0.0.1:5192/';
const out='app/public/assets/homepage/'; await mkdir(out,{recursive:true});
const browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1600,height:1100},deviceScaleFactor:1});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.clock.install();
const capture=async name=>{await page.evaluate(()=>{scrollTo(0,0);document.activeElement?.blur()});await page.screenshot({path:out+name+'.jpg',type:'jpeg',quality:88,fullPage:true});};
try{
 await page.goto(new URL('play.html#all', baseUrl).href);
 await page.getByText('Offline demonstration').waitFor();await capture('facility');
 for(const mode of ['red','maze']){
  await page.goto(new URL('play.html#'+mode, baseUrl).href);
  await page.getByRole('textbox').fill('Reach the altar. Explore systematically, remember visited paths, and avoid dangerous tiles.');
  if(mode==='red')await capture('charter');
  await page.getByRole('button',{name:'Deploy',exact:true}).click();
  for(let i=0;i<40&&!await page.getByRole('button',{name:'See results',exact:true}).isVisible();i++)await page.clock.runFor(10000);
  await page.getByRole('button',{name:'See results',exact:true}).click();
  if(mode==='red')await capture('results');
  await page.getByRole('button',{name:/Replay/}).first().click();
  await page.getByRole('slider').press('End');
  if(await page.getByRole('button',{name:'Fog: on',exact:true}).isVisible())await page.getByRole('button',{name:'Fog: on',exact:true}).click();
  await page.clock.runFor(500);await capture(mode);console.log('Captured',mode);
 }
 if(errors.length)throw Error(errors.join('\n'));
}finally{await browser.close()}
