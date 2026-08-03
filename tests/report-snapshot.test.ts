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

test("accepted report analysis preserves the selected module footprint", () => {
  const analysis = buildAnalysisFixture();
  const accepted = buildAcceptedPanelAnalysisForReport(analysis, {
    heightMeters: 1.73,
    widthMeters: 1.118,
  });

  assert.equal(accepted.panelHeightMeters, 1.73);
  assert.equal(accepted.panelWidthMeters, 1.118);
});
