import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAcceptedPanelAnalysisForReport,
  buildSolarReportSnapshot,
  normalizeSolarReportSnapshot,
  rebuildTrustedSolarReportSnapshot,
} from "../src/lib/report-snapshot";
import { buildFallbackRoofAnalysis, type RoofAnalysis } from "../src/lib/roof-analysis";
import { TEST_ADDRESS, TEST_ROOF_ANALYSIS } from "./fixtures/test-data";
import { getPanelDimensionsMeters, SOLAR_PANELS } from "../src/lib/solarPanels";

function buildPanel(overrides: Record<string, unknown> = {}) {
  return {
    azimuthDeg: 180,
    center: { lat: 33.41, lng: -111.83 },
    columnIndex: 0,
    orientation: "PORTRAIT" as const,
    pitchDeg: 18,
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

function buildSnapshotFixture({
  activePanelCount = 10,
  monthlyBill = 200,
}: {
  activePanelCount?: number | null;
  monthlyBill?: number | null;
} = {}) {
  return buildSolarReportSnapshot({
    activePanelCount,
    address: TEST_ADDRESS,
    analysis: structuredClone(TEST_ROOF_ANALYSIS) as RoofAnalysis,
    monthlyBill,
  });
}

test("accepted panels keep Google Solar API array order", () => {
  const analysis = buildAnalysisFixture();
  const accepted = buildAcceptedPanelAnalysisForReport(analysis);

  // First N panels of the API array — NOT re-sorted by segment size.
  assert.equal(accepted.solarPanels.length, 2);
  assert.deepEqual(accepted.solarPanels[0].center, { lat: 33.41, lng: -111.83 });
  assert.deepEqual(accepted.solarPanels[1].center, { lat: 33.42, lng: -111.84 });
});

test("accepted analysis uses actual selected-panel energy and per-segment counts", () => {
  const analysis = buildAnalysisFixture();
  const accepted = buildAcceptedPanelAnalysisForReport(analysis);

  assert.equal(accepted.panelCount, 2);
  assert.equal(accepted.annualKwh, 1700);
  assert.equal(accepted.roofSegments[2].panelsFit, 2);
  assert.equal(accepted.roofSegments[0].panelsFit, 0);
});

test("accepted report analysis preserves the selected module footprint", () => {
  const analysis = buildAnalysisFixture();
  const accepted = buildAcceptedPanelAnalysisForReport(analysis, {
    heightMeters: 1.73,
    widthMeters: 1.118,
  });

  assert.equal(accepted.panelHeightMeters, 1.73);
  assert.equal(accepted.panelWidthMeters, 1.118);
});

test("saved snapshots preserve missing bills separately from a zero bill", () => {
  const missing = buildSnapshotFixture({ monthlyBill: null });
  const zero = buildSnapshotFixture({ monthlyBill: 0 });

  assert.equal(missing.monthlyBill, null);
  assert.equal(zero.monthlyBill, 0);
  assert.equal(
    normalizeSolarReportSnapshot(JSON.parse(JSON.stringify(missing)))?.monthlyBill,
    null
  );
  assert.equal(
    normalizeSolarReportSnapshot(JSON.parse(JSON.stringify(zero)))?.monthlyBill,
    0
  );
  assert.equal(
    rebuildTrustedSolarReportSnapshot(missing, { monthlyBill: null }).monthlyBill,
    null
  );
  assert.equal(
    rebuildTrustedSolarReportSnapshot(missing, { monthlyBill: 0 }).monthlyBill,
    0
  );
});

test("readiness uses selected-system metrics while roof-model confidence stays separate", () => {
  const snapshot = buildSnapshotFixture({ activePanelCount: 2, monthlyBill: 200 });
  const legacy = structuredClone(snapshot);
  legacy.solarReadinessScore = 100;

  const normalized = normalizeSolarReportSnapshot(legacy);

  assert.ok(normalized);
  assert.equal(normalized.roofModelConfidence, snapshot.roofModelConfidence);
  assert.ok(snapshot.solarReadinessScore < 100);
  assert.equal(normalized.solarReadinessScore, snapshot.solarReadinessScore);
});

test("changed equipment keeps the selected count and metrics aligned", () => {
  const snapshot = buildSnapshotFixture();
  const selectedPanel = SOLAR_PANELS.find((panel) => panel.id === "panasonic-evervolt")!;
  const rebuilt = rebuildTrustedSolarReportSnapshot(snapshot, {
    installedCostPerWatt: selectedPanel.installedCostPerWatt,
    monthlyBill: 200,
    panelWatts: selectedPanel.watts,
    selectedPanel,
  });
  const dimensions = getPanelDimensionsMeters(selectedPanel);

  assert.equal(rebuilt.panelCount, 10);
  assert.equal(rebuilt.metrics.panelCount, 10);
  assert.equal(rebuilt.metrics.annualKwh, 6_970);
  assert.equal(rebuilt.metrics.systemKw, 4.1);
  assert.equal(rebuilt.renderedPanelCount, 10);
  assert.equal(rebuilt.roofAnalysis.panelWidthMeters, dimensions.widthMeters);
  assert.equal(rebuilt.roofAnalysis.panelHeightMeters, dimensions.heightMeters);
});

test("normalization derives missing metrics from the persisted roof model", () => {
  const snapshot = buildSnapshotFixture();
  const missingMetrics = structuredClone(snapshot) as Record<string, unknown>;
  missingMetrics.metrics = {};

  const normalized = normalizeSolarReportSnapshot(missingMetrics);

  assert.ok(normalized);
  assert.equal(normalized.panelCount, 10);
  assert.equal(normalized.metrics.panelCount, 10);
  assert.equal(normalized.metrics.annualKwh, 6_800);
  assert.equal(normalized.metrics.annualSavings, snapshot.metrics.annualSavings);
  assert.equal(normalized.metrics.monthlySavings, snapshot.metrics.monthlySavings);
  assert.equal(normalized.metrics.systemKw, 4);

  const malformedMetrics = structuredClone(snapshot) as Record<string, unknown>;
  const malformedMetricValues = malformedMetrics.metrics as Record<string, unknown>;
  malformedMetricValues.annualKwh = "not-a-number";
  malformedMetricValues.annualSavings = null;
  malformedMetricValues.monthlySavings = -1;
  malformedMetricValues.systemKw = "not-a-number";

  const normalizedMalformed = normalizeSolarReportSnapshot(malformedMetrics);

  assert.ok(normalizedMalformed);
  assert.equal(normalizedMalformed.metrics.annualKwh, 6_800);
  assert.equal(normalizedMalformed.metrics.annualSavings, snapshot.metrics.annualSavings);
  assert.equal(normalizedMalformed.metrics.monthlySavings, snapshot.metrics.monthlySavings);
  assert.equal(normalizedMalformed.metrics.systemKw, 4);
});

test("normalization clamps out-of-bounds duplicated panel counts", () => {
  const snapshot = buildSnapshotFixture();
  const tampered = structuredClone(snapshot) as Record<string, unknown>;
  const tamperedMetrics = tampered.metrics as Record<string, unknown>;
  tampered.panelCount = 999;
  tampered.renderedPanelCount = 999;
  tamperedMetrics.panelCount = 999;
  tamperedMetrics.annualKwh = 999_999;

  const normalized = normalizeSolarReportSnapshot(tampered);

  assert.ok(normalized);
  assert.equal(normalized.panelCount, 20);
  assert.equal(normalized.metrics.panelCount, 20);
  assert.equal(normalized.renderedPanelCount, 20);
  assert.equal(normalized.metrics.annualKwh, 13_600);
});

test("normalization preserves an explicit zero panel count", () => {
  const snapshot = buildSnapshotFixture();
  const zeroCount = structuredClone(snapshot) as Record<string, unknown>;
  const zeroMetrics = zeroCount.metrics as Record<string, unknown>;
  zeroCount.panelCount = 0;
  zeroCount.renderedPanelCount = 0;
  zeroMetrics.panelCount = 0;

  const normalized = normalizeSolarReportSnapshot(zeroCount);

  assert.ok(normalized);
  assert.equal(normalized.panelCount, 0);
  assert.equal(normalized.metrics.panelCount, 0);
  assert.equal(normalized.renderedPanelCount, 0);
  assert.equal(normalized.metrics.annualKwh, 0);
  assert.equal(normalized.metrics.annualSavings, 0);
  assert.equal(normalized.metrics.systemKw, 0);
});

test("Solar API rendered count ignores a stale accepted count when positions exist", () => {
  const analysis = structuredClone(TEST_ROOF_ANALYSIS) as RoofAnalysis;
  analysis.acceptedPanelCount = 999;

  const built = buildSolarReportSnapshot({
    activePanelCount: 20,
    address: TEST_ADDRESS,
    analysis,
    monthlyBill: 200,
  });
  const normalized = normalizeSolarReportSnapshot({
    ...built,
    renderedPanelCount: 999,
  });

  assert.equal(built.renderedPanelCount, analysis.solarPanels.length);
  assert.ok(normalized);
  assert.equal(normalized.renderedPanelCount, analysis.solarPanels.length);
});

test("normalization rejects snapshots without persisted roof geometry", () => {
  const snapshot = buildSnapshotFixture();

  assert.equal(
    normalizeSolarReportSnapshot({ ...snapshot, roofAnalysis: undefined }),
    null
  );
  assert.equal(
    normalizeSolarReportSnapshot({
      ...snapshot,
      roofAnalysis: { validSite: true },
    }),
    null
  );

  const invalidOutline = structuredClone(snapshot) as Record<string, unknown>;
  const invalidRoofAnalysis = invalidOutline.roofAnalysis as Record<string, unknown>;
  invalidRoofAnalysis.roofOutline = [];
  assert.equal(normalizeSolarReportSnapshot(invalidOutline), null);
});

test("an empty Solar API placement array cannot claim rendered panels", () => {
  const snapshot = buildSnapshotFixture();
  snapshot.roofAnalysis.solarPanels = [];
  snapshot.roofAnalysis.acceptedPanelCount = 20;
  snapshot.renderedPanelCount = 20;

  const normalized = normalizeSolarReportSnapshot(snapshot);
  assert.ok(normalized);
  assert.equal(normalized.renderedPanelCount, 0);
});
