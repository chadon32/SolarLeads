# Render Google Solar API Panel Placements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The rooftop map (and PDF snapshot) renders the panel placements Google's Solar API already returns, so panels tile the real roof and the stat count always matches the picture; the ~800-line synthetic layout engine is deleted.

**Architecture:** A new pure module `src/lib/panel-geometry.ts` consolidates the three duplicated copies of panel corner/rotation math. The client component consumes the server's `RoofAnalysis` unchanged (no re-layout, no re-sort, no confidence gate) and draws each selected panel as a `google.maps.Polygon`. Slider selection is "first N panels in API array order", which corresponds exactly to the API's `solarPanelConfigs[N]` energy figures. When no placements exist, an area-based count (×0.85 packing factor) is shown and no panels are drawn.

**Tech Stack:** Next.js 16 (App Router, this repo ships a modified fork — docs in `node_modules/next/dist/docs/`), React 19 client component, Google Maps JS API (already loaded), Google Solar API (server-side, already integrated), `node:test` via `tsx`.

**Spec:** `docs/superpowers/specs/2026-07-15-panel-layout-design.md`

## Global Constraints

- Per repo AGENTS.md: read the relevant guide in `node_modules/next/dist/docs/` before writing code. For this work that is `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md` (standard `"use client"` boundary semantics apply; `solar-analysis.tsx` is already a client component).
- `src/lib/panel-geometry.ts` MUST import only types from `@/lib/roof-analysis` — no `server-only`, no React, no Next imports. It is consumed by a client component, by `report-snapshot.ts` (server), and by `google-solar.ts` (`server-only`).
- Commands (run from repo root, Windows PowerShell): `npm test`, `npm run typecheck`, `npm run lint`. All three MUST pass at the end of every task.
- No new dependencies.
- Commit style: short imperative subject (repo convention, e.g. "pdf layout fixes"), body optional, and ALWAYS end the message with the trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Do NOT commit unrelated files — the working tree has many pre-existing modified files. Stage only the files each task names (`git add <paths>`), never `git add -A`.
- Panel display constants: seam inset `0.03` m per side; polygon fill `#3b82f6` at opacity `0.82`, stroke `#ffffff` at `0.95`, weight `1.2`, zIndex `34`.

---

### Task 1: Shared panel geometry module

**Files:**
- Create: `src/lib/panel-geometry.ts`
- Test: `tests/panel-geometry.test.ts`

**Interfaces:**
- Consumes: `type RoofAnalysis`, `type SolarPanelPlacement` from `@/lib/roof-analysis` (existing).
- Produces (later tasks import these exact names from `@/lib/panel-geometry`):
  - `type LatLngPoint = { lat: number; lng: number }`
  - `SOLAR_PANEL_SEAM_INSET_METERS = 0.03` (const)
  - `normalizeDegrees(value: number): number`
  - `bearingDegrees(fromLat: number, fromLng: number, toLat: number, toLng: number): number`
  - `offsetLatLngMeters(params: { lat: number; lng: number; eastMeters: number; northMeters: number }): LatLngPoint`
  - `isValidLatLngPoint(point: { lat: number; lng: number } | null | undefined): point is LatLngPoint`
  - `inferPanelRotationDeg(panel: SolarPanelPlacement, panels: SolarPanelPlacement[], fallbackAzimuthDeg: number): number`
  - `getPanelFallbackAzimuthDeg(analysis: RoofAnalysis, panel: SolarPanelPlacement): number`
  - `buildPanelPolygonPath(params: { panel: SolarPanelPlacement; panels: SolarPanelPlacement[]; panelWidthMeters: number; panelHeightMeters: number; fallbackAzimuthDeg: number; insetMeters?: number }): LatLngPoint[]` (4 corners, counter-clockwise from SW-ish, closed by the consumer)
  - `buildPanelCornerLatLngPoints(params: { analysis: RoofAnalysis; panel: SolarPanelPlacement; panels: SolarPanelPlacement[] }): LatLngPoint[]` (`[center, ...4 corners]`, invalid points filtered — same contract as the existing export in `report-snapshot.ts`)

- [ ] **Step 1: Write the failing test**

