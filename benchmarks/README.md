# Reproducible browser benchmark

This is a **new experiment from public Git history**, not a continuation of the
unavailable Mac data archive. Do not mix these measurements with earlier Mac
numbers or claim a cross-machine speedup.

## Run

```sh
npm ci
# Preparation only: public Git source -> two local self-contained browser bundles.
node benchmarks/prepare.mjs
# Installed Chromium; no server, proxy, remote page, or arbitrary URL is used.
CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium node benchmarks/run.mjs
node benchmarks/summarize.mjs > benchmarks/results/summary.md
```

Preparation clones the public `goumang2010/animate-heatmap` repository if needed;
it uses no credentials and does not run the historical npm install/preinstall.
In a source ZIP without `.git`, preparation also clones the public
`goumang2020/page-heatmap` repository into the cache to recover and verify the
pinned **old** adapter commit. A normal checkout keeps using its existing Git
history. This does not replace or change the new source files being measured.
An already available public clone can be selected with
`ANIMATE_HEATMAP_REPO=/absolute/path`. All extracted source and bundles are
disposable files under ignored `benchmarks/.cache/`, with original licenses.

The default matrix is 100 / 500 / 1000 points, DPR 1 / 2, three rounds, ten
measured iterations per changed workload, and 1000 ms of idle observation.
Two iterations of each changed workload are warmup and are discarded. Each
case starts in a fresh browser page; variant order alternates each round.
Override with `BENCH_COUNTS`, `BENCH_DPRS`, `BENCH_ROUNDS`,
`BENCH_ITERATIONS`, `BENCH_IDLE_MS`, and `BENCH_OUTPUT`.

Smoke-test example (not a statistically useful performance result):

```sh
BENCH_COUNTS=100 BENCH_DPRS=1 BENCH_ROUNDS=1 BENCH_ITERATIONS=2 \
  CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium node benchmarks/run.mjs
```

## Sources and provenance

- Old adapter: `1f8f68bf4ace4f592c7d0c33f9cf563ca025e1ae` in
  [goumang2020/page-heatmap](https://github.com/goumang2020/page-heatmap/tree/1f8f68bf4ace4f592c7d0c33f9cf563ca025e1ae).
- Old renderer: submodule commit `4aa7e38b11172f5a9b8379e65a6b1f831d1bcaf2` in
  [goumang2010/animate-heatmap](https://github.com/goumang2010/animate-heatmap/tree/4aa7e38b11172f5a9b8379e65a6b1f831d1bcaf2).
- New renderer: the installed, locked `simpleheat` dependency; new adapter:
  the current local `src` files. Reports retain their SHA-256 hashes, the lock
  hash, Git HEAD and dirty status, bundle hashes, Node/browser versions and host
  configuration. HEAD alone is not the identity of uncommitted code.
  For a source archive, `modernGitAvailable` is false and `modernHead` /
  `modernDirtyStatus` are null; actual local source and lock hashes remain
  authoritative. The old cloned commit is never presented as the new snapshot's
  commit identity.

The old committed `dist` is intentionally not used: this compares pinned source
bundled by the same current tool, rather than potentially stale distribution
output or an old toolchain's install behavior. One build-only compatibility
transform removes the unused `createPointsPosToIdx` import: its historical
export does not exist, which old Babel/Webpack tolerated but modern linking
rejects. Extracted source stays unchanged and this transform is recorded in
provenance. No old runtime behavior is repaired. Its unreliable `destroy()` is not used as a cleanup boundary;
closing the isolated page discards its loop and listeners.

## Workloads and measurements

The page is a deterministic local 1280 × 720 grid with all target centers inside
the viewport. Both versions resolve the same CSS selectors. The new version
uses `visibility: 'unoccluded'` to match the old version's center hit-testing.
This is intentionally stricter and more work than the new default `viewport`.
Initial values are 50; fixed new max 100 matches old median normalization at
0.5. Data updates use equal numbers of 25 and 75 (use even point counts).

The legacy background is made transparent with `bgAlpha: 0`, and its opacity
floor is set to zero to avoid including a background veil in the comparison.
CSS brush radius/blur are 28/30 for both, but color ramps and pixel algorithms
are not identical. Legacy rounds centers; modern positions can be fractional.

Recorded stages:

1. **First paint latency**: constructor start until first completed renderer
   draw, including data processing, initialization, scheduling and rendering.
2. **Idle**: RAF callback count/time, geometry passes/time, draw count/time, and
   Chromium CDP `TaskDuration` delta during a stated quiet observation window.
   Task duration includes browser/harness activity; it is not exclusive library
   CPU. The modern case asserts zero geometry/draw/RAF work while idle.
3. **One target moves / every target moves**: external DOM style changes until
   the next completed paint, including scheduling and actual drawing. The old
   incremental regional painter and the new full viewport painter may favor
   different workloads; report both rather than selecting the favorable one.
4. **Data replacement**: synchronous `reset` / `setData` duration and latency to
   completed paint. New data validation and old median calculation have
   different responsibilities; this is an API workload, not equivalent math.
5. **Modern refresh burst**: 100 unchanged `refresh()` calls must coalesce and
   must not cause a renderer draw. This is a correctness check, not an old/new
   speed comparison.

The timed legacy geometry phase is its preprocessor; the modern geometry phase
is its internal paint method minus renderer and resize time, and therefore also
includes selector resolution, normalization and change detection. It is a
useful phase diagnostic, **not an exact apples-to-apples geometry microbenchmark**.
Instrumentation adds overhead to both; all raw samples remain in JSON.

**DPR 1 is the equal backing-pixel workload.** The old renderer ignores device
pixel ratio. DPR 2 gives the new renderer four times as many backing pixels and
better pixel density, so DPR 2 must be reported as a quality/workload contrast,
not a fair raw rendering speed race. Backing dimensions are retained per case.

## Interpreting results

Use repeated same-host runs, keep foreground/background policy and power mode
consistent, and record the full raw JSON alongside any summary. p50/p95 here
use the nearest-rank method. First paint only has one sample per case/round;
do not infer a reliable tail from three cold samples. Tight timer resolution,
background scheduling, CPU contention and headless rendering affect results.
Do not infer production responsiveness, memory leaks or visual equivalence from
these timings alone; those belong in the functional browser tests.

No result is implied by the presence of this harness. A failed browser launch,
incomplete case, missing baseline or failed correctness assertion is not a pass
and produces no final benchmark JSON. If the execution sandbox prevents local
browser sockets, use a properly authorized browser-capable executor; do not
bypass sandbox policy or silently substitute numbers from another machine.
