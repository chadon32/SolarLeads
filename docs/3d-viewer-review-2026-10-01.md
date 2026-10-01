# 3D roof viewer review and upgrade — 2026-10-01

Scope: the interactive 3D roof model on `/estimate` (`src/components/roof-scene-3d.tsx`,
react-three-fiber 9.7 / drei 10.7 / three r184). There are no model files: every roof is
generated at runtime from Google Solar API data (segment planes, panel slots, and the DSM,
annual-flux and rooftop-mask GeoTIFFs). glTF/Draco/KTX2/Blender work does not apply.

Reviewed against live data for 1084 W Fever Tree Ave, Queen Creek (headless Chromium,
SwiftShader), with every proposed fix prototyped on the same data before implementation.

## Review findings

| Severity | Area | Finding |
| --- | --- | --- |
| High | Geometry | Roof faces were convex hulls of panel slots (or north-aligned bounding boxes) per segment, each extruded to the ground as its own prism (`google-solar.ts` `buildRoofSegmentOutlines`, `roof-scene-geometry.ts` wall skirts). The DSM shows a clean U-shaped house; the viewer showed slabs with a gap where the ridge is and loose wedges for the wings. |
| High | Lighting | No environment map, `flat` (no tone mapping), physically very low light intensities (hemisphere 0.42, sun 0.78, fill 0.16). The near-white roof rendered mid-gray; gable planes were near-identical; the key light sat ~17° from the default camera (front light). |
| High | Modules | Blue 60-cell texture for an all-black 6×22 half-cut default module; sub-pixel frames merged 21 modules into one dark square that read as a hole from above. |
| High | Trust | "Shading obstruction (detected)" was an inset of the shadiest segment's bounding box (`buildObstructionOutlines`), plus default boxes injected by `normalizeObstructionOutlines`. Nothing was detected. |
| High | Trust | Heatmap colours were stretched across the 8th–92nd percentile of every rooftop within 50 m (2D and 3D), so colours depended on neighbours; restricted to the house, a 10% east/west difference (1,703 vs 1,881 kWh/kW/yr) read as "shade vs sun". The 2D legend described a different (estimated) overlay. |
| Medium | Data | `pixelSizeMeters=0.5` quantises eaves and junctions to half a metre; the rooftop mask sits ~0.5 m inside the eaves. |
| Medium | Integration | Overlays covered ~⅓ of the canvas (Module panel hid part of the house); framing ignored them. |
| Medium | Mobile | The R3F container sets `touch-action: none`; a one-finger swipe on the 307×384 px model rotated instead of scrolling. |
| Medium | Interaction | Camera presets/zoom snapped instantly; no way to inspect a face. |
| Medium | Performance | First 3D open downloads ~1 MB of minified JS on click; flux + mask GeoTIFFs were fetched twice per estimate (`cache: "no-store"` in the 2D path). |
| Low | Code | `roof-model-3d.tsx` unused; `buildHeightfieldGeometry` / `smoothGrid` only used by tests. Catalog link for the Maxeon datasheet now redirects to the homepage. |

Measured before: 32 draw calls and 1.8k triangles per frame (render-on-demand), rasters
~250 KB total at 0.5 m.

## Implementation plan

Global constraints:
- No new dependencies. Next 16.3.5 (dev: webpack via `scripts/safe-next-dev.mjs`; build: Turbopack), React 19.2, three 0.184, R3F 9.7, drei 10.7.8 (`camera-controls` 3.1.2 already installed).
- Preserve e2e contracts: `data-testid="roof-scene-3d"` with a `canvas`, `data-rendered-panel-count`, `data-panel-height-meters`, `data-panel-width-meters`, toolbar "3D camera controls" and its button names, "Retry 3D model", keyboard Arrow/Home/+/-, and unmounting when the Sunlight tab is selected.
- Server-side analysis keeps 0.5 m rasters; only the browser data-layers route moves to 0.25 m.
- Respect `prefers-reduced-motion`. Pure geometry/data code stays DOM-free and unit-tested (node:test); WebGL output is verified with screenshots and a Playwright regression spec.
- No commits unless requested.