Create `tests/panel-geometry.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { buildFallbackRoofAnalysis } from "../src/lib/roof-analysis";
import {
  bearingDegrees,
  buildPanelCornerLatLngPoints,
  buildPanelPolygonPath,
  getPanelFallbackAzimuthDeg,
  inferPanelRotationDeg,
  isValidLatLngPoint,
  normalizeDegrees,
  offsetLatLngMeters,
} from "../src/lib/panel-geometry";

const METERS_PER_DEGREE_LAT = 111_320;

function buildPanel(overrides: Record<string, unknown> = {}) {
  return {
    azimuthDeg: 180,
    center: { lat: 33.4, lng: -111.9 },
    columnIndex: 0,
    orientation: "PORTRAIT" as const,
    rowIndex: 0,
    segmentIndex: 0,
    yearlyEnergyDcKwh: 500,
    ...overrides,
  };
}

function latSpanMeters(path: Array<{ lat: number; lng: number }>) {
  const lats = path.map((point) => point.lat);
  return (Math.max(...lats) - Math.min(...lats)) * METERS_PER_DEGREE_LAT;
}

function lngSpanMeters(path: Array<{ lat: number; lng: number }>, atLat: number) {
  const lngs = path.map((point) => point.lng);
  return (
    (Math.max(...lngs) - Math.min(...lngs)) *
    METERS_PER_DEGREE_LAT *
    Math.cos((atLat * Math.PI) / 180)
  );
}

test("normalizeDegrees wraps into [0, 360)", () => {
  assert.equal(normalizeDegrees(-90), 270);
  assert.equal(normalizeDegrees(450), 90);
  assert.equal(normalizeDegrees(360), 0);
});

test("bearingDegrees points north and east", () => {
  assert.ok(Math.abs(bearingDegrees(0, 0, 1, 0) - 0) < 0.01);
  assert.ok(Math.abs(bearingDegrees(0, 0, 0, 1) - 90) < 0.01);
});

test("offsetLatLngMeters moves north and east by meters", () => {
  const north = offsetLatLngMeters({ lat: 0, lng: 0, eastMeters: 0, northMeters: 111.32 });
  assert.ok(Math.abs(north.lat - 0.001) < 1e-9);
  assert.equal(north.lng, 0);

  const east = offsetLatLngMeters({ lat: 60, lng: 0, eastMeters: 55.66, northMeters: 0 });
  assert.ok(Math.abs(east.lng - 0.001) < 1e-6);
});

test("isValidLatLngPoint rejects out-of-range and non-finite points", () => {
  assert.equal(isValidLatLngPoint({ lat: 33.4, lng: -111.9 }), true);
  assert.equal(isValidLatLngPoint({ lat: Number.NaN, lng: 0 }), false);
  assert.equal(isValidLatLngPoint({ lat: 91, lng: 0 }), false);
  assert.equal(isValidLatLngPoint(null), false);
});

test("inferPanelRotationDeg falls back to azimuth minus 90 with no neighbors", () => {
  const panel = buildPanel();
  assert.equal(inferPanelRotationDeg(panel, [panel], 180), 90);
});

test("inferPanelRotationDeg uses row neighbor bearing", () => {
  const panel = buildPanel();
  const rowNeighbor = buildPanel({
    columnIndex: 1,
    center: { lat: 33.4, lng: -111.899 },
  });
  const rotation = inferPanelRotationDeg(panel, [panel, rowNeighbor], 180);
  // Neighbor due east => bearing 90 => rotation ~0.
  assert.ok(Math.min(rotation, 360 - rotation) < 0.5);
});

test("inferPanelRotationDeg ignores neighbors on other segments", () => {
  const panel = buildPanel();
  const otherSegment = buildPanel({
    columnIndex: 1,
    segmentIndex: 3,
    center: { lat: 33.4, lng: -111.899 },
  });
  assert.equal(inferPanelRotationDeg(panel, [panel, otherSegment], 180), 90);
});

test("inferPanelRotationDeg uses column neighbor bearing when no row neighbor", () => {
  const panel = buildPanel();
  const columnNeighbor = buildPanel({
    rowIndex: 1,
    center: { lat: 33.399, lng: -111.9 },
  });
  const rotation = inferPanelRotationDeg(panel, [panel, columnNeighbor], 90);
  // Neighbor due south => bearing 180 => rotation ~180.
  assert.ok(Math.abs(rotation - 180) < 0.5);
});

test("buildPanelPolygonPath spans real panel dimensions", () => {
  const panel = buildPanel();
  const path = buildPanelPolygonPath({
    fallbackAzimuthDeg: 90, // rotation 0
    panel,
    panelHeightMeters: 1.879,
    panelWidthMeters: 1.045,
    panels: [panel],
  });

  assert.equal(path.length, 4);
  assert.ok(Math.abs(latSpanMeters(path) - 1.879) < 0.01);
  assert.ok(Math.abs(lngSpanMeters(path, 33.4) - 1.045) < 0.01);
});

test("buildPanelPolygonPath swaps sides for landscape orientation", () => {
  const panel = buildPanel({ orientation: "LANDSCAPE" as const });
  const path = buildPanelPolygonPath({
    fallbackAzimuthDeg: 90,
    panel,
    panelHeightMeters: 1.879,
    panelWidthMeters: 1.045,
    panels: [panel],
  });

  assert.ok(Math.abs(latSpanMeters(path) - 1.045) < 0.01);
  assert.ok(Math.abs(lngSpanMeters(path, 33.4) - 1.879) < 0.01);
});

test("buildPanelPolygonPath applies per-side seam inset", () => {
  const panel = buildPanel();
  const path = buildPanelPolygonPath({
    fallbackAzimuthDeg: 90,
    insetMeters: 0.03,
    panel,
    panelHeightMeters: 1.879,
    panelWidthMeters: 1.045,
    panels: [panel],
  });

  assert.ok(Math.abs(latSpanMeters(path) - (1.879 - 0.06)) < 0.01);
  assert.ok(Math.abs(lngSpanMeters(path, 33.4) - (1.045 - 0.06)) < 0.01);
});

test("buildPanelPolygonPath rotates with the fallback azimuth", () => {
  const panel = buildPanel();
  const path = buildPanelPolygonPath({
    fallbackAzimuthDeg: 180, // rotation 90 => long side runs east-west
    panel,
    panelHeightMeters: 1.879,
    panelWidthMeters: 1.045,
    panels: [panel],
  });

  assert.ok(Math.abs(latSpanMeters(path) - 1.045) < 0.01);
  assert.ok(Math.abs(lngSpanMeters(path, 33.4) - 1.879) < 0.01);
});

test("getPanelFallbackAzimuthDeg prefers panel azimuth then segment then primary", () => {
  const analysis = buildFallbackRoofAnalysis({
    address: "6420 E Nance St, Mesa, AZ 85215",
    lat: 33.415,
    lng: -111.831,
  });
  const panel = buildPanel();

  assert.equal(getPanelFallbackAzimuthDeg(analysis, panel), 180);
  assert.equal(
    getPanelFallbackAzimuthDeg(analysis, buildPanel({ azimuthDeg: Number.NaN, segmentIndex: 0 })),
    analysis.roofSegments[0].azimuthDeg
  );
  assert.equal(
    getPanelFallbackAzimuthDeg(analysis, buildPanel({ azimuthDeg: Number.NaN, segmentIndex: 99 })),
    analysis.primaryRoofAzimuth
  );
});

test("buildPanelCornerLatLngPoints returns center plus four corners", () => {
  const analysis = buildFallbackRoofAnalysis({
    address: "6420 E Nance St, Mesa, AZ 85215",
    lat: 33.415,
    lng: -111.831,
  });
  const panel = buildPanel();
  const points = buildPanelCornerLatLngPoints({ analysis, panel, panels: [panel] });

  assert.equal(points.length, 5);
  assert.deepEqual(points[0], panel.center);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --conditions=react-server --test tests/panel-geometry.test.ts`
Expected: FAIL — `Cannot find module '../src/lib/panel-geometry'`

- [ ] **Step 3: Write the implementation**

Create `src/lib/panel-geometry.ts`. This is the consolidation of the three existing copies (`solar-analysis.tsx:3911`, `report-snapshot.ts:437`, `google-solar.ts:923`); the segment-index filter in neighbor lookup comes from the report-snapshot version (the most complete one):

