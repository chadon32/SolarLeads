import assert from "node:assert/strict";
import test from "node:test";
import { buildFallbackRoofAnalysis } from "../src/lib/roof-analysis";
import {
  angularDistanceDeg,
  bearingDegrees,
  buildPanelCornerLatLngPoints,
  buildPanelPolygonPath,
  getPanelFallbackAzimuthDeg,
  getPanelGroundDimensionsMeters,
  haversineMeters,
  inferPanelRotationDeg,
  isValidLatLngPoint,
  meanUndirectedAxisDeg,
  normalizeDegrees,
  offsetLatLngByBearingMeters,
  offsetLatLngMeters,
  orientAxisToward,
} from "../src/lib/panel-geometry";

const METERS_PER_DEGREE_LAT = 111_320;

function buildPanel(overrides: Record<string, unknown> = {}) {
  return {
    azimuthDeg: 180,
    center: { lat: 33.4, lng: -111.9 },
    columnIndex: null as number | null,
    orientation: "PORTRAIT" as const,
    pitchDeg: 0,
    rowIndex: null as number | null,
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

test("offsetLatLngByBearingMeters moves along compass bearings", () => {
  const north = offsetLatLngByBearingMeters({
    lat: 0,
    lng: 0,
    distanceMeters: 111.32,
    bearingDeg: 0,
  });
  assert.ok(Math.abs(north.lat - 0.001) < 1e-9);

  const east = offsetLatLngByBearingMeters({
    lat: 0,
    lng: 0,
    distanceMeters: 111.32,
    bearingDeg: 90,
  });
  assert.ok(Math.abs(east.lng - 0.001) < 1e-6);
});

test("isValidLatLngPoint rejects out-of-range and non-finite points", () => {
  assert.equal(isValidLatLngPoint({ lat: 33.4, lng: -111.9 }), true);
  assert.equal(isValidLatLngPoint({ lat: Number.NaN, lng: 0 }), false);
  assert.equal(isValidLatLngPoint({ lat: 91, lng: 0 }), false);
  assert.equal(isValidLatLngPoint(null), false);
});

test("getPanelGroundDimensionsMeters foreshortens along-azimuth by cos(pitch)", () => {
  const flat = getPanelGroundDimensionsMeters({
    orientation: "PORTRAIT",
    panelHeightMeters: 1.879,
    panelWidthMeters: 1.045,
    pitchDeg: 0,
  });
  assert.ok(Math.abs(flat.alongAzimuthMeters - 1.879) < 1e-9);
  assert.ok(Math.abs(flat.acrossAzimuthMeters - 1.045) < 1e-9);

  const pitched = getPanelGroundDimensionsMeters({
    orientation: "PORTRAIT",
    panelHeightMeters: 1.879,
    panelWidthMeters: 1.045,
    pitchDeg: 30,
  });
  assert.ok(Math.abs(pitched.alongAzimuthMeters - 1.879 * Math.cos(Math.PI / 6)) < 1e-9);
  assert.ok(Math.abs(pitched.acrossAzimuthMeters - 1.045) < 1e-9);
});

test("getPanelGroundDimensionsMeters swaps axes for LANDSCAPE", () => {
  const dims = getPanelGroundDimensionsMeters({
    orientation: "LANDSCAPE",
    panelHeightMeters: 1.879,
    panelWidthMeters: 1.045,
    pitchDeg: 27,
  });
  // LANDSCAPE: along-az uses panel width, foreshortened.
  assert.ok(Math.abs(dims.alongAzimuthMeters - 1.045 * Math.cos((27 * Math.PI) / 180)) < 1e-9);
  assert.ok(Math.abs(dims.acrossAzimuthMeters - 1.879) < 1e-9);
});

test("meanUndirectedAxisDeg averages opposite bearings as one axis", () => {
  const axis = meanUndirectedAxisDeg([90, 270, 88, 272]);
  assert.ok(angularDistanceDeg(axis, 90) < 3 || angularDistanceDeg(axis, 0) < 3);
  // Undirected result is in [0, 180).
  assert.ok(axis >= 0 && axis < 180);
  assert.ok(angularDistanceDeg(axis, 90) < 3);
});

test("orientAxisToward picks the direction closest to preferred", () => {
  assert.equal(orientAxisToward(10, 0), 10);
  assert.equal(orientAxisToward(10, 180), 190);
});

test("inferPanelRotationDeg uses panel azimuth when alone", () => {
  const panel = buildPanel({ azimuthDeg: 180 });
  assert.equal(inferPanelRotationDeg(panel, [panel], 90), 180);
});

test("inferPanelRotationDeg falls back to provided azimuth with no panel azimuth", () => {
  const panel = buildPanel({ azimuthDeg: Number.NaN });
  assert.equal(inferPanelRotationDeg(panel, [panel], 230), 230);
});

test("inferPanelRotationDeg uses LANDSCAPE along-grid neighbor bearing", () => {
  // LANDSCAPE packs short side along azimuth. Neighbor due south ≈ az 180.
  const panel = buildPanel({
    azimuthDeg: 0, // deliberately wrong segment az
    orientation: "LANDSCAPE" as const,
    pitchDeg: 0,
  });
  const neighbor = buildPanel({
    azimuthDeg: 0,
    orientation: "LANDSCAPE" as const,
    pitchDeg: 0,
    center: offsetLatLngByBearingMeters({
      lat: panel.center.lat,
      lng: panel.center.lng,
      distanceMeters: 1.045,
      bearingDeg: 180,
    }),
  });
  const rotation = inferPanelRotationDeg(
    panel,
    [panel, neighbor],
    0,
    1.045,
    1.879
  );
  // 0° and 180° are the same undirected packing axis (rectangle is identical).
  const axisError = Math.min(
    angularDistanceDeg(rotation, 0),
    angularDistanceDeg(rotation, 180)
  );
  assert.ok(axisError < 2);
});

test("inferPanelRotationDeg uses PORTRAIT across-grid neighbor for azimuth", () => {
  // PORTRAIT packs short side across azimuth. Neighbor due east ⇒ az ≈ 180? 
  // Across = az+90 = 90 for az=0. Neighbor east ⇒ across axis 90 ⇒ az = 0.
  const panel = buildPanel({
    azimuthDeg: 45, // wrong-ish; grid should correct toward 0
    orientation: "PORTRAIT" as const,
    pitchDeg: 0,
  });
  const neighbor = buildPanel({
    azimuthDeg: 45,
    orientation: "PORTRAIT" as const,
    pitchDeg: 0,
    center: offsetLatLngByBearingMeters({
      lat: panel.center.lat,
      lng: panel.center.lng,
      distanceMeters: 1.045,
      bearingDeg: 90,
    }),
  });
  const rotation = inferPanelRotationDeg(
    panel,
    [panel, neighbor],
    45,
    1.045,
    1.879
  );
  // across=90 ⇒ az candidates 0 or 180; preferred 45 picks 0.
  assert.ok(angularDistanceDeg(rotation, 0) < 2);
});

test("buildPanelPolygonPath spans real panel dimensions for flat PORTRAIT", () => {
  const panel = buildPanel({ azimuthDeg: 0, orientation: "PORTRAIT" as const, pitchDeg: 0 });
  const path = buildPanelPolygonPath({
    fallbackAzimuthDeg: 0,
    panel,
    panelHeightMeters: 1.879,
    panelWidthMeters: 1.045,
    panels: [panel],
  });

  assert.equal(path.length, 4);
  assert.ok(Math.abs(latSpanMeters(path) - 1.879) < 0.02);
  assert.ok(Math.abs(lngSpanMeters(path, 33.4) - 1.045) < 0.02);
});

test("buildPanelPolygonPath foreshortens pitched PORTRAIT along azimuth", () => {
  const pitchDeg = 30;
  const panel = buildPanel({
    azimuthDeg: 0,
    orientation: "PORTRAIT" as const,
    pitchDeg,
  });
  const path = buildPanelPolygonPath({
    fallbackAzimuthDeg: 0,
    panel,
    panelHeightMeters: 1.879,
    panelWidthMeters: 1.045,
    panels: [panel],
  });

  const expectedAlong = 1.879 * Math.cos((pitchDeg * Math.PI) / 180);
  assert.ok(Math.abs(latSpanMeters(path) - expectedAlong) < 0.03);
  assert.ok(Math.abs(lngSpanMeters(path, 33.4) - 1.045) < 0.02);
});

test("buildPanelPolygonPath foreshortens pitched LANDSCAPE along azimuth", () => {
  // Real Tempe-like case: pitch ~39.5°, LANDSCAPE, az west, nn spacing ~0.807m.
  const pitchDeg = 39.5;
  const panel = buildPanel({
    azimuthDeg: 270,
    orientation: "LANDSCAPE" as const,
    pitchDeg,
  });
  const path = buildPanelPolygonPath({
    fallbackAzimuthDeg: 270,
    panel,
    panelHeightMeters: 1.879,
    panelWidthMeters: 1.045,
    panels: [panel],
  });

  const expectedAlong = 1.045 * Math.cos((pitchDeg * Math.PI) / 180);
  // az 270: along is west-east (lng), across is north-south (lat)
  assert.ok(Math.abs(lngSpanMeters(path, 33.4) - expectedAlong) < 0.03);
  assert.ok(Math.abs(latSpanMeters(path) - 1.879) < 0.03);
});

test("buildPanelPolygonPath swaps sides for landscape orientation", () => {
  const panel = buildPanel({ azimuthDeg: 0, orientation: "LANDSCAPE" as const, pitchDeg: 0 });
  const path = buildPanelPolygonPath({
    fallbackAzimuthDeg: 0,
    panel,
    panelHeightMeters: 1.879,
    panelWidthMeters: 1.045,
    panels: [panel],
  });

  assert.ok(Math.abs(latSpanMeters(path) - 1.045) < 0.02);
  assert.ok(Math.abs(lngSpanMeters(path, 33.4) - 1.879) < 0.02);
});

test("buildPanelPolygonPath applies per-side seam inset", () => {
  const panel = buildPanel({ azimuthDeg: 0, orientation: "PORTRAIT" as const, pitchDeg: 0 });
  const path = buildPanelPolygonPath({
    fallbackAzimuthDeg: 0,
    insetMeters: 0.03,
    panel,
    panelHeightMeters: 1.879,
    panelWidthMeters: 1.045,
    panels: [panel],
  });

  assert.ok(Math.abs(latSpanMeters(path) - (1.879 - 0.06)) < 0.02);
  assert.ok(Math.abs(lngSpanMeters(path, 33.4) - (1.045 - 0.06)) < 0.02);
});

test("buildPanelPolygonPath rotates with the segment azimuth", () => {
  const panel = buildPanel({ azimuthDeg: 90, orientation: "PORTRAIT" as const, pitchDeg: 0 });
  const path = buildPanelPolygonPath({
    fallbackAzimuthDeg: 90,
    panel,
    panelHeightMeters: 1.879,
    panelWidthMeters: 1.045,
    panels: [panel],
  });

  assert.ok(Math.abs(latSpanMeters(path) - 1.045) < 0.02);
  assert.ok(Math.abs(lngSpanMeters(path, 33.4) - 1.879) < 0.02);
});

test("adjacent pitched LANDSCAPE panels do not massively overlap", () => {
  const pitchDeg = 27;
  const spacing = 1.045 * Math.cos((pitchDeg * Math.PI) / 180);
  const a = buildPanel({
    azimuthDeg: 0,
    orientation: "LANDSCAPE" as const,
    pitchDeg,
  });
  const b = buildPanel({
    azimuthDeg: 0,
    orientation: "LANDSCAPE" as const,
    pitchDeg,
    center: offsetLatLngByBearingMeters({
      lat: a.center.lat,
      lng: a.center.lng,
      distanceMeters: spacing,
      bearingDeg: 0,
    }),
  });

  const pathA = buildPanelPolygonPath({
    fallbackAzimuthDeg: 0,
    insetMeters: 0.03,
    panel: a,
    panelHeightMeters: 1.879,
    panelWidthMeters: 1.045,
    panels: [a, b],
  });
  const pathB = buildPanelPolygonPath({
    fallbackAzimuthDeg: 0,
    insetMeters: 0.03,
    panel: b,
    panelHeightMeters: 1.879,
    panelWidthMeters: 1.045,
    panels: [a, b],
  });

  // Centers stay one spacing apart; half-extents with inset should leave a small gap.
  const centerDist = haversineMeters(
    a.center.lat,
    a.center.lng,
    b.center.lat,
    b.center.lng
  );
  assert.ok(Math.abs(centerDist - spacing) < 0.02);

  const spanA = latSpanMeters(pathA);
  assert.ok(spanA < spacing); // each panel shorter than center spacing ⇒ no overlap along axis
  assert.ok(spanA > spacing * 0.85);
  void pathB;
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
