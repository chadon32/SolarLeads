import assert from "node:assert/strict";
import test from "node:test";
import {
  regularizeSolarPanels,
  selectCohesiveSolarPanels,
} from "../src/lib/panel-layout";
import {
  getPanelGroundDimensionsMeters,
  haversineMeters,
  offsetLatLngByBearingMeters,
} from "../src/lib/panel-geometry";
import type { SolarPanelPlacement } from "../src/lib/roof-analysis";

const ORIGIN = { lat: 33.48, lng: -111.69 };
const PANEL_WIDTH = 1.045;
const PANEL_HEIGHT = 1.879;

/** Deterministic pseudo-random in [-1, 1). */
function noise(seed: number) {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

/**
 * Build a rows x cols panel grid facing `azimuthDeg`, optionally jittered
 * in position (meters) and rotation metadata (degrees).
 */
function buildGrid({
  rows,
  cols,
  azimuthDeg = 180,
  pitchDeg = 20,
  jitterMeters = 0,
  segmentIndex = 0,
  orientation = "PORTRAIT",
  rowOffsets = [],
  skipCells = [],
}: {
  rows: number;
  cols: number;
  azimuthDeg?: number;
  pitchDeg?: number;
  jitterMeters?: number;
  segmentIndex?: number;
  orientation?: "PORTRAIT" | "LANDSCAPE";
  rowOffsets?: number[];
  skipCells?: Array<[number, number]>;
}): SolarPanelPlacement[] {
  const { alongAzimuthMeters, acrossAzimuthMeters } =
    getPanelGroundDimensionsMeters({
      orientation,
      panelWidthMeters: PANEL_WIDTH,
      panelHeightMeters: PANEL_HEIGHT,
      pitchDeg,
      insetMeters: 0,
    });

  const panels: SolarPanelPlacement[] = [];
  let seed = 1;

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      if (skipCells.some(([r, c]) => r === row && c === col)) {
        continue;
      }

      seed += 1;
      const alongOffset =
        row * alongAzimuthMeters + jitterMeters * noise(seed * 2);
      const acrossOffset =
        col * acrossAzimuthMeters +
        (rowOffsets[row] ?? 0) +
        jitterMeters * noise(seed * 2 + 1);

      const downSlope = offsetLatLngByBearingMeters({
        lat: ORIGIN.lat,
        lng: ORIGIN.lng,
        distanceMeters: alongOffset,
        bearingDeg: azimuthDeg,
      });
      const center = offsetLatLngByBearingMeters({
        lat: downSlope.lat,
        lng: downSlope.lng,
        distanceMeters: acrossOffset,
        bearingDeg: azimuthDeg + 90,
      });

      panels.push({
        center,
        orientation,
        azimuthDeg,
        pitchDeg,
        rowIndex: null,
        columnIndex: null,
        yearlyEnergyDcKwh: 500 - panels.length,
        segmentIndex,
      });
    }
  }

  return panels;
}

function regularize(panels: SolarPanelPlacement[]) {
  return regularizeSolarPanels({
    panels,
    panelWidthMeters: PANEL_WIDTH,
    panelHeightMeters: PANEL_HEIGHT,
  });
}

/** Pairwise spacing of consecutive modules within each row of a grid. */
function rowSpacings(panels: SolarPanelPlacement[], cols: number) {
  const spacings: number[] = [];
  for (let index = 0; index < panels.length; index += 1) {
    if (index % cols === cols - 1) {
      continue;
    }
    spacings.push(
      haversineMeters(
        panels[index].center.lat,
        panels[index].center.lng,
        panels[index + 1].center.lat,
        panels[index + 1].center.lng
      )
    );
  }
  return spacings;
}

test("jittered grid snaps back to uniform rows and one azimuth", () => {
  const clean = buildGrid({ rows: 3, cols: 5 });
  const jittered = buildGrid({ rows: 3, cols: 5, jitterMeters: 0.14 });

  const result = regularize(jittered);

  assert.equal(result.length, clean.length);

  // Single shared azimuth.
  const azimuths = new Set(result.map((panel) => panel.azimuthDeg));
  assert.equal(azimuths.size, 1);

  // Uniform spacing within rows (max deviation from mean < 1 cm).
  const spacings = rowSpacings(result, 5);
  const meanSpacing =
    spacings.reduce((sum, value) => sum + value, 0) / spacings.length;
  for (const spacing of spacings) {
    assert.ok(
      Math.abs(spacing - meanSpacing) < 0.01,
      `spacing ${spacing} vs mean ${meanSpacing}`
    );
  }

  // Snapped centers stay close to the clean grid. The lattice fit averages
  // the jitter, so residual drift is the same order as the input noise.
  result.forEach((panel, index) => {
    const drift = haversineMeters(
      panel.center.lat,
      panel.center.lng,
      clean[index].center.lat,
      clean[index].center.lng
    );
    assert.ok(drift < 0.25, `panel ${index} drifted ${drift}m from true grid`);
  });
});