```ts
import type { RoofAnalysis, SolarPanelPlacement } from "@/lib/roof-analysis";

export type LatLngPoint = {
  lat: number;
  lng: number;
};

export const SOLAR_PANEL_SEAM_INSET_METERS = 0.03;

const METERS_PER_DEGREE_LAT = 111_320;

export function normalizeDegrees(value: number) {
  return ((value % 360) + 360) % 360;
}

export function bearingDegrees(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number
) {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const toDegrees = (value: number) => (value * 180) / Math.PI;
  const lat1 = toRadians(fromLat);
  const lat2 = toRadians(toLat);
  const deltaLng = toRadians(toLng - fromLng);
  const y = Math.sin(deltaLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng);

  return normalizeDegrees(toDegrees(Math.atan2(y, x)));
}

export function offsetLatLngMeters({
  lat,
  lng,
  eastMeters,
  northMeters,
}: {
  lat: number;
  lng: number;
  eastMeters: number;
  northMeters: number;
}): LatLngPoint {
  const metersPerDegreeLng =
    METERS_PER_DEGREE_LAT * Math.max(Math.cos((lat * Math.PI) / 180), 0.01);

  return {
    lat: lat + northMeters / METERS_PER_DEGREE_LAT,
    lng: lng + eastMeters / metersPerDegreeLng,
  };
}

export function isValidLatLngPoint(
  point: { lat: number; lng: number } | null | undefined
): point is LatLngPoint {
  return Boolean(
    point &&
      Number.isFinite(point.lat) &&
      Number.isFinite(point.lng) &&
      Math.abs(point.lat) <= 90 &&
      Math.abs(point.lng) <= 180
  );
}

export function inferPanelRotationDeg(
  panel: SolarPanelPlacement,
  panels: SolarPanelPlacement[],
  fallbackAzimuthDeg: number
) {
  const rowNeighbor = panels
    .filter(
      (candidate) =>
        candidate !== panel &&
        candidate.segmentIndex === panel.segmentIndex &&
        candidate.rowIndex !== null &&
        candidate.rowIndex === panel.rowIndex &&
        candidate.columnIndex !== null &&
        panel.columnIndex !== null
    )
    .sort(
      (left, right) =>
        Math.abs((left.columnIndex ?? 0) - (panel.columnIndex ?? 0)) -
        Math.abs((right.columnIndex ?? 0) - (panel.columnIndex ?? 0))
    )[0];

  if (rowNeighbor) {
    return normalizeDegrees(
      bearingDegrees(
        panel.center.lat,
        panel.center.lng,
        rowNeighbor.center.lat,
        rowNeighbor.center.lng
      ) - 90
    );
  }

  const columnNeighbor = panels
    .filter(
      (candidate) =>
        candidate !== panel &&
        candidate.segmentIndex === panel.segmentIndex &&
        candidate.columnIndex !== null &&
        candidate.columnIndex === panel.columnIndex &&
        candidate.rowIndex !== null &&
        panel.rowIndex !== null
    )
    .sort(
      (left, right) =>
        Math.abs((left.rowIndex ?? 0) - (panel.rowIndex ?? 0)) -
        Math.abs((right.rowIndex ?? 0) - (panel.rowIndex ?? 0))
    )[0];

  if (columnNeighbor) {
    return normalizeDegrees(
      bearingDegrees(
        panel.center.lat,
        panel.center.lng,
        columnNeighbor.center.lat,
        columnNeighbor.center.lng
      )
    );
  }

  return normalizeDegrees(fallbackAzimuthDeg - 90);
}

export function getPanelFallbackAzimuthDeg(
  analysis: RoofAnalysis,
  panel: SolarPanelPlacement
) {
  if (Number.isFinite(panel.azimuthDeg)) {
    return panel.azimuthDeg;
  }

  return (
    analysis.roofSegments[panel.segmentIndex]?.azimuthDeg ??
    analysis.primaryRoofAzimuth
  );
}

export function buildPanelPolygonPath({
  panel,
  panels,
  panelWidthMeters,
  panelHeightMeters,
  fallbackAzimuthDeg,
  insetMeters = 0,
}: {
  panel: SolarPanelPlacement;
  panels: SolarPanelPlacement[];
  panelWidthMeters: number;
  panelHeightMeters: number;
  fallbackAzimuthDeg: number;
  insetMeters?: number;
}): LatLngPoint[] {
  const shortSide = Math.min(panelWidthMeters, panelHeightMeters);
  const longSide = Math.max(panelWidthMeters, panelHeightMeters);
  const baseWidthMeters = panel.orientation === "LANDSCAPE" ? longSide : shortSide;
  const baseHeightMeters = panel.orientation === "LANDSCAPE" ? shortSide : longSide;
  const widthMeters = Math.max(
    baseWidthMeters * 0.62,
    baseWidthMeters - insetMeters * 2
  );
  const heightMeters = Math.max(
    baseHeightMeters * 0.62,
    baseHeightMeters - insetMeters * 2
  );
  const halfWidth = widthMeters / 2;
  const halfHeight = heightMeters / 2;
  const rotation =
    (inferPanelRotationDeg(panel, panels, fallbackAzimuthDeg) * Math.PI) / 180;
  const corners = [
    { east: -halfWidth, north: -halfHeight },
    { east: halfWidth, north: -halfHeight },
    { east: halfWidth, north: halfHeight },
    { east: -halfWidth, north: halfHeight },
  ];

  return corners.map((corner) => {
    const rotatedEast =
      corner.east * Math.cos(rotation) + corner.north * Math.sin(rotation);
    const rotatedNorth =
      -corner.east * Math.sin(rotation) + corner.north * Math.cos(rotation);

    return offsetLatLngMeters({
      lat: panel.center.lat,
      lng: panel.center.lng,
      eastMeters: rotatedEast,
      northMeters: rotatedNorth,
    });
  });
}

export function buildPanelCornerLatLngPoints({
  analysis,
  panel,
  panels,
}: {
  analysis: RoofAnalysis;
  panel: SolarPanelPlacement;
  panels: SolarPanelPlacement[];
}): LatLngPoint[] {
  const corners = buildPanelPolygonPath({
    fallbackAzimuthDeg: getPanelFallbackAzimuthDeg(analysis, panel),
    panel,
    panelHeightMeters: analysis.panelHeightMeters,
    panelWidthMeters: analysis.panelWidthMeters,
    panels,
  });

  return [panel.center, ...corners].filter(isValidLatLngPoint);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --conditions=react-server --test tests/panel-geometry.test.ts`
Expected: PASS (14 tests)

- [ ] **Step 5: Run the full gate and commit**

Run: `npm test` then `npm run typecheck` — expected: all pass.

