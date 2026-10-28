import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { accessSync, constants } from 'node:fs';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strict as assert } from 'node:assert';

const root = fileURLToPath(new URL('..', import.meta.url));
const explicitBrowser = process.env.CHROMIUM_EXECUTABLE_PATH ?? process.env.CHROME_PATH;
const candidates = explicitBrowser ? [explicitBrowser] : [
  ...((process.env.PATH ?? '').split(delimiter).flatMap(path => ['chromium', 'chromium-browser', 'google-chrome'].map(name => join(path, name)))),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  chromium.executablePath()
];
const executablePath = candidates.find(path => {
  try { accessSync(path, constants.X_OK); return true; } catch { return false; }
});
if (!executablePath) throw new Error('No Chromium executable found. Set CHROMIUM_EXECUTABLE_PATH to an installed Chromium-compatible browser.');

let server;
let browser;
let baseUrl;
let passed = 0;

async function fixture() {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 2 });
  page.errors = [];
  page.on('pageerror', error => page.errors.push(error.message));
  await page.goto(`${baseUrl}/tests/fixture.html`);
  await page.waitForFunction(() => Boolean(window.PageHeatmap));
  await page.evaluate(() => {
    window.logs = [];
    window.hoverEvents = [];
    window.audit = { listeners: [], observers: new Set(), raf: new Set(), requests: 0 };
    const originalAdd = EventTarget.prototype.addEventListener;
    const originalRemove = EventTarget.prototype.removeEventListener;
    const capture = options => typeof options === 'boolean' ? options : Boolean(options?.capture);
    EventTarget.prototype.addEventListener = function (type, fn, options) {
      if (fn && !window.audit.listeners.some(item => item.target === this && item.type === type && item.fn === fn && item.capture === capture(options))) {
        window.audit.listeners.push({ target: this, type, fn, capture: capture(options) });
      }
      return originalAdd.call(this, type, fn, options);
    };
    EventTarget.prototype.removeEventListener = function (type, fn, options) {
      const index = window.audit.listeners.findIndex(item => item.target === this && item.type === type && item.fn === fn && item.capture === capture(options));
      if (index >= 0) window.audit.listeners.splice(index, 1);
      return originalRemove.call(this, type, fn, options);
    };
    for (const name of ['MutationObserver', 'ResizeObserver']) {
      const Original = window[name];
      window[name] = class extends Original {
        observe(...args) { super.observe(...args); window.audit.observers.add(this); }
        disconnect() { super.disconnect(); window.audit.observers.delete(this); }
      };
    }
    window.rawRaf = window.requestAnimationFrame.bind(window);
    const cancel = window.cancelAnimationFrame.bind(window);
    window.requestAnimationFrame = callback => {
      window.audit.requests++;
      const id = window.rawRaf(time => { window.audit.raf.delete(id); callback(time); });
      window.audit.raf.add(id);
      return id;
    };
    window.cancelAnimationFrame = id => { window.audit.raf.delete(id); cancel(id); };
    window.factory = id => () => ({
      resize: viewport => window.logs.push({ id, type: 'resize', ...viewport }),
      draw: points => window.logs.push({ id, type: 'draw', points: structuredClone(points) }),
      destroy: () => window.logs.push({ id, type: 'destroy' })
    });
  });
  return page;
}

async function settle(page) {
  await page.evaluate(() => new Promise(resolve => {
    let frames = 5;
    const next = () => { if (--frames) window.rawRaf(next); else resolve(); };
    window.rawRaf(next);
  }));
}

async function points(page, id = 'a') {
  return page.evaluate(id => window.logs.filter(entry => entry.id === id && entry.type === 'draw').at(-1)?.points, id);
}

async function audit(page) {
  return page.evaluate(() => ({ listeners: window.audit.listeners.length, observers: window.audit.observers.size, raf: window.audit.raf.size }));
}

async function test(name, run) {
  const page = await fixture();
  try {
    await run(page);
    assert.deepEqual(page.errors, [], 'No uncaught browser errors');
    passed++;
    console.log(`PASS browser: ${name}`);
  } finally {
    await page.close();
  }
}