test("clean grid passes through nearly unchanged", () => {
  const clean = buildGrid({ rows: 2, cols: 4 });
  const result = regularize(clean);

  result.forEach((panel, index) => {
    const moved = haversineMeters(
      panel.center.lat,
      panel.center.lng,
      clean[index].center.lat,
      clean[index].center.lng
    );
    assert.ok(moved < 0.02, `panel ${index} moved ${moved}m`);
  });
});

test("staggered rows keep their stagger but get uniform in-row spacing", () => {
  const staggered = buildGrid({
    rows: 2,
    cols: 4,
    jitterMeters: 0.1,
    rowOffsets: [0, 0.55],
  });

  const result = regularize(staggered);
  const spacings = rowSpacings(result, 4);
  const meanSpacing =
    spacings.reduce((sum, value) => sum + value, 0) / spacings.length;

  for (const spacing of spacings) {
    assert.ok(Math.abs(spacing - meanSpacing) < 0.01);
  }

  // Stagger preserved: row 1 is offset from row 0 by roughly 0.55m along
  // the across axis (azimuth + 90 = 270 = due west for this grid).
  const first = result[0];
  const second = result[4];
  const deltaEastMeters =
    (second.center.lng - first.center.lng) *
    111_320 *
    Math.cos((ORIGIN.lat * Math.PI) / 180);
  const acrossComponent = -deltaEastMeters;
  assert.ok(
    Math.abs(acrossComponent - 0.55) < 0.2,
    `stagger came out as ${acrossComponent}m, expected ~0.55m`
  );
});

test("grids with a skipped cell keep the gap", () => {
  const withGap = buildGrid({
    rows: 1,
    cols: 5,
    jitterMeters: 0.08,
    skipCells: [[0, 2]],
  });

  const result = regularize(withGap);
  assert.equal(result.length, 4);

  const spacingAcrossGap = haversineMeters(
    result[1].center.lat,
    result[1].center.lng,
    result[2].center.lat,
    result[2].center.lng
  );
  const normalSpacing = haversineMeters(
    result[0].center.lat,
    result[0].center.lng,
    result[1].center.lat,
    result[1].center.lng
  );
  assert.ok(
    Math.abs(spacingAcrossGap - 2 * normalSpacing) < 0.02,
    `gap ${spacingAcrossGap} vs 2x ${normalSpacing}`
  );
});

test("a module detected off to the side gets its own slot; neighbors stay put", () => {
  const panels = buildGrid({ rows: 2, cols: 3 });
  // Push one module ~1m across-slope: it should land on a farther lattice
  // slot (with a gap), not drag its clean neighbors toward it.
  const outlier = offsetLatLngByBearingMeters({
    lat: panels[2].center.lat,
    lng: panels[2].center.lng,
    distanceMeters: 1.0,
    bearingDeg: 245,
  });
  const modified = [...panels];
  modified[2] = { ...modified[2], center: outlier };

  const result = regularize(modified);

  // Clean modules stay effectively where Google put them.
  for (const index of [0, 1, 3, 4, 5]) {
    const moved = haversineMeters(
      result[index].center.lat,
      result[index].center.lng,
      panels[index].center.lat,
      panels[index].center.lng
    );
    assert.ok(moved < 0.05, `clean panel ${index} moved ${moved}m`);
  }

  // The outlier stays near its detected spot (aligned, not relocated).
  const outlierMove = haversineMeters(
    result[2].center.lat,
    result[2].center.lng,
    outlier.lat,
    outlier.lng
  );
  assert.ok(outlierMove < 0.6, `outlier moved ${outlierMove}m`);
});

