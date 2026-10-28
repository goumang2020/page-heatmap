import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { arch, cpus, platform, release, totalmem } from 'node:os';
import { join, resolve } from 'node:path';
import { cache, prepare, root } from './prepare.mjs';

const executablePath = process.env.CHROMIUM_EXECUTABLE_PATH ?? process.env.CHROME_PATH ?? ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(existsSync);
if (!executablePath || !existsSync(executablePath)) throw new Error('Set CHROMIUM_EXECUTABLE_PATH to an installed Chromium browser.');
const counts = (process.env.BENCH_COUNTS ?? '100,500,1000').split(',').map(Number);
const dprs = (process.env.BENCH_DPRS ?? '1,2').split(',').map(Number);
const rounds = Number(process.env.BENCH_ROUNDS ?? '3');
const iterations = Number(process.env.BENCH_ITERATIONS ?? '10');
const idleMs = Number(process.env.BENCH_IDLE_MS ?? '1000');
if (![...counts, ...dprs, rounds, iterations, idleMs].every(value => Number.isFinite(value) && value > 0)) throw new Error('Benchmark parameters must be positive finite numbers.');
if (![...counts, rounds, iterations].every(Number.isInteger)) throw new Error('Counts, rounds and iterations must be integers.');
if (!counts.every(count => count % 2 === 0)) throw new Error('Use even point counts so legacy median and fixed new max have equivalent update normalization.');
const viewport = { width: 1280, height: 720 };
const provenance = await prepare();
const results = [];
const browser = await chromium.launch({ executablePath, headless: true });

async function waitForPaint(page, previous) {
  return page.evaluate(previous => new Promise((resolveWait, reject) => {
    const deadline = performance.now() + 5000;
    const check = () => {
      if (window.bench.stats.drawCalls > previous) return resolveWait(window.bench.stats.lastDrawEnd);
      if (performance.now() > deadline) return reject(new Error('Timed out waiting for a heatmap paint'));
      setTimeout(check, 5);
    };
    check();
  }), previous);
}

async function snapshot(page) {
  return page.evaluate(() => ({ ...window.bench.stats, backing: [...document.querySelectorAll('canvas')].map(canvas => ({ width: canvas.width, height: canvas.height })) }));
}

function delta(after, before) {
  return Object.fromEntries(['rafCallbacks', 'rafMs', 'geometryPasses', 'geometryMs', 'drawCalls', 'drawMs', 'resizeMs'].map(key => [key, after[key] - before[key]]));
}

