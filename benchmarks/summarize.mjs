import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { root } from './prepare.mjs';

const file = resolve(process.argv[2] ?? `${root}/benchmarks/results/latest.json`);
const report = JSON.parse(await readFile(file, 'utf8'));
if (!Array.isArray(report.results) || !report.results.length) throw new Error('No completed cases in this report.');
const quantile = (values, p) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return '—';
  return sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)].toFixed(2);
};
const groups = new Map();
for (const result of report.results) {
  const key = `${result.implementation} | ${result.count} | ${result.dpr}`;
  groups.set(key, [...(groups.get(key) ?? []), result]);
}
console.log(`# Same-host browser benchmark\n\n${report.generatedAt}; ${report.host.platform} ${report.host.arch}; ${report.host.browser}; Node ${report.host.node}.\n`);
console.log('All times are milliseconds. Values are measured observations, not cross-machine speedup claims. DPR 2 is **not** equal pixel workload: the legacy renderer ignores DPR.\n');
console.log('| Implementation | Points | DPR | First paint p50 | Idle task ms p50 | Idle RAF p50 | One-point move p50 / p95 | All-point move p50 / p95 | Data update p50 / p95 |');
console.log('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
for (const [key, cases] of groups) {
  const one = cases.flatMap(result => result.movement.filter(item => item.workload === 'one-point-moves').map(item => item.latencyMs));
  const all = cases.flatMap(result => result.movement.filter(item => item.workload === 'all-points-move').map(item => item.latencyMs));
  const data = cases.flatMap(result => result.dataUpdates.map(item => item.latencyMs));
  console.log(`| ${key} | ${quantile(cases.map(result => result.firstPaintLatencyMs), .5)} | ${quantile(cases.map(result => result.idle.taskDurationMs), .5)} | ${quantile(cases.map(result => result.idle.rafCallbacks), .5)} | ${quantile(one, .5)} / ${quantile(one, .95)} | ${quantile(all, .5)} / ${quantile(all, .95)} | ${quantile(data, .5)} / ${quantile(data, .95)} |`);
}
console.log('\nRaw JSON retains renderer time, geometry/bookkeeping time, synchronous setData/reset cost, individual samples, bundle hashes, source hashes, backing dimensions, host metadata, and correctness checks. See benchmarks/README.md for limitations.');