test("plane reverts untouched when a module sits in the row walkway", () => {
  const panels = buildGrid({ rows: 2, cols: 3 });
  // Drag a module halfway between two rows: no honest lattice fits, so the
  // plane must keep Google's placements.
  const walkway = offsetLatLngByBearingMeters({
    lat: panels[2].center.lat,
    lng: panels[2].center.lng,
    distanceMeters: 0.9,
    bearingDeg: 180,
  });
  panels[2] = { ...panels[2], center: walkway };

  const result = regularize(panels);

  result.forEach((panel, index) => {
    assert.equal(panel.center.lat, panels[index].center.lat);
    assert.equal(panel.center.lng, panels[index].center.lng);
  });
});

test("segments regularize independently and metadata passes through", () => {
  const south = buildGrid({ rows: 2, cols: 3, jitterMeters: 0.1 });
  const west = buildGrid({
    rows: 2,
    cols: 2,
    azimuthDeg: 270,
    jitterMeters: 0.1,
    segmentIndex: 1,
  });
  const panels = [...south, ...west];

  const result = regularize(panels);

  // Order and energy preserved.
  result.forEach((panel, index) => {
    assert.equal(panel.yearlyEnergyDcKwh, panels[index].yearlyEnergyDcKwh);
    assert.equal(panel.segmentIndex, panels[index].segmentIndex);
    assert.equal(panel.pitchDeg, panels[index].pitchDeg);
  });

  // Each segment has its own single azimuth.
  const southAzimuths = new Set(
    result.slice(0, south.length).map((panel) => panel.azimuthDeg)
  );
  const westAzimuths = new Set(
    result.slice(south.length).map((panel) => panel.azimuthDeg)
  );
  assert.equal(southAzimuths.size, 1);
  assert.equal(westAzimuths.size, 1);
  assert.notDeepEqual([...southAzimuths], [...westAzimuths]);
});

test("single-file column with lateral wobble straightens into one line", () => {
  // One module per row down the slope, each wobbling sideways a little —
  // the classic zigzag strip. All modules must end up on one column line.
  const wobble = [0.1, -0.15, 0.2, -0.1, 0.15, 0];
  const panels = buildGrid({
    rows: 6,
    cols: 1,
    azimuthDeg: 270,
    rowOffsets: wobble,
  });

  const result = regularize(panels);

  // Across-axis component of every module relative to the first, measured
  // in the plane's own fitted frame — straight means collinear along the
  // consensus azimuth, even if that axis tilts a fraction of a degree to
  // absorb the wobble.
  const az = (result[0].azimuthDeg * Math.PI) / 180;
  const first = result[0];
  const acrossComponents = result.map((panel) => {
    const east =
      (panel.center.lng - first.center.lng) *
      111_320 *
      Math.cos((ORIGIN.lat * Math.PI) / 180);
    const north = (panel.center.lat - first.center.lat) * 111_320;
    return east * Math.cos(az) - north * Math.sin(az);
  });

  for (const across of acrossComponents) {
    assert.ok(Math.abs(across) < 0.02, `column wobbles by ${across}m`);
  }

  // And the fitted axis stays close to the true plane azimuth.
  assert.ok(
    Math.abs(result[0].azimuthDeg - 270) < 3,
    `consensus azimuth drifted to ${result[0].azimuthDeg}`
  );
});

test("tiny groups are left alone", () => {
  const single = buildGrid({ rows: 1, cols: 1 });
  const result = regularize(single);
  assert.deepEqual(result, single);
});

test("near-orthogonal segments snap to one shared building axis", () => {
  // Main array at azimuth 90; a smaller plane reported at 97 (Google noise)
  // and another at 357. All are really right angles of one rectangular house.
  const main = buildGrid({ rows: 3, cols: 4, azimuthDeg: 90, jitterMeters: 0.05 });
  const skewed = buildGrid({
    rows: 2,
    cols: 2,
    azimuthDeg: 97,
    jitterMeters: 0.05,
    segmentIndex: 1,
  });
  const north = buildGrid({
    rows: 2,
    cols: 2,
    azimuthDeg: 357,
    jitterMeters: 0.05,
    segmentIndex: 2,
  });

  const result = regularize([...main, ...skewed, ...north]);

  const azOf = (index: number) => result[index].azimuthDeg;
  const mainAz = azOf(0);
  const skewedAz = azOf(main.length);
  const northAz = azOf(main.length + skewed.length);

  // The skewed plane lands exactly 0 or 90 degrees from the main plane.
  const rel = Math.abs(((skewedAz - mainAz) % 90) + 90) % 90;
  assert.ok(
    Math.min(rel, 90 - rel) < 0.01,
    `skewed plane ${skewedAz} not orthogonal to main ${mainAz}`
  );
  const relNorth = Math.abs(((northAz - mainAz) % 90) + 90) % 90;
  assert.ok(
    Math.min(relNorth, 90 - relNorth) < 0.01,
    `north plane ${northAz} not orthogonal to main ${mainAz}`
  );

  // And the snap stays honest: within a few degrees of what Google reported.
  assert.ok(Math.abs(skewedAz - 97) < 9, `skewed moved too far: ${skewedAz}`);
  assert.ok(
    Math.min(Math.abs(northAz - 357), Math.abs(northAz - 357 + 360)) < 9,
    `north moved too far: ${northAz}`
  );
});

