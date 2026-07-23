import assert from "node:assert/strict";
import test from "node:test";
import { selectPrimaryBuildingSegments } from "../src/lib/building-filter";

// ~1m in degrees at Phoenix latitudes.
const LAT_M = 1 / 111_320;
const LNG_M = 1 / (111_320 * Math.cos((33.48 * Math.PI) / 180));

function box(
  index: number,
  lat: number,
  lng: number,
  widthM: number,
  heightM: number
) {
  return {
    index,
    north: lat + (heightM / 2) * LAT_M,
    south: lat - (heightM / 2) * LAT_M,
    east: lng + (widthM / 2) * LNG_M,
    west: lng - (widthM / 2) * LNG_M,
  };
}

test("keeps only the building containing the geocoded point", () => {
  // Home A: two touching planes around the target. Home B: 8m east.
  const homeA1 = box(0, 33.48, -111.69, 8, 6);
  const homeA2 = box(1, 33.48, -111.69 + 8 * LNG_M, 8, 6); // shares an edge
  const homeB = box(2, 33.48, -111.69 + 24 * LNG_M, 8, 6); // 8m gap from A2

  const kept = selectPrimaryBuildingSegments({
    boxes: [homeA1, homeA2, homeB],
    targetLat: 33.48,
    targetLng: -111.69,
  });

  assert.deepEqual([...kept].sort(), [0, 1]);
});

test("planes within the gap tolerance form one building", () => {
  // 1.5m apart — same structure (hip planes never touch box-to-box exactly).
  const a = box(0, 33.48, -111.69, 8, 6);
  const nearby = box(1, 33.48, -111.69 + (8 + 1.5) * LNG_M, 6, 6);

  const kept = selectPrimaryBuildingSegments({
    boxes: [a, nearby],
    targetLat: 33.48,
    targetLng: -111.69,
  });

  assert.deepEqual([...kept].sort(), [0, 1]);
});

test("falls back to the nearest building when the point sits outside all", () => {
  const west = box(0, 33.48, -111.6905, 8, 6);
  const east = box(1, 33.48, -111.689, 8, 6);

  const kept = selectPrimaryBuildingSegments({
    boxes: [west, east],
    targetLat: 33.48,
    targetLng: -111.6903, // just west of the midpoint, nearer `west`
  });

  assert.deepEqual([...kept], [0]);
});

test("original indices survive, not array positions", () => {
  const far = box(7, 33.48, -111.6885, 8, 6);
  const target = box(3, 33.48, -111.69, 8, 6);

  const kept = selectPrimaryBuildingSegments({
    boxes: [far, target],
    targetLat: 33.48,
    targetLng: -111.69,
  });

  assert.deepEqual([...kept], [3]);
});

// ---- terrain-verified detachment ----

import { findDetachedSegments } from "../src/lib/building-filter";

function panelRow(
  segmentIndex: number,
  startLng: number,
  count: number,
  lat = 33.503
) {
  return Array.from({ length: count }, (_, i) => ({
    segmentIndex,
    lat,
    lng: startLng + i * 1.0 * LNG_M,
  }));
}

test("cluster across a ground-level gap is detached", () => {
  // Home array at the pin; neighbor cluster 2.3m east of its last panel.
  const home = panelRow(0, -111.9163, 5);
  const homeEastLng = home[home.length - 1].lng;
  const neighbor = panelRow(2, homeEastLng + 2.3 * LNG_M, 3);

  const detached = findDetachedSegments({
    points: [...home, ...neighbor],
    targetLat: 33.503,
    targetLng: -111.9163,
    // Ground-level dip halfway between the clusters.
    sampleRelativeHeightMeters: (lat, lng) =>
      lng > homeEastLng + 0.8 * LNG_M && lng < homeEastLng + 1.6 * LNG_M
        ? 0.2
        : 4,
  });

  assert.deepEqual([...detached], [2]);
});

test("clusters bridged by roof-height terrain stay together", () => {
  const south = panelRow(0, -111.9163, 5);
  const eastLng = south[south.length - 1].lng;
  // Same 2.3m gap, but the terrain between stays at ridge height.
  const north = panelRow(1, eastLng + 2.3 * LNG_M, 3);

  const detached = findDetachedSegments({
    points: [...south, ...north],
    targetLat: 33.503,
    targetLng: -111.9163,
    sampleRelativeHeightMeters: () => 4.5,
  });

  assert.equal(detached.size, 0);
});