```bash
git add src/lib/panel-geometry.ts tests/panel-geometry.test.ts
git commit -m "Add shared panel geometry module

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Rewire google-solar.ts to the shared geometry

**Files:**
- Modify: `src/lib/google-solar.ts` (functions at lines ~881–992: `getPanelCornerCoordinates`, `inferPanelRotationDeg`, `offsetLatLngMeters`; also `bearingDegrees`/`normalizeDegrees` near line 1274)

**Interfaces:**
- Consumes: `buildPanelPolygonPath`, `normalizeDegrees` from `@/lib/panel-geometry` (Task 1).
- Produces: no exported-surface change — `buildSolarRoofAnalysis` behavior is unchanged (the only call site of the replaced helper passes same-segment panels, so the shared version's segment filter is a no-op there).

- [ ] **Step 1: Add the import**

At the top of `src/lib/google-solar.ts` (after the existing imports):

```ts
import { buildPanelPolygonPath, normalizeDegrees } from "@/lib/panel-geometry";
```

- [ ] **Step 2: Replace the call site**

In `buildSegmentOutlineFromPanels` (line ~856), the current code is:

```ts
  const points = segmentPanels.flatMap((panel) =>
    getPanelCornerCoordinates({
      panel,
      panels: segmentPanels,
      panelWidthMeters,
      panelHeightMeters,
      fallbackAzimuth,
    }).map((corner) =>
```

Replace the helper call (keep the `.map((corner) => ...)` that follows):

```ts
  const points = segmentPanels.flatMap((panel) =>
    buildPanelPolygonPath({
      fallbackAzimuthDeg: Number.isFinite(panel.azimuthDeg)
        ? panel.azimuthDeg
        : fallbackAzimuth,
      panel,
      panelHeightMeters,
      panelWidthMeters,
      panels: segmentPanels,
    }).map((corner) =>
```

(The old local `inferPanelRotationDeg` preferred `panel.azimuthDeg` over the passed fallback; that preference moves into the call site because the shared helper takes the resolved fallback directly.)

- [ ] **Step 3: Delete the local duplicates**

Delete from `google-solar.ts`: `getPanelCornerCoordinates` (lines ~881–921), the local `inferPanelRotationDeg` (~923–971), the local `offsetLatLngMeters` (~973–992), the local `bearingDegrees` (~1274–1286), and the local `normalizeDegrees` (~1288–1290). Keep `angularDistance` (line ~1269) — it now uses the imported `normalizeDegrees`.

- [ ] **Step 4: Verify**

Run: `npm test` — expected: PASS (no behavior change).
Run: `npm run typecheck` — expected: PASS.
Run: `npm run lint` — expected: no new errors (deleted functions gone, no unused imports).

- [ ] **Step 5: Commit**

```bash
git add src/lib/google-solar.ts
git commit -m "Use shared panel geometry in google-solar

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: report-snapshot.ts — API-order slicing + shared geometry

**Files:**
- Modify: `src/lib/report-snapshot.ts` (`buildAcceptedPanelAnalysisForReport` ~line 260, `buildPanelCornerLatLngPoints` ~412, `inferPanelRotationDeg` ~437, `buildPanelCornerPoints` ~499, `getOrderedPanelCandidatesForReport` ~536, plus its local `bearingDegrees`/`normalizeDegrees`/`offsetLatLngMeters`/`nullableSortValue` copies further down)
- Test: `tests/report-snapshot.test.ts` (new)

**Interfaces:**
- Consumes: `buildPanelCornerLatLngPoints`, `inferPanelRotationDeg` from `@/lib/panel-geometry` (Task 1).
- Produces: `report-snapshot.ts` MUST keep re-exporting `buildPanelCornerLatLngPoints` and `inferPanelRotationDeg` with unchanged signatures — `src/app/api/report/pdf/route.ts` imports them from `@/lib/report-snapshot` and is not modified by this plan.

- [ ] **Step 1: Write the failing test**

Create `tests/report-snapshot.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { buildAcceptedPanelAnalysisForReport } from "../src/lib/report-snapshot";
import { buildFallbackRoofAnalysis } from "../src/lib/roof-analysis";

function buildPanel(overrides: Record<string, unknown> = {}) {
  return {
    azimuthDeg: 180,
    center: { lat: 33.41, lng: -111.83 },
    columnIndex: 0,
    orientation: "PORTRAIT" as const,
    rowIndex: 0,
    segmentIndex: 2,
    yearlyEnergyDcKwh: 900,
    ...overrides,
  };
}

function buildAnalysisFixture() {
  const analysis = buildFallbackRoofAnalysis({
    address: "6420 E Nance St, Mesa, AZ 85215",
    lat: 33.415,
    lng: -111.831,
  });

  return {
    ...analysis,
    acceptedPanelCount: 2,
    panelCount: 2,
    solarPanelConfigs: [
      { panelsCount: 1, yearlyEnergyDcKwh: 700 },
      { panelsCount: 2, yearlyEnergyDcKwh: 1500 },
    ],
    solarPanels: [
      buildPanel({ center: { lat: 33.41, lng: -111.83 } }),
      buildPanel({
        center: { lat: 33.42, lng: -111.84 },
        columnIndex: 1,
        yearlyEnergyDcKwh: 800,
      }),
      buildPanel({
        center: { lat: 33.43, lng: -111.85 },
        segmentIndex: 0,
        yearlyEnergyDcKwh: 700,
      }),
    ],
  };
}

test("accepted panels keep Google Solar API array order", () => {
  const analysis = buildAnalysisFixture();
  const accepted = buildAcceptedPanelAnalysisForReport(analysis);

  // First N panels of the API array — NOT re-sorted by segment size.
  assert.equal(accepted.solarPanels.length, 2);
  assert.deepEqual(accepted.solarPanels[0].center, { lat: 33.41, lng: -111.83 });
  assert.deepEqual(accepted.solarPanels[1].center, { lat: 33.42, lng: -111.84 });
});

test("accepted analysis uses the matching config energy and per-segment counts", () => {
  const analysis = buildAnalysisFixture();
  const accepted = buildAcceptedPanelAnalysisForReport(analysis);

  assert.equal(accepted.panelCount, 2);
  assert.equal(accepted.annualKwh, 1500);
  assert.equal(accepted.roofSegments[2].panelsFit, 2);
  assert.equal(accepted.roofSegments[0].panelsFit, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --conditions=react-server --test tests/report-snapshot.test.ts`
Expected: FAIL — the first assertion on `solarPanels[0].center` fails because `getOrderedPanelCandidatesForReport` re-sorts by segment rank and puts the `segmentIndex: 0` panel (largest fallback segment) first.

- [ ] **Step 3: Implement**

In `src/lib/report-snapshot.ts`:

1. Add the import:

```ts
import {
  buildPanelCornerLatLngPoints,
  inferPanelRotationDeg,
} from "@/lib/panel-geometry";
```

2. Keep the PDF route's imports working by re-exporting both names. Find the local definitions of `buildPanelCornerLatLngPoints` (~line 412) and `inferPanelRotationDeg` (~line 437) and DELETE them, along with the now-unused local `buildPanelCornerPoints` (~499), and the file's local copies of `bearingDegrees`, `normalizeDegrees`, and `offsetLatLngMeters` (below line 565 — delete only if nothing else in the file references them; `npm run typecheck` confirms). Then add near the other exports:

```ts
export { buildPanelCornerLatLngPoints, inferPanelRotationDeg };
```

3. In `buildAcceptedPanelAnalysisForReport` (~line 284), replace:

```ts
  const acceptedPanels = getOrderedPanelCandidatesForReport(analysis).slice(
    0,
    modeledAcceptedCount
  );
```

with:

```ts
  const acceptedPanels = analysis.solarPanels.slice(0, modeledAcceptedCount);
```

4. Delete `getOrderedPanelCandidatesForReport` (~lines 536–565) and, if now unused, `nullableSortValue`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --conditions=react-server --test tests/report-snapshot.test.ts`
Expected: PASS (2 tests)

Run: `npm test` and `npm run typecheck` — expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/report-snapshot.ts tests/report-snapshot.test.ts
git commit -m "Keep Solar API panel order in report snapshots

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: solar-analysis.tsx — consume the server analysis directly

**Files:**
- Modify: `src/components/solar-analysis.tsx` (analysis intake ~lines 385–398; delete `buildAcceptedPanelAnalysis` ~3119–3212, `getOrderedPanelCandidates` ~3221–3250, `nullableSortValue` ~3252–3254)

**Interfaces:**
- Consumes: nothing new.
- Produces: `roofData` state now holds the server's `RoofAnalysis` verbatim. `getMaxSelectablePanelCount(roofData)` (unchanged, ~line 3214) remains the slider max: `max(1, solarPanels.length || acceptedPanelCount || panelCount)`.

- [ ] **Step 1: Use the server analysis without re-layout**

In the `runAnalysis` flow (~lines 385–398), the current code is:

```ts
        const panelSyncedRoofData = buildAcceptedPanelAnalysis(nextRoofData);
        setRoofData(panelSyncedRoofData);
        setSelectedPanelCount(
          Math.max(
            1,
            Math.min(
              getMaxSelectablePanelCount(panelSyncedRoofData),
              panelSyncedRoofData.solarPanels.length || panelSyncedRoofData.panelCount
            )
          )
        );
        onAnalysisChange?.(panelSyncedRoofData);
```

Replace with:

```ts
        setRoofData(nextRoofData);
        setSelectedPanelCount(
          Math.max(
            1,
            Math.min(
              getMaxSelectablePanelCount(nextRoofData),
              nextRoofData.solarPanels.length || nextRoofData.panelCount
            )
          )
        );
        onAnalysisChange?.(nextRoofData);
```

Also update the two later references in the same function that still use `panelSyncedRoofData` (the `trackEvent("solar_data_loaded", ...)` call and the `setNotice(...)` call, ~lines 436–443) to use `nextRoofData`.

- [ ] **Step 2: Delete the dead re-layout functions**

Delete from `solar-analysis.tsx`:
- `buildAcceptedPanelAnalysis` (~lines 3119–3212)
- `getOrderedPanelCandidates` (~lines 3221–3250)
- `nullableSortValue` (~lines 3252–3254)

Then remove imports that became unused. Expected: `findNearestPanelConfig as findSharedPanelConfig` and `ARIZONA_AVG_RATE_PER_KWH` from `@/lib/solar-metrics` (verify with `npm run lint` — remove exactly the ones it flags as unused).

Note: deleting `buildAcceptedPanelAnalysis` leaves `buildProfessionalPanelLayout` (and its helper chain) unreferenced. Do NOT delete or `eslint-disable` them in this task — Task 6 removes them wholesale.

- [ ] **Step 3: Verify**

Run: `npm run typecheck` — expected: PASS.
Run: `npm run lint` — expected: it MAY flag the now-unreferenced layout-engine functions (`buildProfessionalPanelLayout` chain) as unused. That is the known intermediate state; do not add `eslint-disable` comments — Tasks 5–6 delete them. Any OTHER new lint error must be fixed now.
Run: `npm test` — expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/solar-analysis.tsx
git commit -m "Consume server roof analysis without client re-layout

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: solar-analysis.tsx — draw Google placements as map polygons, remove the gate

**Files:**
- Modify: `src/components/solar-analysis.tsx`:
  - imports (top of file)
  - `ViewportCanvas` (~line 891) and its `drawOverlays` effect (~1120–1130)
  - `createSolarPanelOverlays` (~2090), `buildStoredAcceptedPanelPlacements` (~2438), `getRenderablePanelCount` (~2427), `createSolarPanelVisualOverlay` (~2125)
  - `LayerControl` (~1292), `MobileMapControls` (~1359), `MapEvidenceOverlay` (~1462)
  - `buildPanelCornerLatLngPoints` local copy (~1740) and its call sites (~1645, ~1716)
  - `getVisualizationConfidenceReadouts` (~4322), `getGeometryConfidenceScore` (~4368)
  - `Polygon` option typing: the `GoogleMapsApi` type (~line 158) already declares `Polygon` — no type change needed.

**Interfaces:**
- Consumes from `@/lib/panel-geometry` (Task 1): `buildPanelPolygonPath`, `buildPanelCornerLatLngPoints`, `getPanelFallbackAzimuthDeg`, `isValidLatLngPoint`, `offsetLatLngMeters`, `SOLAR_PANEL_SEAM_INSET_METERS`, `type LatLngPoint`.
- Produces (used by Task 6's deletion sweep): `buildSelectedPanelPlacements({ roofData, selectedPanelCount }): PanelLayoutPlacement[]` where `type PanelLayoutPlacement = { displayPath: LatLngPoint[]; panel: RoofAnalysis["solarPanels"][number] }`; `getRenderablePanelCount(roofData, selectedPanelCount): number` (no confidence gate).

- [ ] **Step 1: Import the shared geometry**

Add to the imports of `solar-analysis.tsx`:

```ts
import {
  buildPanelCornerLatLngPoints,
  buildPanelPolygonPath,
  getPanelFallbackAzimuthDeg,
  isValidLatLngPoint,
  offsetLatLngMeters,
  SOLAR_PANEL_SEAM_INSET_METERS,
  type LatLngPoint,
} from "@/lib/panel-geometry";
```

Delete the component's local `type LatLngPoint` declaration (~lines 127–130) so the imported type is the single definition used by the remaining code.

Delete the component's local copies of: `buildPanelCornerLatLngPoints` (~1740–1763), `buildPanelCornerPoints` (~1765–1810), `inferPanelRotationDeg` (~3911–3961), `bearingDegrees` (~3963–3975), `normalizeDegrees` (~3977–3979), `offsetLatLngMeters` (~3981–4000), and the local `isValidLatLngPoint` / `LatLngPoint` type IF they exactly duplicate the shared ones (keep any local definition that other remaining code still needs a different shape for — `npm run typecheck` is the referee; the local `LatLngPoint` type alias can simply be re-pointed to the imported one).

Update the two call sites of `buildPanelCornerLatLngPoints` (~lines 1645 and 1716), which currently pass `{ panel, panels, roofData }`, to the shared signature:

```ts
    buildPanelCornerLatLngPoints({
      analysis: roofData,
      panel,
      panels: roofData.solarPanels,
    })
```

- [ ] **Step 2: Replace the panel placement + overlay pipeline**

Replace `buildStoredAcceptedPanelPlacements` (~2438–2504), `getRenderablePanelCount` (~2427–2436), `createSolarPanelOverlays` (~2090–2123), and DELETE `createSolarPanelVisualOverlay` (~2125–2260) and `getPixelBounds` (~2262–2277), with:

```ts
const SOLAR_PANEL_FILL_COLOR = "#3b82f6";

type PanelLayoutPlacement = {
  displayPath: LatLngPoint[];
  panel: RoofAnalysis["solarPanels"][number];
};

function getRenderablePanelCount(roofData: RoofAnalysis, selectedPanelCount: number) {
  return Math.min(
    Math.max(0, Math.round(selectedPanelCount)),
    roofData.solarPanels.length
  );
}

function buildSelectedPanelPlacements({
  roofData,
  selectedPanelCount,
}: {
  roofData: RoofAnalysis;
  selectedPanelCount: number;
}): PanelLayoutPlacement[] {
  const targetCount = getRenderablePanelCount(roofData, selectedPanelCount);

  return roofData.solarPanels.slice(0, targetCount).flatMap((panel) => {
    if (!isValidLatLngPoint(panel.center)) {
      return [];
    }

    return [
      {
        displayPath: buildPanelPolygonPath({
          fallbackAzimuthDeg: getPanelFallbackAzimuthDeg(roofData, panel),
          insetMeters: SOLAR_PANEL_SEAM_INSET_METERS,
          panel,
          panelHeightMeters: roofData.panelHeightMeters,
          panelWidthMeters: roofData.panelWidthMeters,
          panels: roofData.solarPanels,
        }),
        panel,
      },
    ];
  });
}

function createSolarPanelOverlays({
  googleApi,
  map,
  roofData,
  selectedPanelCount,
}: {
  googleApi: GoogleMapsApi;
  map: GoogleMapInstance;
  roofData: RoofAnalysis;
  selectedPanelCount: number;
}) {
  return buildSelectedPanelPlacements({ roofData, selectedPanelCount }).map(
    (placement) =>
      new googleApi.maps.Polygon({
        clickable: false,
        fillColor: SOLAR_PANEL_FILL_COLOR,
        fillOpacity: 0.82,
        map,
        paths: placement.displayPath,
        strokeColor: "#ffffff",
        strokeOpacity: 0.95,
        strokeWeight: 1.2,
        zIndex: 34,
      })
  );
}
```

In the `drawOverlays` effect (~lines 1120–1130), the call becomes:

```ts
      if (layerVisibility.panels) {
        nextOverlays.push(
          ...createSolarPanelOverlays({
            googleApi,
            map: mapRef.current,
            roofData,
            selectedPanelCount,
          })
        );
      }
```

- [ ] **Step 3: Remove the confidence gate from ViewportCanvas**

In `ViewportCanvas` (~lines 891–1247):

1. Delete the `roofModelConfidence` memo (~lines 933–936) and remove `roofModelConfidence` from the `drawOverlays` dependency array (~line 1178).
2. Replace the derived values (~lines 1186–1195) with:

```ts
  const showMapFallback = !mapsApiKey || !center;
  const canRenderPanels = roofData.solarPanels.length > 0;
  const panelCapacity = getMaxSelectablePanelCount(roofData);
  const renderedPanelCount = getRenderablePanelCount(roofData, selectedPanelCount);
  const systemKw =
    Math.round(
      (((renderedPanelCount > 0 ? renderedPanelCount : panelCapacity) *
        (selectedPanel?.watts ?? STANDARD_PANEL_WATTS)) /
        1000) *
        10
    ) / 10;
```

3. Update the three child usages: `LayerControl` gets `canRenderPanels={canRenderPanels}` instead of `roofModelConfidence`; `MapEvidenceOverlay` and `MobileMapControls` get `canRenderPanels={canRenderPanels}` instead of `roofModelConfidence`.

- [ ] **Step 4: Update the three UI components**

`LayerControl` (~1292): change the prop `roofModelConfidence: RoofModelConfidence` to `canRenderPanels: boolean`, and the panels-toggle helper to:

```ts
    {
      id: "panels",
      label: "Panels",
      helper: canRenderPanels ? undefined : "Estimated capacity view",
    },
```

`MobileMapControls` (~1359): change prop `roofModelConfidence: RoofModelConfidence` to `canRenderPanels: boolean`. Replace the summary (~1374–1377) with:

```ts
  const panelSummary =
    canRenderPanels && renderedPanelCount > 0
      ? `${renderedPanelCount} panel layout · ${systemKw.toFixed(1)} kW`
      : `Estimated capacity: up to ${panelCapacity} panels · ${systemKw.toFixed(1)} kW`;
```

Delete the `{roofModelConfidence.score}/100` badge `<span>` (~1393–1395). Change the legend item (~1439–1444) label to `canRenderPanels ? "Panels (Google Solar API)" : "Capacity only"`.

`MapEvidenceOverlay` (~1462): change prop `roofModelConfidence: RoofModelConfidence` to `canRenderPanels: boolean`. Replace the badge logic (~1477–1480) with:

```ts
  const panelBadge =
    canRenderPanels && renderedPanelCount > 0
      ? `${renderedPanelCount} panel layout · ${systemKw.toFixed(1)} kW`
      : `Estimated capacity: up to ${panelCapacity} panels · ${systemKw.toFixed(1)} kW`;
```

Delete the "Roof model confidence {score}/100" `<span>` (~1491–1493). Replace the panels legend entry (~1524–1530) with:

```tsx
          {layerVisibility.panels ? (
            canRenderPanels ? (
              <LegendItem swatch="border border-white bg-blue-500/75" label="Blue - panel layout (Google Solar API)" />
            ) : (
              <LegendItem swatch="border border-slate-500 bg-slate-500/30" label="Estimated capacity - no placement data" />
            )
          ) : null}
```

Replace the conditional footer note (~1532–1536) with an unconditional one:

```tsx
        <p className="mt-2 border-t border-slate-900/10 pt-2 text-[0.68rem] leading-4 text-slate-700">
          Final panel placement requires installer verification.
        </p>
```

- [ ] **Step 5: Update the confidence readouts**

In `getVisualizationConfidenceReadouts` (~4322–4354): delete the `roofModelConfidence` const and the first readout entry (`"Roof Model Confidence"`), leaving the Roof Detection / Solar Model / Geometry rows.

In `getGeometryConfidenceScore` (~4385), replace:

```ts
  if (getRoofModelConfidence(roofData).mode === "high") score += 8;
```

with:

```ts
  if (roofData.solarPanels.length > 0) score += 8;
```

- [ ] **Step 6: Verify**

Run: `npm run typecheck` — expected: PASS (the old gate functions still exist but are now unreferenced; that's fine until Task 6).
Run: `npm run lint` — expected: it MAY flag the now-unreferenced gate/layout functions as unused (Task 6 deletes them; do not add `eslint-disable`). Fix any OTHER new lint error (e.g. an unused import added by this task) now.
Run: `npm test` — expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/solar-analysis.tsx
git commit -m "Render Google Solar API panel placements as map polygons

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Delete the dead layout engine + retire gate copy

**Files:**
- Modify: `src/components/solar-analysis.tsx` (bulk deletions + copy)
- Modify: `src/components/solar-report-dashboard.tsx` (copy only, lines ~182, ~204–213, ~1110, ~1220)

**Interfaces:**
- Consumes: Task 5's state (functions below are unreferenced after it).
- Produces: nothing new — pure removal. `hasUsablePanelSegments`, `getRoofModelConfidence`, and the layout engine no longer exist; nothing may reference them.

- [ ] **Step 1: Delete the layout engine and gate machinery from solar-analysis.tsx**

Delete these (approximate pre-edit line anchors; use the symbol names as ground truth and let `npm run typecheck` catch stragglers). Before deleting each, confirm with a search in the file that its only references are within this deletion list:

Constants/types (~lines 90–96, 213–227): `RoofVisualizationMode`, `RoofModelConfidence`, `DISPLAY_PANEL_HEIGHT_METERS`, `DISPLAY_PANEL_WIDTH_METERS`, `PANEL_MODULE_GAP_METERS`, `PANEL_COLLISION_EPSILON_METERS`, `PANEL_VISUAL_INSET_METERS`, `ROOF_EDGE_SETBACK_METERS`, `PANEL_ROW_GAP_METERS`, `HIGH_CONFIDENCE_PANEL_THRESHOLD`, `MEDIUM_CONFIDENCE_PANEL_THRESHOLD`, `MIN_PANEL_PIXEL_WIDTH`, `MIN_PANEL_PIXEL_HEIGHT`, `PANEL_PIXEL_PADDING`.

Functions: `buildProfessionalPanelLayout`, `shouldShowDetailedPanelPlacement`, `shouldHidePanelPlacement`, `hasUsablePanelSegments`, `getRoofModelConfidence`, `getPolygonQualityScore`, `getRoofPlaneSizeScore`, `getRoofPlaneShapeScore`, `getPanelPlacementConsistencyScore`, `getAvailableUsableAreaScore`, `getObstructionConfidenceScore`, `getPanelRowAlignmentScore`, `groupPanelsBySegment`, `angularDistance`, `getPanelLayoutCapacity`, `allocatePanelTargetsBySegment`, `buildRowBasedSegmentLayout`, `getSegmentUsableBoundary`, `getDominantPanelOrientation`, `getPanelLayoutAxes`, `meterPointToPlaneCoords`, `planeCoordsToMeterPoint`, `getMeterBounds`, `buildCenteredAxisValues`, `getSegmentEnergyPerPanel`, `panelOverlapsObstruction`, `getPanelBoundaryPolygon`, `isPanelCenterInRoofSegment`, `isPanelInsideBoundary`, `isPanelPathInsideBounds`, `isLatLngPointInBounds`, `convexPolygonsOverlap`, `getPolygonAxes`, `projectPolygon`, `latLngToLocalMeters`, `localMetersToLatLng`, and the `MeterPoint` type.

KEEP (still used elsewhere in the file): `isLatLngPointInPolygon` if the DSM/heatmap clip code references it, `getVisualRoofOutline`, `outlineToLatLngPoints`, `boundsToLatLngPoints`, `getRoofBoundsCenter`, `getLatLngCentroid`, `convexHull`, `pixelCross`, `clampNumber`, `roundTo`. For each, search the file first; delete only if unreferenced.

- [ ] **Step 2: Retire gate-era copy in solar-analysis.tsx**

Compact-path explainer (~lines 707–722): replace the whole `<div className="mt-3 rounded-[1rem] ...">` block with:

```tsx
              <div className="mt-3 rounded-[1rem] border border-white/10 bg-slate-950/62 p-3 text-xs leading-5 text-slate-200">
                <p>
                  Panel positions come from the Google Solar API model for this roof.
                </p>
                <p className="mt-2 text-slate-400">
                  Final panel placement requires installer verification - roof
                  measurements, fire setbacks, and electrical design can adjust
                  the layout.
                </p>
              </div>
```

Sidebar sentence (~line 767): replace

```
Roof geometry and usable solar area are tied to the Google Solar building record returned for this property. Exact panel placement is shown only when the model confidence is high.
```

with

```
Roof geometry, usable solar area, and panel positions are tied to the Google Solar building record returned for this property. Final placement is verified by your installer.
```

- [ ] **Step 3: Copy tweaks in solar-report-dashboard.tsx**

- Line ~182: `<MiniReadout label="Accepted panels" ...>` → `label="Panels"`.
- Lines ~1110 and ~1220: `` title={`${values.panelCount} accepted panels`} `` → `` title={`${values.panelCount} panels`} ``.
- Line ~204: the `Solar panels: {values.panelCount} of {values.maxPanelCount}` line stays as-is.

- [ ] **Step 4: Verify**

Run: `npm run typecheck` — expected: PASS (proves nothing referenced the deleted symbols).
Run: `npm run lint` — expected: PASS with no unused-symbol warnings in the two files.
Run: `npm test` — expected: PASS.
Sanity check the diff size: `git diff --stat src/components/solar-analysis.tsx` — expect roughly 800+ deleted lines across Tasks 5–6.

- [ ] **Step 5: Commit**

```bash
git add src/components/solar-analysis.tsx src/components/solar-report-dashboard.tsx
git commit -m "Delete synthetic panel layout engine and confidence gate

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Area-based estimate calibration (0.85 packing factor)

**Files:**
- Modify: `src/lib/solarPanels.ts` (`getPanelFit`, ~lines 254–269)
- Modify: `src/lib/roof-analysis.ts` (`buildFallbackRoofAnalysis`, ~line 125)
- Modify: `src/components/solar-analysis.tsx` (`PanelSelectionSlider` no-placements note, ~lines 4204–4208)
- Test: `tests/solar-metrics.test.ts` (update ~lines 30–41, add one test)

**Interfaces:**
- Consumes: nothing new.
- Produces: `getPanelFit` semantics — when the analysis has real placements, the API count governs (no packing haircut); when it does not, area-based fit gets ×0.85.

- [ ] **Step 1: Update the existing test and add the new one (failing first)**

In `tests/solar-metrics.test.ts`, the test at line 30 currently expects `maxPanelsFit` 4 from `usableAreaM2 = panelArea × 4.2`. With the packing factor, `floor(4.2 × 0.85) = 3`. Replace the test:

```ts
test("panel fit applies a packing factor when no placement data exists", () => {
  const panel = SOLAR_PANELS[0];
  const fit = getPanelFit(panel, {
    maxSunshineHoursPerYear: 1800,
    monthlyBill: 250,
    selectedPanelCount: 20,
    usableAreaM2: getPanelAreaM2(panel) * 4.2,
  });

  // floor(4.2 * 0.85) = 3 — raw area division over-counts what fits.
  assert.equal(fit.maxPanelsFit, 3);
  assert.equal(fit.systemKw, Number(((panel.watts * 3) / 1000).toFixed(1)));
});
```

Add below it:

```ts
test("panel fit trusts the Solar API count when placements exist", () => {
  const panel = SOLAR_PANELS[0];
  const analysis = buildMetricFixture();
  const fit = getPanelFit(panel, {
    monthlyBill: 250,
    roofData: {
      ...analysis,
      usableRoofAreaM2: getPanelAreaM2(panel) * 10,
    },
    selectedPanelCount: 10,
  });

  // 10 placements from the API; the 0.85 packing haircut must NOT cut them to 8.
  assert.equal(fit.maxPanelsFit, 10);
});
```

- [ ] **Step 2: Run tests to verify the new expectations fail**

Run: `npx tsx --conditions=react-server --test tests/solar-metrics.test.ts`
Expected: FAIL — first updated test gets `maxPanelsFit` 4 (no packing factor yet).

- [ ] **Step 3: Implement in getPanelFit**

In `src/lib/solarPanels.ts` (~lines 254–264), current code:

```ts
  const panelAreaM2 = Math.max(getPanelAreaM2(panel), 0.1);
  const physicalFit = Math.max(0, Math.floor(Math.max(usableArea, 0) / panelAreaM2));
  const apiCandidateFit =
    input.roofData?.solarPanels.length ||
    input.roofData?.acceptedPanelCount ||
    input.roofData?.panelCount ||
    physicalFit;
  const maxPanelsFit = Math.max(0, Math.min(physicalFit, apiCandidateFit));
```

Replace with:

```ts
  const panelAreaM2 = Math.max(getPanelAreaM2(panel), 0.1);
  const AREA_PACKING_FACTOR = 0.85;
  const hasPlacements = (input.roofData?.solarPanels.length ?? 0) > 0;
  const physicalFit = Math.max(
    0,
    Math.floor(
      (Math.max(usableArea, 0) / panelAreaM2) *
        (hasPlacements ? 1 : AREA_PACKING_FACTOR)
    )
  );
  const apiCandidateFit =
    input.roofData?.solarPanels.length ||
    input.roofData?.acceptedPanelCount ||
    input.roofData?.panelCount ||
    physicalFit;
  const maxPanelsFit = hasPlacements
    ? Math.max(0, apiCandidateFit)
    : Math.max(0, Math.min(physicalFit, apiCandidateFit));
```

- [ ] **Step 4: Implement in buildFallbackRoofAnalysis**

In `src/lib/roof-analysis.ts` (~line 125), replace:

```ts
  const panelCount = clamp(Math.round(usableAreaM2 / 2.2), 14, 30);
```

with:

```ts
  const panelCount = clamp(Math.floor((usableAreaM2 / 2.2) * 0.85), 12, 26);
```

- [ ] **Step 5: Update the no-placements slider note**

In `PanelSelectionSlider` (`solar-analysis.tsx` ~4204–4208), replace the `!canRenderPanels` paragraph text with:

```tsx
        <p className="mt-3 text-xs leading-5 text-slate-400">
          Panel count is estimated from usable roof area - not a verified
          layout. Google Solar did not return individual module coordinates
          for this property, so no panels are drawn on the map.
        </p>
```

- [ ] **Step 6: Run the full gate**

Run: `npm test` — expected: ALL PASS (including `roof-analysis-proof.test.ts`, which only asserts relative panel counts and survives the fallback change; if any other assertion on fallback `panelCount` fails, update its expected value to match the new formula and say so in the commit body).
Run: `npm run typecheck` and `npm run lint` — expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/solarPanels.ts src/lib/roof-analysis.ts src/components/solar-analysis.tsx tests/solar-metrics.test.ts
git commit -m "Calibrate area-based panel estimates with packing factor

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: End-to-end verification

**Files:**
- No planned source changes (fix-forward only if verification finds issues).

**Interfaces:**
- Consumes: everything above.
- Produces: verified feature; evidence reported to the user.

- [ ] **Step 1: Full static + test gate**

Run: `npm test`, `npm run typecheck`, `npm run lint` — expected: all PASS.

- [ ] **Step 2: Live app verification (requires Google API keys in `.env.local`)**

1. Run `npm run dev` in the background.
2. Open `http://localhost:3000`, enter a real Maricopa County address (e.g. `6420 E Nance St, Mesa, AZ 85215`) in the analyzer.
3. Confirm on the rooftop map: panels render as blue rectangles tiling the roof planes in the photo (not a small centered clump); the "N panel layout" badge count equals the number of drawn rectangles; moving the panel slider adds/removes rectangles one-for-one from the tail; the "Final panel placement requires installer verification." caption is visible.
4. Toggle the Panels layer off/on and switch to the Sunlight view and back — no console errors.
5. If API keys are not configured locally, state that plainly in the report to the user and verify only via the static gate — do NOT claim visual verification happened.

- [ ] **Step 3: Snapshot/PDF spot check (only if a dashboard session is configured locally)**

Generate a report PDF through the dashboard flow for a lead with Solar API data and confirm the panel overlay tiles the roof drawing. If dashboard credentials/Supabase are not configured locally, skip and note it — the PDF path was covered by `tests/report-snapshot.test.ts` (API-order slicing) and is unchanged otherwise.

- [ ] **Step 4: Report**

Summarize to the user: what changed, evidence (test counts, what was seen in the browser), and any skipped verification with the reason.