test("a genuinely diagonal plane refuses the building-axis snap", () => {
  const main = buildGrid({ rows: 3, cols: 4, azimuthDeg: 90 });
  const diagonal = buildGrid({
    rows: 2,
    cols: 2,
    azimuthDeg: 135,
    segmentIndex: 1,
  });

  const result = regularize([...main, ...diagonal]);
  const diagAz = result[main.length].azimuthDeg;

  // 135 is 45 degrees off the axis — must remain untouched.
  assert.ok(Math.abs(diagAz - 135) < 3, `diagonal plane snapped: ${diagAz}`);
});

test("sample layout prefers one cohesive plane over scattered energy-ranked planes", () => {
  const mainPlane = buildGrid({
    rows: 4,
    cols: 6,
    azimuthDeg: 90,
    segmentIndex: 0,
  }).map((panel) => ({ ...panel, yearlyEnergyDcKwh: 760 }));
  const smallPremiumPlane = buildGrid({
    rows: 2,
    cols: 4,
    azimuthDeg: 180,
    segmentIndex: 1,
  }).map((panel) => ({ ...panel, yearlyEnergyDcKwh: 820 }));
  const secondPremiumPlane = buildGrid({
    rows: 2,
    cols: 3,
    azimuthDeg: 270,
    segmentIndex: 2,
  }).map((panel) => ({ ...panel, yearlyEnergyDcKwh: 800 }));
  const apiRankedPanels = [
    ...smallPremiumPlane,
    ...secondPremiumPlane,
    ...mainPlane,
  ];

  const selected = selectCohesiveSolarPanels({
    panels: apiRankedPanels,
    targetCount: 14,
    panelWidthMeters: PANEL_WIDTH,
    panelHeightMeters: PANEL_HEIGHT,
  });

  assert.equal(selected.length, 14);
  assert.deepEqual(
    new Set(selected.map((panel) => panel.segmentIndex)),
    new Set([0])
  );
});

test("sample layout fills a compact block instead of leaving ranked holes", () => {
  const grid = buildGrid({
    rows: 5,
    cols: 6,
    azimuthDeg: 90,
    segmentIndex: 0,
  }).map((panel, index) => {
    const rowIndex = Math.floor(index / 6);
    const columnIndex = index % 6;
    const edgeDistance = Math.min(
      rowIndex,
      4 - rowIndex,
      columnIndex,
      5 - columnIndex
    );
    return {
      ...panel,
      rowIndex,
      columnIndex,
      yearlyEnergyDcKwh: 900 - edgeDistance * 100 - index,
    };
  });
  const apiRankedPanels = [...grid].sort(
    (left, right) => right.yearlyEnergyDcKwh - left.yearlyEnergyDcKwh
  );

  const selected = selectCohesiveSolarPanels({
    panels: apiRankedPanels,
    targetCount: 12,
    panelWidthMeters: PANEL_WIDTH,
    panelHeightMeters: PANEL_HEIGHT,
  });
  const rows = selected.map((panel) => panel.rowIndex ?? 0);
  const columns = selected.map((panel) => panel.columnIndex ?? 0);
  const occupiedBoundingCells =
    (Math.max(...rows) - Math.min(...rows) + 1) *
    (Math.max(...columns) - Math.min(...columns) + 1);

  assert.equal(selected.length, 12);
  assert.ok(
    occupiedBoundingCells <= 16,
    `selection spread across ${occupiedBoundingCells} grid cells`
  );
});
