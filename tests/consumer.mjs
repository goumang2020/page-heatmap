import { strict as assert } from 'node:assert';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const consumer = await mkdtemp(join(tmpdir(), 'page-heatmap-consumer-'));
const run = (args) => {
  const result = spawnSync(process.execPath, args, { cwd: consumer, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout || 'consumer process failed');
};
try {
  await mkdir(join(consumer, 'node_modules'));
  await symlink(root, join(consumer, 'node_modules', 'page-heatmap'), 'junction');
  await writeFile(join(consumer, 'package.json'), '{"type":"module"}');
  await writeFile(join(consumer, 'index.ts'), `
import { PageHeatmap, CanvasRenderer, type HeatDatum, type HeatmapOptions, type CanvasRendererOptions } from 'page-heatmap';
const data: HeatDatum[] = [{ id: '0', selector: '#target', value: 1 }];
const style: CanvasRendererOptions = { radius: 25, blur: 15, minOpacity: 0 };
const options: HeatmapOptions = { data, renderer: canvas => new CanvasRenderer(canvas, style) };
export function mount(): PageHeatmap { return new PageHeatmap(options); }
`);
  for (const [module, resolution] of [['NodeNext', 'NodeNext'], ['Node16', 'Node16'], ['ESNext', 'bundler']]) {
    run([join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--skipLibCheck', 'false', '--target', 'ES2022', '--lib', 'ES2022,DOM,DOM.Iterable', '--module', module, '--moduleResolution', resolution, 'index.ts']);
    console.log(`PASS package declarations: ${resolution}`);
  }
  // SSR/import safety: importing the built package must not require window/DOM.
  run(['--input-type=module', '-e', "const { PageHeatmap, CanvasRenderer } = await import('page-heatmap'); if (typeof PageHeatmap !== 'function' || typeof CanvasRenderer !== 'function') throw new Error('missing exports')"]);
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  assert.deepEqual(manifest.files, ['dist']);
  console.log('PASS package ESM exports and SSR import');
} finally {
  await rm(consumer, { recursive: true, force: true });
}