try {
  server = await createServer({ root, server: { host: '127.0.0.1', port: 0, strictPort: false } });
  await server.listen();
  const address = server.httpServer.address();
  if (!address || typeof address === 'string') throw new Error('Could not determine local fixture server address');
  baseUrl = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ executablePath, headless: true });

  await test('viewport/overflow clipping, stable scale, scroll and dynamic DOM', async page => {
    await page.evaluate(() => {
      window.a = new window.PageHeatmap({ renderer: window.factory('a'), data: [
        { id: '0', selector: '#origin', value: 5 },
        { id: 'moving', selector: '#moving', value: 10 },
        { id: 'nested', selector: '#inside', value: 5 },
        { id: 'missing', selector: '#not-present', value: 20 },
        { id: 'hidden', selector: '#hidden', value: 5 },
        { id: 'partial', selector: '#partial', value: 5 }
      ] });
    });
    await settle(page);
    let result = await points(page);
    assert.deepEqual(result.map(point => point.id), ['0', 'moving', 'partial']);
    assert.deepEqual(result[0], { id: '0', x: 20, y: 15, value: 5, normalized: 0.25, rect: { left: 0, top: 0, right: 40, bottom: 30 } });
    assert.equal(result.find(point => point.id === 'partial').x, 10, 'center is in the clipped visible intersection');
    assert.equal(await page.evaluate(() => window.logs.find(entry => entry.type === 'resize').dpr), 2);
    await page.evaluate(() => { document.querySelector('#nested').scrollTop = 120; });
    await settle(page);
    assert.equal((await points(page)).find(point => point.id === 'nested').y, 175, 'nested scroll repositions clipped point');
    await page.evaluate(() => window.scrollTo(0, 250));
    await settle(page);
    result = await points(page);
    assert(!result.some(point => point.id === '0'), 'window scroll removes offscreen point');
    assert.equal(result.find(point => point.id === 'moving').normalized, 0.5, 'viewport changes do not renormalize');
    await page.evaluate(() => {
      const old = document.querySelector('#moving');
      const replacement = old.cloneNode();
      replacement.style.top = '350px';
      old.replaceWith(replacement);
    });
    await settle(page);
    assert.equal((await points(page)).find(point => point.id === 'moving').y, 115, 'replacement is re-resolved');
    await page.evaluate(() => { document.querySelector('#moving').style.width = '80px'; });
    await settle(page);
    assert.equal((await points(page)).find(point => point.id === 'moving').x, 60, 'element resize updates its center');
    await page.evaluate(() => { document.querySelector('#moving').remove(); });
    await settle(page);
    assert(!(await points(page)).some(point => point.id === 'moving'));
    await page.evaluate(() => window.a.destroy());
    assert.deepEqual(await audit(page), { listeners: 0, observers: 0, raf: 0 });
  });

  await test('out-of-flow targets escape non-containing overflow ancestors', async page => {
    await page.evaluate(() => {
      const data = [];
      const add = (id, position, containerStyle, top = 100) => {
        const container = document.createElement('div');
        Object.assign(container.style, { width: '10px', height: '10px', overflow: 'hidden', ...containerStyle });
        const target = document.createElement('button');
        target.id = id;
        Object.assign(target.style, { position, left: '100px', top: `${top}px`, width: '50px', height: '20px', margin: '0', padding: '0', border: '0' });
        container.append(target);
        document.body.append(container);
        data.push({ id, selector: `#${id}`, value: 1 });
      };
      add('fixed-escape', 'fixed', {});
      add('absolute-escape', 'absolute', {}, 140);
      add('fixed-transform', 'fixed', { transform: 'translate(0)' });
      add('fixed-filter', 'fixed', { filter: 'blur(0)' });
      add('fixed-contain', 'fixed', { contain: 'paint' });
      add('absolute-contained', 'absolute', { position: 'relative' });
      window.a = new window.PageHeatmap({ renderer: window.factory('a'), data });
    });
    await settle(page);
    const result = await points(page);
    assert.deepEqual(result.map(point => point.id), ['fixed-escape', 'absolute-escape'], 'only ancestors that participate in the containing-block chain may clip out-of-flow targets');
    assert.deepEqual(result.map(point => [point.x, point.y]), [[125, 110], [125, 150]]);
    await page.evaluate(() => window.a.destroy());
    assert.deepEqual(await audit(page), { listeners: 0, observers: 0, raf: 0 });
  });

  await test('root/body overflow propagation preserves layout-viewport coordinates after scroll', async page => {
    await page.evaluate(() => {
      document.documentElement.style.overflowY = 'scroll';
      document.body.style.overflow = 'visible';
      document.querySelector('#moving').style.top = '685px';
      window.scrollTo(0, 500);
      window.a = new window.PageHeatmap({ renderer: window.factory('a'), data: [{ id: 'moving', selector: '#moving', value: 1 }] });
    });
    await settle(page);
    assert.equal(await page.evaluate(() => window.scrollY), 500);
    assert.equal((await points(page))[0]?.y, 200, 'root scrollport is the viewport, not a root rect shifted by scrollY');
    await page.evaluate(() => {
      document.documentElement.style.overflow = 'visible';
      document.body.style.overflowY = 'scroll';
      document.querySelector('#moving').style.top = '885px';
      window.scrollTo(0, 700);
    });
    await settle(page);
    assert.equal(await page.evaluate(() => window.scrollY), 700);
    assert.equal((await points(page))[0]?.y, 200, 'body overflow propagated to the viewport must not create a second clipping box');
    await page.evaluate(() => window.a.destroy());
    assert.deepEqual(await audit(page), { listeners: 0, observers: 0, raf: 0 });
  });

  await test('setData is atomic, copied, bounded and clears zero/empty data', async page => {
    await page.evaluate(() => {
      const data = Object.freeze([Object.freeze({ id: 'original', selector: '#origin', value: 2 })]);
      window.a = new window.PageHeatmap({ renderer: window.factory('a'), max: 4, data });
    });
    await settle(page);
    const original = await points(page);
    assert.equal(original[0].normalized, 0.5);
    const failures = await page.evaluate(() => {
      const invalid = [
        [{ id: 'duplicate', selector: '#moving', value: 1 }, { id: 'duplicate', selector: '#origin', value: 1 }],
        [{ id: 'bad', selector: '[', value: 1 }],
        [{ id: 'bad', selector: '#origin', value: NaN }],
        new Array(1)
      ];
      return invalid.map(data => { try { window.a.setData(data); return false; } catch { return true; } });
    });
    assert(failures.every(Boolean));
    await settle(page);
    assert.deepEqual(await points(page), original, 'rejected updates preserve prior state');
    await page.evaluate(() => {
      const data = [{ id: 'copy', selector: '#moving', value: 8 }];
      window.a.setData(data);
      data[0].value = 0;
      data[0].selector = '#missing';
    });
    await settle(page);
    assert.equal((await points(page))[0].normalized, 1, 'fixed max clamps and caller mutation cannot change internal data');
    await page.evaluate(() => window.a.setData([{ id: 'zero', selector: '#moving', value: 0 }]));
    await settle(page);
    assert.deepEqual(await points(page), []);
    await page.evaluate(() => window.a.setData([]));
    await settle(page);
    assert.deepEqual(await points(page), []);
    await page.evaluate(() => window.a.destroy());
    assert.equal(await page.evaluate(() => { try { window.a.setData([]); return false; } catch { return true; } }), true, 'setData after destroy is rejected');
  });

  await test('coalesced invalidation, idle, pause/resume and complete teardown', async page => {
    await page.evaluate(() => { window.a = new window.PageHeatmap({ renderer: window.factory('a'), onHover: point => window.hoverEvents.push(point?.id ?? null), data: [{ id: 'origin', selector: '#origin', value: 1 }] }); });
    await settle(page);
    const idle = await page.evaluate(() => ({ requests: window.audit.requests, logs: window.logs.length }));
    await page.waitForTimeout(250);
    assert.deepEqual(await page.evaluate(() => ({ requests: window.audit.requests, logs: window.logs.length })), idle, 'idle does not poll or repaint');
    const requests = await page.evaluate(() => {
      const before = window.audit.requests;
      for (let i = 0; i < 100; i++) { window.a.refresh(); window.dispatchEvent(new Event('resize')); }
      return window.audit.requests - before;
    });
    assert.equal(requests, 1, '100 invalidations share a single queued frame');
    await settle(page);
    await page.evaluate(() => { window.a.refresh(); window.a.pause(); window.a.pause(); });
    assert.deepEqual(await audit(page), { listeners: 0, observers: 0, raf: 0 }, 'pause releases activity, not only drawing');
    const paused = await page.evaluate(() => window.logs.length);
    await page.evaluate(() => {
      document.querySelector('#origin').style.left = '100px';
      window.a.setData([{ id: 'latest', selector: '#origin', value: 2 }]);
      window.dispatchEvent(new Event('resize'));
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 20, clientY: 15 }));
    });
    await settle(page);
    assert.equal(await page.evaluate(() => window.logs.length), paused);
    assert.deepEqual(await page.evaluate(() => window.hoverEvents), [], 'paused instance does not emit hover');
    await page.evaluate(() => { window.a.start(); window.a.start(); });
    await settle(page);
    assert.equal((await points(page))[0].id, 'latest');
    assert.equal((await points(page))[0].x, 120);
    await page.evaluate(() => { window.a.stop(); window.a.start(); window.a.refresh(); window.a.destroy(); window.a.destroy(); window.a.start(); window.a.refresh(); });
    const destroyed = await page.evaluate(() => window.logs.length);
    await page.evaluate(() => { document.querySelector('#origin').style.left = '200px'; window.dispatchEvent(new Event('resize')); });
    await settle(page);
    assert.equal(await page.evaluate(() => window.logs.length), destroyed);
    assert.equal(await page.evaluate(() => window.logs.filter(entry => entry.type === 'destroy').length), 1);
    assert.equal(await page.locator('[data-page-heatmap]').count(), 0);
    assert.deepEqual(await audit(page), { listeners: 0, observers: 0, raf: 0 });
  });

  await test('multiple instances ignore each other’s overlays and remain independent', async page => {
    await page.evaluate(() => {
      window.a = new window.PageHeatmap({ renderer: window.factory('a'), data: [{ id: 'origin', selector: '#origin', value: 1 }] });
      window.b = new window.PageHeatmap({ renderer: window.factory('b'), data: [{ id: 'moving', selector: '#moving', value: 1 }] });
    });
    await settle(page);
    assert.equal(await page.locator('[data-page-heatmap]').count(), 2);
    const before = await page.evaluate(() => window.audit.requests);
    await page.evaluate(() => {
      for (const overlay of document.querySelectorAll('[data-page-heatmap]')) overlay.querySelector('canvas').style.opacity = '0.5';
    });
    await settle(page);
    assert.equal(await page.evaluate(() => window.audit.requests), before, 'overlay-only mutations do not trigger any instance');
    await page.evaluate(() => window.a.destroy());
    await settle(page);
    assert.equal(await page.evaluate(() => window.audit.requests), before, 'removing another overlay does not trigger a measurement');
    await page.evaluate(() => { document.querySelector('#moving').style.left = '100px'; });
    await settle(page);
    assert.equal((await points(page, 'b'))[0].x, 120);
    assert.equal(await page.locator('[data-page-heatmap]').count(), 1);
    await page.evaluate(() => window.b.destroy());
    assert.deepEqual(await audit(page), { listeners: 0, observers: 0, raf: 0 });
  });

  await test('hover and optional center-point occlusion', async page => {
    await page.evaluate(() => {
      const data = [{ id: 'covered', selector: '#covered', value: 1 }];
      window.a = new window.PageHeatmap({ renderer: window.factory('a'), onHover: point => window.hoverEvents.push(point?.id ?? null), data });
      window.b = new window.PageHeatmap({ renderer: window.factory('b'), visibility: 'unoccluded', data });
    });
    await settle(page);
    assert.equal((await points(page)).length, 1, 'viewport policy does not perform hit testing');
    assert.deepEqual(await points(page, 'b'), [], 'unoccluded policy excludes a covered center');
    await page.evaluate(() => { document.querySelector('#cover').remove(); });
    await settle(page);
    assert.equal((await points(page, 'b'))[0].id, 'covered', 'target descendants count as target hits');
    await page.mouse.move(240, 75);
    await page.mouse.move(500, 50);
    assert.deepEqual(await page.evaluate(() => window.hoverEvents), ['covered', null]);
    await page.evaluate(() => { window.a.destroy(); window.b.destroy(); });
    assert.deepEqual(await audit(page), { listeners: 0, observers: 0, raf: 0 });
  });

  await test('same-origin target-window DOM and observer realm', async page => {
    await page.evaluate(async () => {
      const frame = document.createElement('iframe');
      frame.srcdoc = '<!doctype html><style>html,body{margin:0}#target{position:absolute;left:10px;top:20px;width:40px;height:30px}</style><div id="target"></div>';
      document.body.append(frame);
      await new Promise(resolve => { frame.onload = resolve; });
      window.frame = frame;
      const target = frame.contentWindow;
      window.realmCounts = { MutationObserver: 0, ResizeObserver: 0 };
      for (const name of ['MutationObserver', 'ResizeObserver']) {
        const Original = target[name];
        target[name] = class extends Original { constructor(...args) { super(...args); window.realmCounts[name]++; } };
      }
      window.a = new window.PageHeatmap({ window: target, renderer: window.factory('a'), data: [{ id: 'frame', selector: '#target', value: 1 }] });
    });
    await settle(page);
    assert.deepEqual(await page.evaluate(() => window.realmCounts), { MutationObserver: 1, ResizeObserver: 1 });
    assert.equal((await points(page))[0].x, 30);
    assert.equal((await points(page))[0].y, 35);
    assert.equal(await page.locator('[data-page-heatmap]').count(), 0, 'overlay belongs to target document, not caller document');
    assert.equal(await page.evaluate(() => window.frame.contentDocument.querySelectorAll('[data-page-heatmap]').length), 1);
    await page.evaluate(() => { window.frame.contentDocument.querySelector('#target').style.left = '50px'; });
    await settle(page);
    assert.equal((await points(page))[0].x, 70);
    await page.evaluate(() => window.a.destroy());
    assert.equal(await page.evaluate(() => window.frame.contentDocument.querySelectorAll('[data-page-heatmap]').length), 0);
  });

  await test('default renderer pixels, resize, DPR changes and clearing', async page => {
    await page.evaluate(() => { window.a = new window.PageHeatmap({ data: [{ id: 'far', selector: '#far', value: 1 }] }); });
    await settle(page);
    const pixel = async (x, y) => page.evaluate(({ x, y }) => {
      const canvas = document.querySelector('[data-page-heatmap] canvas');
      const dpr = window.devicePixelRatio;
      return { width: canvas.width, height: canvas.height, cssWidth: canvas.style.width, alpha: canvas.getContext('2d').getImageData(Math.floor(x * dpr), Math.floor(y * dpr), 1, 1).data[3] };
    }, { x, y });
    let result = await pixel(720, 515);
    assert.equal(result.width, 1600);
    assert.equal(result.height, 1200);
    assert.equal(result.cssWidth, '800px');
    assert(result.alpha > 0, 'point far beyond the default 300x150 canvas is colored');
    await page.setViewportSize({ width: 1100, height: 750 });
    await page.evaluate(() => { const element = document.querySelector('#far'); element.style.left = '1000px'; element.style.top = '680px'; });
    await settle(page);
    result = await pixel(1020, 695);
    assert.equal(result.width, 2200);
    assert.equal(result.height, 1500);
    assert(result.alpha > 0, 'newly added canvas area is colored after enlargement');
    assert.equal((await pixel(720, 515)).alpha, 0, 'previous point is cleared after resize');
    await page.evaluate(() => { Object.defineProperty(window, 'devicePixelRatio', { value: 1, configurable: true }); window.dispatchEvent(new Event('resize')); });
    await settle(page);
    result = await pixel(1020, 695);
    assert.equal(result.width, 1100);
    assert.equal(result.height, 750);
    assert(result.alpha > 0, 'DPR change preserves CSS pixel positioning');
    await page.evaluate(() => window.a.setData([]));
    await settle(page);
    assert.equal((await pixel(1020, 695)).alpha, 0, 'empty update clears pixels');
    await page.evaluate(() => window.a.destroy());
    assert.deepEqual(await audit(page), { listeners: 0, observers: 0, raf: 0 });
  });

  await test('explicit refresh re-resolves selectors and construction errors do not leak', async page => {
    await page.evaluate(() => {
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.id = 'check';
      Object.assign(input.style, { position: 'absolute', left: '50px', top: '50px', width: '30px', height: '30px', margin: '0' });
      document.body.append(input);
      window.a = new window.PageHeatmap({ renderer: window.factory('a'), data: [{ id: 'checked', selector: '#check:checked', value: 1 }] });
    });
    await settle(page);
    assert.deepEqual(await points(page), []);
    await page.evaluate(() => { document.querySelector('#check').checked = true; window.a.refresh(); });
    await settle(page);
    assert.equal((await points(page))[0].id, 'checked', 'property-only selector changes are refreshed explicitly');
    await page.evaluate(() => window.a.destroy());
    const invalid = await page.evaluate(() => {
      try { new window.PageHeatmap({ renderer: () => { throw new Error('factory failure'); } }); return false; } catch { return true; }
    });
    assert(invalid);
    assert.equal(await page.locator('[data-page-heatmap]').count(), 0);
    assert.deepEqual(await audit(page), { listeners: 0, observers: 0, raf: 0 });
  });

  console.log(`PASS ${passed} browser integration groups (${await browser.version()}; ${executablePath})`);
} finally {
  if (browser) await browser.close();
  if (server) await server.close();
}
