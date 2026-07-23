# Rooftop Panel Layout: Render Google Solar API Placements Directly

**Date:** 2026-07-15
**Status:** Approved
**Owner:** Chado

## Problem

On the rooftop analysis map, solar panels render as a small clump instead of tiling
the usable roof. The stats can claim "up to 24 panels" while the picture shows far
fewer — or none at all.

Root cause: the client discards the georeferenced panel placements that the Google
Solar API already returns (`solarPotential.solarPanels` in the `buildingInsights`
response the app fetches and pays for on every analysis) and re-synthesizes its own
grid layout. That pipeline shrinks or drops panels at three stages:

1. `buildAcceptedPanelAnalysis` (solar-analysis.tsx) replaces Google's placements
   with a synthetic row/grid layout constrained by heuristic convex-hull segment
   outlines, a 0.91 m setback, gap rules, and collision tests.
2. At draw time, `buildStoredAcceptedPanelPlacements` re-validates each panel
   against a *differently inset* boundary and silently drops failures.
3. A home-grown 8-factor confidence score must be ≥ 80/100 or zero panels render.

## Decisions (agreed 2026-07-15)

| Question | Decision |
|---|---|
| Panel source when Google has data | Render Google's actual placements (no extra API cost — same `buildingInsights` response) |
| Confidence gate | Remove. If placements exist, they render; keep a permanent "installer verifies final layout" caption |
| No-placement addresses | Area-based count estimate with an "estimated" label; never draw fake panel rectangles |
| Approach | Rewire to API placements + delete the synthetic layout engine (mostly deletions) |

## Design

### 1. Panel data flow — trust the API, first-N selection

- **Delete `buildAcceptedPanelAnalysis`** (solar-analysis.tsx). The client consumes
  the server's `RoofAnalysis` unchanged. `panelCount`, `acceptedPanelCount`,
  `annualKwh`, `systemKw` come from `buildSolarRoofAnalysis` (google-solar.ts),
  which is already correct: it trims `solarPanels` to the recommended count and
  keeps Google's ordering.
- **Google's array order is meaningful**: the first N panels correspond exactly to
  the N-panel entry in `solarPanelConfigs`. Slider at N ⇒ map draws
  `solarPanels.slice(0, N)`; energy for N comes from the existing config lookup
  (`findNearestPanelConfig` in solar-metrics.ts / `getProviderAnnualKwh` in
  solarPanels.ts).
- **Delete the re-sorts** that break that correspondence:
  `getOrderedPanelCandidates` (solar-analysis.tsx) and
  `getOrderedPanelCandidatesForReport` (report-snapshot.ts). Slicing always uses
  API array order.
- **New `src/lib/panel-geometry.ts`** consolidates the three duplicated copies of
  panel-corner/rotation math (`inferPanelRotationDeg`, `buildPanelCornerPoints`,
  lat/lng ⇄ local-meters converters) currently in solar-analysis.tsx,
  report-snapshot.ts, and google-solar.ts. Single-purpose module consumed by the
  map, the snapshot builder, and the PDF renderer.

### 2. Rendering — real dimensions, real polygons, no gates

- Each selected panel renders as a **`google.maps.Polygon`** (like Google's own
  Solar API demo). Delete the custom `OverlayView` + SVG + pixel-bounds +
  min-pixel-upscale + projection-retry machinery (~140 lines). Polygons reproject
  natively on zoom/pan.
- Panel corners come from the API's **`panelWidthMeters` × `panelHeightMeters`**
  (per address) — not hardcoded 1.0 × 1.7 — rotated by each panel's own azimuth via
  shared `inferPanelRotationDeg` (row-neighbor inference with azimuth fallback).
  A ~3 cm visual inset keeps a visible seam between adjacent panels.
- **No re-validation at draw time**: no boundary, segment-bounds, collision, or
  obstruction checks. Google guarantees placements are on-roof and non-overlapping.
  The only guard that stays: skip a panel whose lat/lng is non-finite.
- **No confidence gate**: delete the 8-factor score and thresholds. The
  "Final panel placement requires installer verification." caption becomes
  permanent. Roof outlines, sunlight/flux overlay, and layer toggles are unchanged.

Net effect: the picture shows exactly the panels Google says fit, tiled across the
real roof planes; the stat count always equals the panels visible on screen.

### 3. Panel-count estimate when Google returns no placements

- Estimate = `floor((usable area ÷ panel area) × 0.85)`. The 0.85 packing factor
  accounts for row spacing and setbacks a raw area division ignores. Apply the same
  factor to `physicalFit` in `getPanelFit` (solarPanels.ts) so panel-brand cards
  agree.
- With `solarPanels` empty the map draws no panel polygons (existing
  `canRenderPanels` handling), and the count is labeled
  "estimated from roof area — not a verified layout."
- Existing invalid-address and fallback paths are otherwise unchanged.

### 4. Cleanup scope

| Surface | Change |
|---|---|
| `src/components/solar-analysis.tsx` | Delete layout engine (~800 lines): `buildProfessionalPanelLayout`, `buildRowBasedSegmentLayout`, `allocatePanelTargetsBySegment`, collision/SAT helpers, plane-axis helpers, `buildCenteredAxisValues`, confidence-score functions, min-pixel constants, custom panel OverlayView, dead `eslint-disable`d functions |
| `src/lib/report-snapshot.ts` | Drop segment re-sort; slice in API order; import shared geometry |
| `src/lib/google-solar.ts` | Move duplicated geometry helpers into `panel-geometry.ts`; server logic otherwise untouched |
| `src/app/api/report/pdf/route.ts` | Import shared geometry; drawing logic unchanged (renders whatever `solarPanels` contains) |
| `src/components/solar-report-dashboard.tsx` | Copy-only: simplify accepted/rejected-candidate readouts |
| `src/lib/panel-geometry.ts` (new) | Shared corner/rotation/conversion math |

UI copy tied to the old gate ("Clean panel layout rendered from high-confidence
roof geometry", accepted/rejected readouts) simplifies to the installer-verification
caption.

### 5. Error handling & testing

- **Error handling:** invalid/no-coverage paths unchanged. Non-finite placement
  coordinates are skipped at draw time.
- **Tests** (`node:test` via `tsx`, in `tests/`): new `tests/panel-geometry.test.ts`
  covering corner math (dimensions, rotation, orientation), rotation inference from
  row neighbors, first-N slicing preserving API order, config-energy lookup for N
  panels, and the 0.85 packing estimate. Existing `solar-metrics` tests stay green.
- **Verification:** run the dev app against a real Arizona address and confirm
  panels tile the roof and the count matches the picture; regenerate a PDF report
  to confirm the snapshot path.
- Per repo rule (AGENTS.md), read the Next.js 16 guides in
  `node_modules/next/dist/docs/` before writing code.

## Out of scope

- Report-dashboard visual redesign, PDF drawing style changes.
- Any change to Solar API request volume or caching.
- The vision-API / deterministic-analysis path beyond the shared estimate labeling.
