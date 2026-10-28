import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { strict as assert } from 'node:assert';
import { setTimeout as delay } from 'node:timers/promises';
const root = new URL('..', import.meta.url).pathname;
const chrome = process.env.CHROME_PATH;
if (!chrome) throw new Error('Set CHROME_PATH to a Chromium-compatible browser executable');
const port = 4179;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, stdio: 'pipe' });
let browser;
try {
  let ready = false;
  for (let i=0; i<100; i++) { try { const r=await fetch(`http://127.0.0.1:${port}/tests/fixture.html`); if(r.ok) {ready=true;break;} } catch {} await delay(100); }
  if (!ready) throw new Error('Vite did not start');
  browser = await chromium.launch({ executablePath: chrome, headless: true });
  const page = await browser.newPage({ viewport:{width:800,height:600}, deviceScaleFactor:2 });
  await page.goto(`http://127.0.0.1:${port}/tests/fixture.html`); await page.waitForFunction(() => !!window.PageHeatmap);
  await page.evaluate(() => {
    window.logs = [];
    window.audit = {listeners: [], observers: 0, raf: new Set()};
    for (const target of [window, document, window.visualViewport, document.fonts].filter(Boolean)) {
      const add = target.addEventListener.bind(target), remove = target.removeEventListener.bind(target);
      target.addEventListener = (type, fn, options) => { window.audit.listeners.push({target,type,fn}); add(type,fn,options); };
      target.removeEventListener = (type, fn, options) => { const i=window.audit.listeners.findIndex(x=>x.target===target&&x.type===type&&x.fn===fn); if(i>=0)window.audit.listeners.splice(i,1); remove(type,fn,options); };
    }
    for (const name of ['MutationObserver','ResizeObserver']) { const Original=window[name]; window[name]=class extends Original { constructor(...args){super(...args);window.audit.observers++;this.active=true;} disconnect(){super.disconnect();if(this.active){this.active=false;window.audit.observers--;}} observe(...args){super.observe(...args);if(!this.active){this.active=true;window.audit.observers++;}} }; }
    const raf=window.requestAnimationFrame.bind(window),cancel=window.cancelAnimationFrame.bind(window);
    window.requestAnimationFrame = fn => { const id=raf(t=>{window.audit.raf.delete(id);fn(t)});window.audit.raf.add(id);return id; };
    window.cancelAnimationFrame = id => {window.audit.raf.delete(id);cancel(id)};
    window.factory = id => () => ({ resize: s => window.logs.push({id,type:'resize',...s}), draw: p => window.logs.push({id,type:'draw',points:JSON.parse(JSON.stringify(p))}), destroy: () => window.logs.push({id,type:'destroy'}) });
    window.a = new window.PageHeatmap({ renderer:window.factory('a'), data:[{id:'0',selector:'#origin',value:5},{id:'moving',selector:'#moving',value:10},{id:'nested',selector:'#inside',value:5}] });
  });
  const tick=()=>page.waitForTimeout(120);
  await tick();
  let logs=await page.evaluate(()=>window.logs); let last=()=>logs.filter(x=>x.type==='draw').at(-1).points;
  assert.equal(logs.find(x=>x.type==='resize').dpr,2); assert.deepEqual(last().map(p=>p.id),['0','moving']); assert.equal(last()[0].x,20); assert.equal(last()[0].y,15);
  await page.evaluate(()=>{document.querySelector('#nested').scrollTop=120}); await tick(); logs=await page.evaluate(()=>window.logs); assert(last().some(p=>p.id==='nested'),'nested scroll');
  await page.evaluate(()=>window.scrollTo(0,250)); await tick(); logs=await page.evaluate(()=>window.logs); assert(!last().some(p=>p.id==='0'),'viewport scroll hides');
  await page.evaluate(()=>{const old=document.querySelector('#moving');const replacement=old.cloneNode();replacement.style.top='350px';old.replaceWith(replacement)}); await tick(); logs=await page.evaluate(()=>window.logs); assert.equal(last().find(p=>p.id==='moving').y,115,'replacement re-resolved');
  await page.evaluate(()=>window.a.setData([{id:'zero',selector:'#moving',value:0}])); await tick(); logs=await page.evaluate(()=>window.logs); assert.equal(last().length,0,'zero clears');
  await page.evaluate(()=>window.a.setData([])); await tick(); logs=await page.evaluate(()=>window.logs); assert.equal(last().length,0,'empty clears');
  await page.evaluate(()=>window.a.setData([{id:'m',selector:'#moving',value:2}])); await tick();
  const invalid=await page.evaluate(()=>{try{window.a.setData([{id:'x',selector:'#moving',value:1},{id:'x',selector:'#moving',value:1}]);return false}catch{return true}}); assert(invalid);
  await page.evaluate(()=>window.a.pause()); let n=await page.evaluate(()=>window.logs.length); await page.evaluate(()=>{document.querySelector('#moving').style.top='400px';window.dispatchEvent(new Event('resize'))}); await tick(); assert.equal(await page.evaluate(()=>window.logs.length),n,'pause cancels work');
  await page.evaluate(()=>{window.a.start();window.a.start()}); await tick(); logs=await page.evaluate(()=>window.logs); assert.equal(last()[0].y,165,'resume refreshes');
  await page.evaluate(()=>{Object.defineProperty(window,'devicePixelRatio',{value:1,configurable:true});window.dispatchEvent(new Event('resize'))}); await tick(); logs=await page.evaluate(()=>window.logs); assert.equal(logs.filter(x=>x.type==='resize').at(-1).dpr,1);
  await page.evaluate(()=>{window.b=new window.PageHeatmap({renderer:window.factory('b'),data:[{id:'other',selector:'#moving',value:1}]})}); await tick(); assert.equal(await page.locator('[data-page-heatmap]').count(),2,'independent instances');
  await page.evaluate(()=>{window.a.refresh();window.a.destroy();window.a.destroy()}); n=await page.evaluate(()=>window.logs.filter(x=>x.id==='a').length); await page.evaluate(()=>{window.scrollTo(0,0);document.querySelector('#moving').style.left='25px';window.dispatchEvent(new Event('resize'))}); await tick(); logs=await page.evaluate(()=>window.logs); assert.equal(logs.filter(x=>x.type==='destroy').length,1); assert.equal(logs.filter(x=>x.id==='a').length,n,'destroyed instance performs no work'); assert.equal(await page.locator('[data-page-heatmap]').count(),1);
  await page.evaluate(()=>{window.b.destroy();window.c=new window.PageHeatmap({data:[{id:'origin',selector:'#origin',value:1}]})}); await tick();
  const canvas=await page.evaluate(()=>{const el=document.querySelector('[data-page-heatmap] canvas');return {w:el.width,h:el.height,alpha:el.getContext('2d').getImageData(20,15,1,1).data[3]}}); assert.equal(canvas.w,800);assert.equal(canvas.h,600);assert(canvas.alpha>0,'default renderer draws');
  await page.evaluate(()=>{window.c.setData([])}); await tick(); assert.equal(await page.evaluate(()=>document.querySelector('[data-page-heatmap] canvas').getContext('2d').getImageData(20,15,1,1).data[3]),0,'default renderer clears');
  await page.evaluate(()=>window.c.destroy());assert.equal(await page.locator('[data-page-heatmap]').count(),0); const audit=await page.evaluate(()=>({listeners:window.audit.listeners.length,observers:window.audit.observers,raf:window.audit.raf.size}));assert.deepEqual(audit,{listeners:0,observers:0,raf:0},'listeners, observers and RAF released');
  console.log('PASS browser: scroll, nested scroll, dynamic replacement, zero/empty, validation, pause/resume, DPR, isolation, destroy, Canvas draw/clear');
} finally { if(browser) await browser.close(); server.kill('SIGTERM'); }