test("contiguous arrays never consult the terrain", () => {
  const a = panelRow(0, -111.9163, 4);
  const b = panelRow(1, a[a.length - 1].lng + 1.2 * LNG_M, 4);

  const detached = findDetachedSegments({
    points: [...a, ...b],
    targetLat: 33.503,
    targetLng: -111.9163,
    // Even hostile terrain cannot split panels within contiguous range.
    sampleRelativeHeightMeters: () => 0,
  });

  assert.equal(detached.size, 0);
});

test("unknown terrain fails open", () => {
  const home = panelRow(0, -111.9163, 5);
  const other = panelRow(2, home[home.length - 1].lng + 2.3 * LNG_M, 3);

  const detached = findDetachedSegments({
    points: [...home, ...other],
    targetLat: 33.503,
    targetLng: -111.9163,
    sampleRelativeHeightMeters: () => null,
  });

  assert.equal(detached.size, 0);
});

test("attached unit across a height step is detached despite continuous roof", () => {
  // Same-height terrain bridge (no ground gap — party-wall homes), but the
  // far cluster sits on a roof 2.6m lower, 2.3m away.
  const home = panelRow(0, -111.9163, 5);
  const homeEastLng = home[home.length - 1].lng;
  const attachedUnit = panelRow(2, homeEastLng + 2.3 * LNG_M, 3);

  const detached = findDetachedSegments({
    points: [...home, ...attachedUnit],
    targetLat: 33.503,
    targetLng: -111.9163,
    // Heights: home roof 5.7m, unit roof 3.1m, terrain never dips.
    sampleRelativeHeightMeters: (lat, lng) =>
      lng > homeEastLng + 1.0 * LNG_M ? 3.1 : 5.7,
  });

  assert.deepEqual([...detached], [2]);
});

test("close clusters on different levels still merge (split-level home)", () => {
  // Split-level: 1.2m lateral gap, 2.5m height difference — contiguous
  // range wins, no terrain consultation.
  const upper = panelRow(0, -111.9163, 4);
  const lower = panelRow(1, upper[upper.length - 1].lng + 1.2 * LNG_M, 4);

  const detached = findDetachedSegments({
    points: [...upper, ...lower],
    targetLat: 33.503,
    targetLng: -111.9163,
    sampleRelativeHeightMeters: (lat, lng) =>
      lng > upper[upper.length - 1].lng + 0.5 * LNG_M ? 3.0 : 5.5,
  });

  assert.equal(detached.size, 0);
});

// ---- off-plane (overhanging) panels ----

import { findOffPlanePanels } from "../src/lib/building-filter";

function panelGrid(segmentIndex: number, rows: number, cols: number) {
  const points = [] as Array<{
    panelIndex: number;
    segmentIndex: number;
    lat: number;
    lng: number;
    azimuthDeg: number;
    pitchDeg: number;
  }>;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      points.push({
        panelIndex: points.length,
        segmentIndex,
        lat: 33.503 - r * 1.7 * LAT_M,
        lng: -111.9163 + c * 1.0 * LNG_M,
        azimuthDeg: 180,
        pitchDeg: 0,
      });
    }
  }
  return points;
}

test("a run of modules drooping off the roof edge is flagged", () => {
  // 3x4 flat roof grid plus a two-module tail hanging over a lower
  // structure — the exact Minnezona overhang shape.
  const grid = panelGrid(0, 3, 4);
  const tail = [
    { panelIndex: 12, segmentIndex: 0, lat: 33.503 - 3 * 1.7 * LAT_M, lng: -111.9163 + 3 * LNG_M, azimuthDeg: 180, pitchDeg: 0 },
    { panelIndex: 13, segmentIndex: 0, lat: 33.503 - 4 * 1.7 * LAT_M, lng: -111.9163 + 3 * LNG_M, azimuthDeg: 180, pitchDeg: 0 },
  ];

  const flagged = findOffPlanePanels({
    points: [...grid, ...tail],
    targetLat: 33.503,
    targetLng: -111.9163,
    // Roof at 5m; the tail sits over a 3.2m structure.
    sampleRelativeHeightMeters: (lat) =>
      lat < 33.503 - 2.5 * 1.7 * LAT_M ? 3.2 : 5.0,
  });

  assert.deepEqual([...flagged].sort(), [12, 13]);
});

