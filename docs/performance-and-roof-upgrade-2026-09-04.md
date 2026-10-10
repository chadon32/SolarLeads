# Performance and 3D roof viewer upgrade

## Results

| Benchmark | Before | After | Interpretation |
| --- | ---: | ---: | --- |
| 95-panel scene draw calls per rendered frame, including shadows | 297 | 17 | 94.3% fewer submissions |
| Idle scene draw calls in a one-second desktop observation | 4,158 | 0 | No continuous rendering of a stationary roof |
| Idle scene draw calls in a one-second phone-size observation | 14,553 | 0 | Same on-demand behavior at 393 x 852 |
| 200-candidate selection, fresh computation vs exact-key reuse | 8.194 ms | 0.054 ms | Median microbenchmark; same cohort checksum |
| Failed roof-cache read with immediate network rejection | 7,011.7 ms | 2.8 ms | Mocked network failure; removed SDK retry backoff |
| Stalled roof-cache read | Previously unbounded | 2,001 ms | Entire operation, including legacy fallback, has a shared deadline |

Initial model-ready time was approximately unchanged: desktop 2,607 ms before
and 2,712 ms in the final after run; phone-size 2,573 ms before and 2,476 ms
after. Earlier after runs ranged from 2,396 to 2,403 ms. These small differences
are not evidence of a reliable initial-load improvement. The demonstrated gains
are less repeated calculation, far fewer draw calls, no idle rendering, and
fast recovery from a failed optional cache.

The previous address-suggestion optimization was already in place at this
baseline. Its 7.2-second-to-0.12-second result is not claimed again here.

## Method

- Reused the one guarded local Webpack dev server at `http://localhost:3000`.
- Desktop Chromium: 1440 x 1000. Phone-size Chromium: 393 x 852.
- Deterministic synthetic gable roof and elevation raster, 100 candidate
  positions, 95 modules after the application's existing conservative capacity
  and selected-module sizing rules. Same data and selected count before/after.
- Paid APIs, leads, uploads, and analytics stubbed or blocked. No real homeowner
  data, leads, emails, or production database records used.
- Instrumented WebGL2 draw submissions and default-framebuffer clears. Waited
  three seconds after readiness, measured one second idle, then ran the same
  drag gesture. Both normal and shadow draw calls count toward the totals.
- This is local Chromium rendering, not an iPhone GPU or native-device benchmark.
  Draw counts are not claims about real-device FPS or battery percentage.
- Selection benchmark runs 50 iterations for 50/100 candidates and 25 for 200.
  Fresh arrays force computation; repeated arrays exercise the new guarded
  cache. The fresh benchmark includes constructing the synthetic panel array.
- Network-outage benchmark uses the same installed Supabase SDK and fake fetch
  responses. It reproduces the old 1/2/4-second retry delays without contacting
  a database. It does not measure healthy production-network performance.

### Selection details

| Candidates | Selected | Fresh median | Cached median |
| ---: | ---: | ---: | ---: |
| 50 | 25 | 0.511 ms | 0.013 ms |
| 100 | 50 | 1.849 ms | 0.025 ms |
| 200 | 100 | 8.194 ms | 0.054 ms |

## Changes

### Rendering and model

- Replaced per-panel meshes with instanced frame, portrait glass, landscape
  glass, and illustrative rail batches. Updated bounds whenever instances
  change so zooming and changing the selected equipment do not cull panels.
- Preserved the exact heading-then-local-tilt transform of the old nested
  groups. Panel locations, counts, dimensions, roof-plane fits, and energy
  calculations are not changed to make the model look better.
- Added subtle modeled racking and ground-received shadows; retained the
  elevation-based roof surfaces, cell texture, and sunlight overlay behavior.
- Added responsive bounding-box camera framing, north-up overhead view,
  perspective view, reset, zoom controls, and keyboard orbit/zoom/reset.
- Camera buttons meet 44 x 44 CSS-pixel targets and fit the 393-pixel embedded
  app layout. Instructions and controls have accessible names.
- Collapsed detailed module specifications so the equipment overlay occupies
  less of the model view. The module selector remains immediately available.
- Freed the temporary WebGL capability-check context and removed the unused
  preserved drawing buffer. Browser screenshots continue to work.