async function runCase(implementation, count, dpr, round) {
  // A fresh page is the cleanup boundary: legacy Adapter.destroy() does not stop its RAF.
  const context = await browser.newContext({ viewport, deviceScaleFactor: dpr });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.setContent(`<html><head><style>html,body{margin:0;width:${viewport.width}px;height:${viewport.height}px;overflow:hidden}.target{position:absolute;width:12px;height:12px;background:#999}</style></head><body></body></html>`);
    await page.evaluate(({ count, width, height }) => {
      const columns = Math.ceil(Math.sqrt(count * width / height));
      const rows = Math.ceil(count / columns);
      const fragment = document.createDocumentFragment();
      for (let index = 0; index < count; index++) {
        const target = document.createElement('div');
        target.id = `point-${index}`;
        target.className = 'target';
        target.style.left = `${40 + (index % columns) * (width - 80) / columns}px`;
        target.style.top = `${40 + Math.floor(index / columns) * (height - 80) / rows}px`;
        fragment.append(target);
      }
      document.body.append(fragment);
    }, { count, ...viewport });
    await page.addScriptTag({ path: join(cache, `${implementation}.js`) });
    const started = await page.evaluate(({ implementation, count }) => {
      const stats = { rafCallbacks: 0, rafMs: 0, geometryPasses: 0, geometryMs: 0, drawCalls: 0, drawMs: 0, resizeMs: 0, lastDrawEnd: 0 };
      const data = Array.from({ length: count }, (_, index) => ({ id: `point-${index}`, selector: `#point-${index}`, value: 50 }));
      const nativeRaf = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = callback => nativeRaf(time => {
        const begin = performance.now();
        try { callback(time); } finally { stats.rafCallbacks++; stats.rafMs += performance.now() - begin; }
      });
      const bench = window.bench = { stats, data, map: null, points: [], implementation };
      const begin = performance.now();
      if (implementation === 'legacy') {
        const originalDraw = window.LegacyHeatmap.Heatmap.prototype.drawArea;
        window.LegacyHeatmap.Heatmap.prototype.drawArea = function(...args) {
          const start = performance.now();
          try { return originalDraw.apply(this, args); } finally { stats.drawMs += performance.now() - start; stats.drawCalls++; stats.lastDrawEnd = performance.now(); }
        };
        const processor = window.LegacyHeatmap.createPreProcessor(window, points => { bench.points = points; });
        bench.map = new window.LegacyHeatmap.Adapter({
          $win: window, initData: data, dataLengthFixed: true,
          // Transparent background and equal CSS brush radius; other legacy internals stay unchanged.
          option: { bgAlpha: 0, minAlpha: 0, blurSize: 30 },
          customProcessor: input => {
            const start = performance.now();
            try { return processor(input); } finally { stats.geometryPasses++; stats.geometryMs += performance.now() - start; }
          },
        });
        bench.map.start();
      } else {
        bench.map = new window.ModernHeatmap.PageHeatmap({
          data, max: 100, visibility: 'unoccluded',
          renderer: canvas => {
            const renderer = new window.ModernHeatmap.CanvasRenderer(canvas);
            return {
              resize(size) { const start = performance.now(); try { renderer.resize(size); } finally { stats.resizeMs += performance.now() - start; } },
              draw(points) {
                bench.points = points;
                const start = performance.now();
                try { renderer.draw(points); } finally { stats.drawMs += performance.now() - start; stats.drawCalls++; stats.lastDrawEnd = performance.now(); }
              },
              destroy() { renderer.destroy(); },
            };
          },
        });
        // Instrumentation only: compiled TS private method, not public API.
        const originalPaint = bench.map.paint.bind(bench.map);
        bench.map.paint = () => {
          const start = performance.now(), drawBefore = stats.drawMs, resizeBefore = stats.resizeMs;
          try { originalPaint(); } finally {
            stats.geometryPasses++;
            stats.geometryMs += Math.max(0, performance.now() - start - (stats.drawMs - drawBefore) - (stats.resizeMs - resizeBefore));
          }
        };
      }
      return begin;
    }, { implementation, count });
    const firstPaint = await waitForPaint(page, 0);
    await page.waitForTimeout(200); // Settle initial ResizeObserver notifications and library startup.
    const initial = await snapshot(page);
    const initialPointCount = await page.evaluate(() => window.bench.points.filter(point => window.bench.implementation === 'legacy' ? point.visible : true).length);
    if (initialPointCount !== count) throw new Error(`Only ${initialPointCount}/${count} points resolved at initial paint`);
    const cdp = await context.newCDPSession(page);
    await cdp.send('Performance.enable');
    const taskDuration = async () => (await cdp.send('Performance.getMetrics')).metrics.find(metric => metric.name === 'TaskDuration')?.value ?? 0;
    const beforeIdle = await snapshot(page), cpuBefore = await taskDuration();
    await page.waitForTimeout(idleMs);
    const cpuAfter = await taskDuration(), afterIdle = await snapshot(page);
    const idle = { requestedWallMs: idleMs, taskDurationMs: (cpuAfter - cpuBefore) * 1000, ...delta(afterIdle, beforeIdle) };
    if (implementation === 'modern' && (idle.rafCallbacks || idle.drawCalls || idle.geometryPasses)) throw new Error('Modern heatmap unexpectedly did work while idle');
    const movement = [];
    for (const all of [false, true]) {
      for (let index = 0; index < iterations + 2; index++) {
        const before = await snapshot(page);
        const updateStart = await page.evaluate(({ index, all }) => {
          const targets = all ? document.querySelectorAll('.target') : [document.querySelector('.target')];
          const start = performance.now();
          for (const target of targets) target.style.transform = `translateX(${index % 2 ? 0 : 4}px)`;
          return start;
        }, { index, all });
        const end = await waitForPaint(page, before.drawCalls);
        const after = await snapshot(page);
        if (index >= 2) movement.push({ workload: all ? 'all-points-move' : 'one-point-moves', latencyMs: end - updateStart, ...delta(after, before) });
      }
    }
    const dataUpdates = [];
    for (let index = 0; index < iterations + 2; index++) {
      const before = await snapshot(page);
      const update = await page.evaluate(index => {
        const data = window.bench.data.map((point, pointIndex) => ({ ...point, value: (pointIndex + index) % 2 ? 25 : 75 }));
        const start = performance.now();
        if (window.bench.implementation === 'legacy') window.bench.map.reset(data);
        else window.bench.map.setData(data);
        return { start, synchronousMs: performance.now() - start };
      }, index);
      const end = await waitForPaint(page, before.drawCalls);
      if (index >= 2) dataUpdates.push({ latencyMs: end - update.start, synchronousMs: update.synchronousMs, ...delta(await snapshot(page), before) });
    }
    let refreshBurst = null;
    if (implementation === 'modern') {
      const before = await snapshot(page);
      await page.evaluate(() => { for (let index = 0; index < 100; index++) window.bench.map.refresh(); });
      await page.waitForTimeout(150);
      refreshBurst = delta(await snapshot(page), before);
      if (refreshBurst.drawCalls !== 0 || refreshBurst.rafCallbacks > 2) throw new Error('Unchanged refresh burst was not coalesced');
    }
    if (errors.length) throw new Error(errors.join('\n'));
    return { implementation, count, dpr, round, firstPaintLatencyMs: firstPaint - started, initial, idle, movement, dataUpdates, refreshBurst };
  } finally { await context.close(); }
}