- [x] **1. Shared sunlight heatmap** — `src/lib/sunlight-heatmap.ts`: `sunlightRampPosition(flux, bestCaseFlux)` (share of best-case sun, 50% → 0, 100% → 1), `sunlightRampColor(t)`, `sunlightRampGradientCss()`, `colorRoofFlux({ flux, width, height, isRoofPixel, bestCaseFlux, outsideBleedPx, outsideRgba })` (interior-only colouring + edge fill + optional outside bleed). Tests: `tests/sunlight-heatmap.test.ts`.
- [x] **2. Module faces from the catalog** — `ModuleFaceLayout` on each `SolarPanel` (datasheet cell layouts: REC 5×16 half, Qcells 6×22 half, Canadian 6×18 half, Maxeon 6×11 back-contact, Jinko 6×18 half, Panasonic 6×22 half); `src/lib/module-face.ts` `planModuleFace(layout, { landscape })` + `paintModuleFace(ctx, plan)`. Tests: `tests/module-face.test.ts`.
- [x] **3. Overlay-aware framing math** — `src/lib/overlay-safe-area.ts` `computeSafeInsets(viewport, obstacles, options)` (largest uncovered rectangle scored by fitted model size). Tests: `tests/overlay-safe-area.test.ts`.
- [x] **4. Module outline segments** — `buildPanelOutlineSegments(panels)` in `src/lib/roof-viewer.ts` (one fat-line draw for the array). Tests: `tests/roof-viewer.test.ts`.
- [x] **5. Roof reconstruction** — `src/lib/roof-reconstruction.ts` `reconstructRoof(input)` → shell positions/uvs/indices, per-triangle face ids, walls inset under a 0.4 m eave overhang, a fascia band along the roof edge, faces (pitch, azimuth, area), real obstructions, roof pixel mask; `faceSunlightMedians(...)`. Thresholds in metres so 0.25 m and 0.5 m both work. Synthetic houses in `tests/fixtures/synthetic-roofs.ts` (gable, hip, L with valley, multi-level, rooftop unit). Tests: `tests/roof-reconstruction.test.ts`.
- [x] **6. Surroundings from the DSM** — `src/lib/roof-context.ts` `extractRoofContext(...)` → trees (canopy blobs) and neighbouring roofs (footprint + height) from real elevation data only. Tests: `tests/roof-context.test.ts`.
- [x] **7. Stop fabricating obstructions; resolution option** — `google-solar.ts` emits no obstruction outlines and `fetchSolarDataLayers(lat, lng, signal, { pixelSizeMeters })`; data-layers route requests 0.25 m; `roof-analysis.ts` normalisation keeps explicit empty arrays and the illustrative default has none. Tests in `tests/google-solar.test.ts` and `tests/roof-analysis-normalization.test.ts`.
- [x] **8. Worker** — `src/lib/roof-model.ts` (`computeRoofModel`: reconstruction + surroundings + per-face sunlight in one job), `src/workers/roof-model.worker.ts`, `src/lib/roof-model-worker-client.ts` (browser-only RPC) and `src/lib/roof-model-runner.ts` (worker when available, main-thread fallback when the worker cannot start, per-input cache of 6, 6 s timeout → per-segment model). Flag: `NEXT_PUBLIC_ROOF_RECONSTRUCTION=off` disables; `?roofModel=segments|reconstructed` overrides for QA. Tests: `tests/roof-model.test.ts`.
- [x] **9. 3D viewer** — `src/components/roof-scene-3d.tsx` + `src/components/roof-scene/`: PMREM studio environment (regenerated after context restore), Neutral tone mapping, SW key light, baked contact shadows, fat-line edges, darker walls, unlit absolute-scale heatmap with in-viewer legend, catalog-driven physical module skin + outlines, a short drop-in for newly added modules (skipped under reduced motion), eased camera rig with safe-area framing, tap-a-face info card + screen-reader face summary (`src/lib/roof-face-labels.ts`), real obstructions, surroundings toggle, mobile tap-to-explore gate, "Switch to map view" WebGL fallback.
- [x] **10. 2D integration** — `src/components/solar-analysis.tsx`: shared heatmap colouring through `readGeoTiffRaster` (no duplicate downloads), legend that matches the drawn layer (`src/components/sunlight-legend.tsx`), fabricated obstruction polygons and legend removed, overlays tagged `data-viewer-overlay`, 3D chunk prefetch on idle, module face + map-view callback passed to the viewer.
- [x] **11. Dead code** — delete `src/components/roof-model-3d.tsx`; remove `buildHeightfieldGeometry`, `smoothGrid`, `buildObstructionMarkerGeometry` and their tests.
- [x] **12. Screenshot regression set** — `tests/helpers/synthetic-roof-network.ts`, `tests/e2e/roof-model-regression.spec.ts` (+ snapshots) using the synthetic houses; adjust existing 3D specs only where framing changed by design.
- [x] **13. Verification** — `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, 3D e2e specs, real-data captures (desktop + mobile, 3D + 2D sunlight) at 0.25 m.
- [x] **14. Results** — record outcomes, evidence and follow-ups below.

## Results

Implemented 2026-10-01 on `codex/abuse-protection`, uncommitted.

### What changed, by finding

| Finding | Outcome |
| --- | --- |
| Geometry | One building per house: the DSM, rooftop mask and Google's panel-fitted planes are rebuilt into a single shell (`roof-reconstruction.ts`) with exact ridge/hip/valley lines, an eave overhang, fascia, inset walls and walls at roof steps. Falls back to the per-segment model when there is no mask, nothing reconstructs, the flag is off, or the worker takes over 6 s. |
| Lighting | Studio environment (PMREM, rebuilt after WebGL context loss), Khronos Neutral tone mapping, south-west key light with soft shadows, one baked contact shadow. Roof and walls are separated in value so the planes read before lighting does. |
| Modules | Cell layout, cell colour, backsheet and frame come from each catalog module's datasheet (half-cut, back-contact, landscape). Physical glass (clearcoat), one instanced draw for the array, one batched outline pass, a 240 ms drop-in when modules are added (off with reduced motion). |
| Obstructions | Nothing is fabricated any more: `google-solar.ts` emits no obstruction outlines, `roof-analysis.ts` keeps explicit empty arrays, and the 2D "shading obstruction" polygons and legend are gone. The 3D view shows only raised features measured in the DSM (grey blocks, ≥ 0.35 m above their own roof plane), and says so in the hint. |
| Heatmap | One absolute scale in 2D and 3D: each spot's share of the roof's best-case sun (Solar API `maxSunshineHoursPerYear`), 50 % → blue, 100 % → orange, coloured from interior pixels only so blended eave pixels do not read as shade. Same legend component on both views; unlit in 3D so faces show exactly the legend colour. |
| Data | The browser requests 0.25 m layers; server-side analysis stays at 0.5 m. |
| Integration | The camera frames the roof inside the largest overlay-free rectangle: the projection is shifted onto it (`setViewOffset`) and the fit uses that rectangle's own field of view and the model's box corners. The toolbar hint wraps to the controls' width, and the face card sits at the top of the free area, so panels never cover the model or each other (regression-tested). "Switch to map view" when WebGL is missing or the model fails. |
| Mobile | Touch devices get a "Tap to explore in 3D" gate, so one-finger swipes keep scrolling the page; Done and the Trees toggle move to the free top-right corner and the legend/hint move off the canvas. |
| Interaction | Eased camera presets and zoom (0.3 s, instant with reduced motion). Layout changes (overlays resizing, window resize) re-frame only a view the visitor has not moved, in its last preset, and never animate. Tap a roof face for direction, pitch, area, share of best-case sun and module count; the same facts are in the region's screen-reader description. |
| Performance | Reconstruction, surroundings and per-face sunlight run in a Web Worker, cached per input. The shadow map is rendered when content changes (model, modules, trees, context restore), not on every orbit frame. Each GeoTIFF is downloaded once per estimate (shared cache). The 3D chunk is prefetched on idle rather than downloaded on the first click. |
| Code | `roof-model-3d.tsx`, the heightfield/smoothing/obstruction-marker helpers and the fabricated-obstruction builders are deleted. |

Surroundings (new): trees and neighbouring roofs come from the DSM only. Canopy is tall, non-rooftop elevation at least 1.5 m from any rooftop; a toggle hides them.

### Found and fixed during verification

- **Overlay-aware framing never ran.** `useOverlaySafeInsets` read a ref in a mount-only effect, but the viewer region only mounts after the model loads, so insets stayed zero and every capture was framed on the full canvas. It now takes the element from a callback ref. With framing live, three follow-on fixes: the fit uses the free area's own field of view (`getRoofCameraPose(…, heightFraction)`); it fits the bounding-box corners instead of a bounding sphere (the sphere left a low house using about 47 % of the view, the box fit at least 70 %); and `planCameraUpdate` keeps layout changes from resetting a visitor's own view. Unit tests in `tests/roof-viewer.test.ts`.
- **Overlapping panels.** The face card ran into the Layers panel, and the longer obstruction hint pushed the toolbar card under the Module panel. The card now sits at the top of the free area and the hint wraps. The e2e spec asserts that no two viewer panels overlap, on desktop and on a touch phone.
- **Shadow pass every frame.** The shadow map was re-rendered on every orbit frame although the light and roof are static (53 draw calls and about 236k triangles per frame on Fever Tree). It now renders on request (`use-refresh-shadows.ts`). This was verified by instrumenting WebGL: no off-screen pass during orbit, and exactly one after toggling modules or trees. The screenshot baselines cannot catch a stale shadow map (a mutation that disabled the refresh still passed them), so the instrumented check is what proves it.

### Measurements

1084 W Fever Tree Ave, live Solar API data at 0.25 m, headless Chromium with SwiftShader, 1440 × 900. "Before" figures are from the review above.

| | Before | After |
| --- | --- | --- |
| Draw calls per orbit frame | 32 | 16 (no shadow or contact-shadow pass while orbiting) |
| Triangles per orbit frame | 1.8k | ≈ 62k (roof surface on a 0.125 m grid, see follow-ups) |
| Raster downloads | ≈ 250 KB at 0.5 m; flux and mask fetched twice | 925 KB at 0.25 m (DSM 442 KB, flux 482 KB, mask 1 KB), each fetched once |
| 3D JavaScript | ≈ 1 MB minified, downloaded on the first 3D click | 1.06 MB minified / 287 KB gzip, prefetched on idle, plus a 26 KB / 10 KB gzip worker chunk; nothing added to the initial `/estimate` load |
| Model build | n/a | ≈ 60 ms in the worker (4 faces) |

### Real-data evidence

- Scene attributes: `data-roof-model="reconstructed"`, 4 faces, 24 trees, 1 neighbouring roof, 21 of 117 modules; the `roof-model.worker` chunk loads.
- Face card: "East-facing roof · 18° pitch · 180 m² · 98% of best-case sun · 21 modules".
- Phone (393 × 852, touch): the explore gate shows; after tapping, Done and Trees sit in the top-right corner.
- Console: only the Google Maps font stylesheets blocked by the CSP (`style-src` does not allow fonts.googleapis.com). This predates the change.
- Screenshots: `qa-evidence/3d-viewer-2026-10-01/` (`before-*`, `after-*`, the review's prototype comparison; gitignored).

### Verification

- `npm test`: 296/296. `npm run typecheck` and `npx eslint src tests`: clean.
- `npm run build` (Turbopack): OK. The worker is bundled as `turbopack-worker-*.js` with the reconstruction chunk.
- Full Playwright suite on the production build: 194 passed, 4 skipped, 4 failed. All four failures reproduce identically on a clean checkout of `d418cc5`, so they predate this work:
  - three come from colour contrast of the "Reviewed" date in `redacted-scenario-share-card.tsx:121` (4.48:1);
  - one is the advisor sentence expected by `roof-analysis.spec.ts:24` (the mocked estimate now rates "moderate").
- New `tests/e2e/roof-model-regression.spec.ts`: 8 tests and 5 screenshot baselines (`*-chromium-desktop-win32.png`), stable across repeated runs. Run it with `npx playwright test roof-model-regression --project chromium-desktop`. Port 3100 must not be held by another app, because `reuseExistingServer` would test it instead.

### Rollback

- `NEXT_PUBLIC_ROOF_RECONSTRUCTION=off` (build time) brings back the per-segment model, which keeps the new lighting, materials and heatmap.
- `?roofModel=segments|reconstructed` switches a single page for QA.

### Known limitations

- Reconstruction is validated on four synthetic houses (plus rooftop unit, tree, neighbour and garden wall) and one real house. Unusual roofs may come out with fewer or blockier faces. The per-segment model is used only when nothing reconstructs.
- Steps between roof levels show a faint zig-zag along the wall at 0.25 m.
- Google's panel slots are not re-fitted, so a module can overhang where its slot extends past the DSM footprint.
- Trees and neighbours are DSM blobs (lollipop crowns, flat boxes) and have not been checked against imagery; the Trees toggle hides them.
- Keeping the roof clear of the overlays leaves about 370 × 270 px of the 630 × 480 desktop viewer, so the roof is drawn smaller than before but is never covered.
- Screenshot baselines are Windows/Chromium-specific, and all captures used SwiftShader: no real-GPU or iOS Safari pass yet.
- Turbopack also copies the `roof-model.worker.ts` source to `/_next/static/media/`. The copy is unused and harmless.

### Follow-ups

1. Merge coplanar roof cells into larger triangles (≈ 62k → a few thousand per frame).
2. Make the Module panel collapsible, or move it below the canvas on desktop, so the roof can use more of the viewer.
3. Validate on 10–20 more real addresses of different roof types and add synthetic equivalents for any failures.
4. Run the regression spec in CI on a pinned Linux image with its own baselines.
5. Fix the four pre-existing e2e failures, the font CSP error and the Maxeon datasheet link; delete or wire up `src/lib/deterministic-roof-analysis.ts` (unused).