- Render on demand rather than every animation frame. Changes and OrbitControls
  invalidate the frame, retaining smooth damping while interacting.
- Defer the satellite map and its overlays until the Sunlight tab is opened.
  They no longer draw underneath the default 3D view or obscure it with a pin.
- Added a retry action for failed 3D loads.

These changes follow the [React Three Fiber performance guidance](https://r3f.docs.pmnd.rs/advanced/scaling-performance)
and [Three.js instance-transform and bounds guidance](https://threejs.org/docs/pages/InstancedMesh.html).

### Calculation reuse

The selection cache is keyed by panel-array identity, selected count, and both
module dimensions. Entries additionally check member references and all
selection-relevant geometry/energy fields, so in-place edits cannot return stale
cohorts. Each live array retains at most 32 selection entries, and callers get
a fresh result array. The placement algorithm and pricing remain unchanged.

### Optional database cache

Roof-cache reads and best-effort writes now have a shared two-second deadline
and no automatic SDK retries. Healthy hits, version/expiry checks, normalization,
and legacy-column fallback remain intact. A slow cache can become a miss, which
may require the existing paid-analysis path; the existing paid-path limits are
unchanged. This does not fix the underlying database DNS/configuration issue.

## Visual evidence

Screenshots use the synthetic benchmark property, not a claim about a real home.

### Before

![Previous desktop roof viewer](C:/Users/chado/Documents/arizona-solar-ai/qa-evidence/performance-before/roof-1440.png)

### After

![Upgraded desktop roof viewer](C:/Users/chado/Documents/arizona-solar-ai/qa-evidence/performance-after/roof-1440.png)

![Upgraded phone-size roof viewer](C:/Users/chado/Documents/arizona-solar-ai/qa-evidence/performance-after/roof-393.png)

Raw measurements are in `qa-evidence/performance-before/` and
`qa-evidence/performance-after/`.

## Reproduce

```powershell
# Reuse the already-running guarded local server; do not start another one.
$env:PLAYWRIGHT_BASE_URL = 'http://localhost:3000'
$env:RUN_PERFORMANCE_BENCHMARK = 'true'
$env:PERFORMANCE_PHASE = 'verification'
npx playwright test tests/e2e/performance-benchmark.spec.ts --project=chromium-desktop --reporter=list
Remove-Item Env:RUN_PERFORMANCE_BENCHMARK

node --import tsx scripts/benchmark-panel-selection.ts
node --import tsx --conditions=react-server --test tests/roof-cache-performance.test.ts
```

## Verification

- 154 unit tests passed, including the existing pricing, signed-report, energy,
  panel-geometry, and placement regression tests.
- Added exact matrix-equivalence checks for 24 combinations of heading, pitch,
  and portrait/landscape orientation; framing at five aspect ratios; north-up.
- Added cache tests for member replacement, in-place geometry and energy edits,
  caller mutations, dimensions, count, and bounded-cache eviction.
- New browser checks passed for camera actions, keyboard control, panel toggles,
  deferred-map initialization, repeated Sunlight/3D switching, and the embedded
  app layout. Six focused roof tests and nine address tests passed.
- Both opt-in performance scenarios passed with zero JavaScript page errors.
- Web and native TypeScript checks, focused ESLint, and diff checks passed.
- Production Webpack build passed. The final build limited page-data collection
  to two workers using `CIRCLE_NODE_TOTAL=3` for that command only.
- Build warnings remain: GeoTIFF's transitive Node worker dynamic dependency,
  the edge-rendered route's static-generation notice, and unconfigured local
  Google Analytics. These did not fail the build.
- Full browser suite: 128 passed in 6.3 minutes. The two opt-in performance
  scenarios were skipped in that suite and passed separately as noted above.

## Boundaries

This is a preliminary CAD-style roof reconstruction, not photogrammetry or a
surveyed house. Roof geometry depends on the source outlines and elevation
quality. Mounting rails, cell appearance, wall skirts, and lighting are
illustrative; no doors, windows, vents, or architectural details were fabricated
as detected features. Layout and structural/electrical suitability still need
installer verification.

No deployment, Git push, App Store submission, or native binary rebuild was
performed. No physical iPhone/Android device, production dataset, healthy
production-cache latency, field accuracy, or production WebView performance was
validated. The database connectivity problem still needs separate resolution.