test("downslope modules on a pitched plane are NOT flagged", () => {
  // South-pitched plane: heights drop legitimately downslope; the robust
  // fit must recover the tilt rather than flag the low end.
  const tan20 = Math.tan((20 * Math.PI) / 180);
  const points = panelGrid(0, 4, 3);

  const flagged = findOffPlanePanels({
    points,
    targetLat: 33.503,
    targetLng: -111.9163,
    sampleRelativeHeightMeters: (lat) =>
      6 - tan20 * ((33.503 - lat) / LAT_M),
  });

  assert.equal(flagged.size, 0);
});

test("tiny segments are never judged", () => {
  const flagged = findOffPlanePanels({
    points: [
      { panelIndex: 0, segmentIndex: 0, lat: 33.503, lng: -111.9163, azimuthDeg: 180, pitchDeg: 0 },
      { panelIndex: 1, segmentIndex: 0, lat: 33.503, lng: -111.9162, azimuthDeg: 180, pitchDeg: 0 },
    ],
    targetLat: 33.503,
    targetLng: -111.9163,
    sampleRelativeHeightMeters: () => 0,
  });
  assert.equal(flagged.size, 0);
});

// ---- raised-equipment (AC unit) panels ----

import { findObstructedPanels } from "../src/lib/building-filter";

test("panels over a 1.1m equipment bump are flagged; clean roof is not", () => {
  const grid = panelGrid(0, 4, 4);
  // AC unit under two adjacent panels (indices 5 and 6): footprint peak
  // rises ~1.1m; the rest of the roof is flat at plane height.
  const acPanels = new Set([5, 6]);
  const acLat = grid[5].lat, acLng = grid[5].lng;

  const flagged = findObstructedPanels({
    points: grid,
    targetLat: 33.503,
    targetLng: -111.9163,
    sampleRelativeHeightMeters: () => 5.0, // flat plane for the fit
    sampleFootprintPeakMeters: (lat, lng) => {
      // Peak spikes to 6.1m near the AC panels, flat 5.0m elsewhere.
      const near =
        Math.abs(lat - acLat) < 1.3 / 111_320 &&
        Math.abs(lng - acLng) < 1.5 / 91_600;
      return near ? 6.1 : 5.0;
    },
  });

  assert.ok(acPanels.size === 2);
  // The AC-covered panels are flagged...
  assert.ok(flagged.has(5) && flagged.has(6), "AC panels not flagged");
  // ...and panels well away from the unit are left alone.
  for (const clean of [0, 3, 12, 15]) {
    assert.ok(!flagged.has(clean), `clean panel ${clean} wrongly flagged`);
  }
});

test("a pitched roof's downslope panels are not mistaken for equipment", () => {
  // Pitched plane; footprint peak tracks the plane exactly (no equipment).
  const tan18 = Math.tan((18 * Math.PI) / 180);
  const grid = panelGrid(0, 5, 3);
  const heightAt = (lat: number) => 6 - tan18 * ((33.503 - lat) / LAT_M);

  const flagged = findObstructedPanels({
    points: grid,
    targetLat: 33.503,
    targetLng: -111.9163,
    sampleRelativeHeightMeters: heightAt,
    sampleFootprintPeakMeters: (lat) => heightAt(lat), // on-plane everywhere
  });

  assert.equal(flagged.size, 0);
});

test("small bumps under the equipment threshold are ignored", () => {
  const grid = panelGrid(0, 4, 3);
  const flagged = findObstructedPanels({
    points: grid,
    targetLat: 33.503,
    targetLng: -111.9163,
    sampleRelativeHeightMeters: () => 5.0,
    // Every panel has a 0.5m footprint bump (roof noise) — below 0.8m.
    sampleFootprintPeakMeters: () => 5.5,
  });
  assert.equal(flagged.size, 0);
});
