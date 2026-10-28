import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const cache = join(root, 'benchmarks/.cache');
export const legacySha = '1f8f68bf4ace4f592c7d0c33f9cf563ca025e1ae';
export const rendererSha = '4aa7e38b11172f5a9b8379e65a6b1f831d1bcaf2';
const git = (cwd, ...args) => execFileSync('git', ['-c', 'credential.helper=', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trimEnd();
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

async function extract(cwd, sha, prefix, destination) {
  const paths = git(cwd, 'ls-tree', '-r', '--name-only', sha, prefix).split('\n').filter(Boolean);
  for (const path of paths) {
    if (path.startsWith('/') || path.split('/').includes('..')) throw new Error(`Unsafe source path: ${path}`);
    const target = join(destination, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, execFileSync('git', ['show', `${sha}:${path}`], { cwd }));
  }
}

/** Read only pinned public Git history; never reuse the unavailable Mac transfer. */
export async function prepare() {
  await mkdir(cache, { recursive: true });
  const modernGitAvailable = existsSync(join(root, '.git'));
  const adapterRepo = modernGitAvailable ? root : join(cache, 'page-heatmap-public');
  if (!existsSync(adapterRepo)) {
    execFileSync('git', ['-c', 'credential.helper=', 'clone', '--no-checkout', 'https://github.com/goumang2020/page-heatmap.git', adapterRepo], { cwd: root, stdio: 'inherit' });
  }
  if (git(adapterRepo, 'rev-parse', `${legacySha}^{commit}`) !== legacySha) throw new Error('Legacy commit mismatch');
  const rendererRepo = process.env.ANIMATE_HEATMAP_REPO ? resolve(process.env.ANIMATE_HEATMAP_REPO) : join(cache, 'animate-heatmap-public');
  if (!existsSync(rendererRepo)) {
    execFileSync('git', ['-c', 'credential.helper=', 'clone', '--no-checkout', 'https://github.com/goumang2010/animate-heatmap.git', rendererRepo], { cwd: root, stdio: 'inherit' });
  }
  if (git(rendererRepo, 'rev-parse', `${rendererSha}^{commit}`) !== rendererSha) throw new Error('Legacy renderer commit mismatch');
  const legacyRoot = join(cache, 'legacy');
  await extract(adapterRepo, legacySha, 'src', legacyRoot);
  await extract(adapterRepo, legacySha, 'LICENSE', legacyRoot);
  await extract(rendererRepo, rendererSha, 'src', join(legacyRoot, 'heatmap'));
  await extract(rendererRepo, rendererSha, 'LICENSE', join(legacyRoot, 'heatmap'));
  const oldEntry = join(legacyRoot, 'entry.js');
  await writeFile(oldEntry, "export { default as Adapter } from './src/index.js';\nexport { default as Heatmap } from './heatmap/src/index.js';\nexport { createPreProcessor, trimData } from './src/utils.js';\n");
  const newEntry = join(cache, 'modern-entry.ts');
  await writeFile(newEntry, "export { PageHeatmap, CanvasRenderer } from '../../src/index.ts';\n");
  for (const [name, entry, globalName] of [['legacy', oldEntry, 'LegacyHeatmap'], ['modern', newEntry, 'ModernHeatmap']]) {
    await build({
      root, configFile: false, logLevel: 'warn',
      plugins: name === 'legacy' ? [{
        name: 'legacy-unused-import-compat',
        transform(code, id) {
          if (!id.endsWith('/legacy/heatmap/src/index.js')) return null;
          // Old Babel/Webpack tolerated this unused import of a nonexistent export.
          // Preserve extracted source; remove only this dead specifier during linking.
          if ((code.match(/createPointsPosToIdx/g) ?? []).length !== 1) throw new Error('Legacy import compatibility assumption changed');
          return code.replace(', createPointsPosToIdx', '');
        },
      }] : [],
      define: { 'process.env.NODE_ENV': JSON.stringify('production') },
      build: {
        target: 'es2022', minify: false, emptyOutDir: false, outDir: cache,
        lib: { entry, name: globalName, formats: ['iife'], fileName: () => `${name}.js` },
      },
    });
  }
  const sourceFiles = ['src/index.ts', 'src/types.ts', 'src/data.ts', 'src/renderer.ts', 'package-lock.json'];
  const sourceHashes = {};
  for (const file of sourceFiles) sourceHashes[file] = sha256(await readFile(join(root, file)));
  const provenance = {
    legacyAdapterCommit: legacySha, legacyRendererCommit: rendererSha,
    legacyBuildAdjustment: 'During bundling only, remove unused import specifier createPointsPosToIdx (nonexistent historical export); runtime source otherwise unchanged.',
    modernGitAvailable,
    modernHead: modernGitAvailable ? git(root, 'rev-parse', 'HEAD') : null,
    modernDirtyStatus: modernGitAvailable ? git(root, 'status', '--short') : null,
    modernSourceSha256: sourceHashes,
    bundleSha256: { legacy: sha256(await readFile(join(cache, 'legacy.js'))), modern: sha256(await readFile(join(cache, 'modern.js'))) },
  };
  await writeFile(join(cache, 'provenance.json'), `${JSON.stringify(provenance, null, 2)}\n`);
  return provenance;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await prepare(), null, 2));
}
