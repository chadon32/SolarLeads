import assert from "node:assert/strict";
import test from "node:test";
import { selectCohesiveSolarPanels } from "../src/lib/panel-layout";
import type { SolarPanelPlacement } from "../src/lib/roof-analysis";

const dimensions = { panelWidthMeters: 1.1, panelHeightMeters: 1.8 };

function buildPanels(count = 12): SolarPanelPlacement[] {
  return Array.from({ length: count }, (_, index) => ({
    azimuthDeg: 180,
    center: {
      lat: 33.45 + Math.floor(index / 4) * 0.000018,
      lng: -111.94 + (index % 4) * 0.000022,
    },
    columnIndex: index % 4,
    orientation: "PORTRAIT" as const,
    pitchDeg: 20,
    rowIndex: Math.floor(index / 4),
    segmentIndex: 0,
    yearlyEnergyDcKwh: 700 + index * 10,
  }));
}

function select(
  panels: SolarPanelPlacement[],
  targetCount = 6,
  selectionDimensions = dimensions
) {
  return selectCohesiveSolarPanels({ ...selectionDimensions, panels, targetCount });
}

function snapshot(panels: SolarPanelPlacement[]) {
  return panels.map((panel) => [
    panel.center.lat,
    panel.center.lng,
    panel.orientation,
    panel.segmentIndex,
    panel.yearlyEnergyDcKwh,
    panel.pitchDeg,
    panel.azimuthDeg,
    panel.rowIndex,
    panel.columnIndex,
  ]);
}

function clonePanels(panels: SolarPanelPlacement[]) {
  return panels.map((panel) => ({
    ...panel,
    center: { ...panel.center },
  }));
}

function cohortIndices(
  source: SolarPanelPlacement[],
  selected: SolarPanelPlacement[]
) {
  return selected.map((panel) => source.indexOf(panel));
}

function assertMatchesFreshSelection(
  panels: SolarPanelPlacement[],
  targetCount = 6,
  selectionDimensions = dimensions
) {
  const freshPanels = clonePanels(panels);
  const expected = select(freshPanels, targetCount, selectionDimensions);
  const actual = select(panels, targetCount, selectionDimensions);
  assert.deepEqual(cohortIndices(panels, actual), cohortIndices(freshPanels, expected));
  assert.deepEqual(snapshot(actual), snapshot(expected));
  return actual;
}

test("cache preserves exact cohort order and returns a fresh result array", () => {
  const panels = buildPanels();
  const first = select(panels);
  const second = select(panels);

  assert.notStrictEqual(first, second);
  assert.deepEqual(first, second);
  first.forEach((panel, index) => assert.strictEqual(panel, second[index]));
});

test("cache invalidates when count, dimensions, or panel identities change", () => {
  const panels = buildPanels();
  select(panels, 6);
  assertMatchesFreshSelection(panels, 5);
  assertMatchesFreshSelection(panels, 6, { ...dimensions, panelWidthMeters: 2.2 });
  assertMatchesFreshSelection(panels, 6, { ...dimensions, panelHeightMeters: 2.4 });

  const initiallySelected = select(panels);
  const replaced = initiallySelected[0];
  const replacementIndex = panels.indexOf(replaced);
  const replacement = { ...replaced, center: { ...replaced.center } };
  panels[replacementIndex] = replacement;
  const afterReplacement = assertMatchesFreshSelection(panels);
  assert.strictEqual(afterReplacement[0], replacement);
});

test("cache detects in-place count and energy mutations without stale output", () => {
  const panels = buildPanels();
  select(panels);
  panels.push({
    ...panels[0],
    center: { lat: 33.451, lng: -111.941 },
    columnIndex: 0,
    rowIndex: 4,
    yearlyEnergyDcKwh: 4_000,
  });
  assertMatchesFreshSelection(panels);

  panels[0].yearlyEnergyDcKwh = 9_000;
  const selected = select(panels);
  assertMatchesFreshSelection(panels);
  assert.equal(
    selected.reduce((sum, panel) => sum + panel.yearlyEnergyDcKwh, 0),
    select([...panels.map((panel) => ({ ...panel, center: { ...panel.center } }))]).reduce(
      (sum, panel) => sum + panel.yearlyEnergyDcKwh,
      0
    )
  );
});

test("cache detects every mutable geometry field read by cohesive selection", () => {
  const mutations: Array<{
    name: string;
    apply: (panel: SolarPanelPlacement) => void;
  }> = [
    { name: "center latitude", apply: (panel) => { panel.center.lat += 0.00012; } },
    { name: "center longitude", apply: (panel) => { panel.center.lng -= 0.00012; } },
    { name: "pitch", apply: (panel) => { panel.pitchDeg += 7; } },
    { name: "azimuth", apply: (panel) => { panel.azimuthDeg = 135; } },
    { name: "orientation", apply: (panel) => { panel.orientation = "LANDSCAPE"; } },
    { name: "segment", apply: (panel) => { panel.segmentIndex = 1; } },
  ];

  for (const mutation of mutations) {
    const panels = buildPanels();
    select(panels);
    mutation.apply(panels[0]);
    const actual = assertMatchesFreshSelection(panels);
    assert.ok(actual.every((panel) => panels.includes(panel)), mutation.name);
  }
});

test("bounded cache retains correctness after more than 32 parameter keys", () => {
  const panels = buildPanels();
  select(panels);
  for (let index = 1; index <= 33; index += 1) {
    select(panels, 6, {
      panelWidthMeters: dimensions.panelWidthMeters + index / 100,
      panelHeightMeters: dimensions.panelHeightMeters,
    });
  }

  assertMatchesFreshSelection(panels);
});

test("caller mutations and cheap empty or all-panel results cannot poison later calls", () => {
  const panels = buildPanels();
  const cachedResult = select(panels);
  cachedResult.splice(0, cachedResult.length);
  assert.equal(select(panels).length, 6);

  const empty = selectCohesiveSolarPanels({ ...dimensions, panels, targetCount: 0 });
  empty.push(panels[0]);
  assert.deepEqual(selectCohesiveSolarPanels({ ...dimensions, panels, targetCount: 0 }), []);

  const all = selectCohesiveSolarPanels({ ...dimensions, panels, targetCount: panels.length });
  all.pop();
  assert.equal(
    selectCohesiveSolarPanels({ ...dimensions, panels, targetCount: panels.length }).length,
    panels.length
  );
});