try {
  for (let round = 0; round < rounds; round++) {
    for (const count of counts) for (const dpr of dprs) {
      // Alternate order to reduce a systematic first-run bias; retain all raw samples.
      for (const implementation of round % 2 ? ['modern', 'legacy'] : ['legacy', 'modern']) {
        process.stdout.write(`${implementation}: ${count} points, DPR ${dpr}, round ${round + 1}/${rounds}\n`);
        results.push(await runCase(implementation, count, dpr, round));
      }
    }
  }
  const output = resolve(process.env.BENCH_OUTPUT ?? join(root, 'benchmarks/results/latest.json'));
  await mkdir(resolve(output, '..'), { recursive: true });
  await writeFile(output, `${JSON.stringify({
    generatedAt: new Date().toISOString(), experiment: 'New same-host public-source comparison; not the unavailable Mac benchmark',
    host: { platform: platform(), release: release(), arch: arch(), cpu: cpus()[0]?.model, logicalCpus: cpus().length, memoryBytes: totalmem(), node: process.version, browser: browser.version() },
    configuration: { viewport, counts, dprs, rounds, iterations, idleMs, visibility: 'unoccluded', normalization: 'all values 50; max 100 vs legacy median-based 0.5; updates use equal numbers of 25 and 75', instrumentation: 'Both RAF and renderer timed; legacy geometry is preprocessor, modern geometry is paint minus renderer/resize (also includes bookkeeping)', dprCaveat: 'Legacy ignores DPR. DPR 1 is equal backing-pixel comparison; DPR 2 is a quality/workload contrast, not an equivalent pixel-work comparison.' },
    provenance, results,
  }, null, 2)}\n`);
  console.log(`Saved ${results.length} cases to ${output}`);
} finally { await browser.close(); }
