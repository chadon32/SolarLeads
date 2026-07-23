import assert from "node:assert/strict";
import test from "node:test";
import { buildFallbackRoofAnalysis } from "../src/lib/roof-analysis";
import {
  buildSolarMetrics,
  calculateEnergyOffsetPct,
  getMaxPanelCount,
  getProviderPanelCandidateCount,
  getRecommendedPanelCount,
} from "../src/lib/solar-metrics";
import { getPanelAreaM2, getPanelFit, SOLAR_PANELS } from "../src/lib/solarPanels";

test("buildSolarMetrics caps savings at the homeowner annual bill", () => {
  const analysis = buildMetricFixture();
  const metrics = buildSolarMetrics(analysis, {
    monthlyBill: 100,
    selectedPanelCount: 10,
  });

  assert.equal(metrics.panelCount, 10);
  assert.equal(metrics.systemKw, 4);
  assert.equal(metrics.annualKwh, 8000);
  assert.equal(metrics.annualSavings, 1200);
  assert.equal(metrics.monthlySavings, 100);
  assert.equal(metrics.coveragePct, 100);
  assert.equal(metrics.paybackYears, 9.2);
});

test("recommended panel count targets usage within the preliminary ceiling", () => {
  const analysis = buildMetricFixture({
    acceptedPanelCount: 94,
    panelCount: 94,
    roofSegments: [
      {
        areaM2: 300,
        azimuthDeg: 180,
        bounds: null,
        label: "primary",
        outline: [],
        panelsFit: 94,
        pitchDeg: 18,
        segmentIndex: 0,
        usable: true,
      },
    ],
    solarPanelConfigs: [
      { panelsCount: 18, yearlyEnergyDcKwh: 13_500 },
      { panelsCount: 20, yearlyEnergyDcKwh: 15_000 },
      { panelsCount: 49, yearlyEnergyDcKwh: 37_000 },
      { panelsCount: 94, yearlyEnergyDcKwh: 67_000 },
    ],
    solarPanels: Array.from({ length: 94 }, (_, index) => ({
      azimuthDeg: 180,
      center: { lat: 33.415 + index * 0.000001, lng: -111.831 },
      columnIndex: index,
      orientation: "PORTRAIT" as const,
      pitchDeg: 18,
      rowIndex: 0,
      segmentIndex: 0,
      yearlyEnergyDcKwh: 700,
    })),
  });

  assert.equal(getProviderPanelCandidateCount(analysis), 94);
  assert.equal(getMaxPanelCount(analysis), 94);
  // AZ average usage reaches the 20-panel provider configuration.
  assert.equal(getRecommendedPanelCount(analysis), 20);
  assert.equal(getRecommendedPanelCount(analysis, { monthlyBill: 250 }), 49);

  const metrics = buildSolarMetrics(analysis, { monthlyBill: null });
  assert.equal(metrics.panelCount, 20);
  assert.equal(metrics.maxPanelCount, 94);
});

test("preliminary ceiling includes garage planes without perfect roof packing", () => {
  const segmentSpecs = [
    {
      label: "primary",
      segmentIndex: 2,
      areaM2: 54.6,
      panelsFit: 22,
      ne: [33.2503397, -111.5883992],
      sw: [33.250242, -111.5884621],
    },
    {
      label: "secondary",
      segmentIndex: 3,
      areaM2: 50.7,
      panelsFit: 20,
      ne: [33.2503394, -111.5884615],
      sw: [33.2502417, -111.5885265],
    },
    {
      label: "garage",
      segmentIndex: 0,
      areaM2: 59.7,
      panelsFit: 19,
      ne: [33.2502134, -111.5883985],
      sw: [33.2501379, -111.5885332],
    },
    {
      label: "plane 4",
      segmentIndex: 1,
      areaM2: 56.6,
      panelsFit: 19,
      ne: [33.2502766, -111.588399],
      sw: [33.2502128, -111.5885336],
    },
    {
      label: "plane 5",
      segmentIndex: 4,
      areaM2: 49.4,
      panelsFit: 19,
      ne: [33.2502957, -111.5885382],
      sw: [33.2501603, -111.5885745],
    },
    {
      label: "plane 6",
      segmentIndex: 5,
      areaM2: 25.2,
      panelsFit: 7,
      ne: [33.2503004, -111.5885095],
      sw: [33.2502037, -111.5885424],
    },
    {
      label: "plane 7",
      segmentIndex: 6,
      areaM2: 11.9,
      panelsFit: 3,
      ne: [33.2502039, -111.5885114],
      sw: [33.2501604, -111.5885439],
    },
    {
      label: "plane 8",
      segmentIndex: 8,
      areaM2: 9.8,
      panelsFit: 3,
      ne: [33.2501679, -111.5884876],
      sw: [33.250138, -111.5885222],
    },
    {
      label: "plane 9",
      segmentIndex: 7,
      areaM2: 10.3,
      panelsFit: 2,
      ne: [33.2501699, -111.58845],
      sw: [33.2501381, -111.5884878],
    },
    {
      label: "plane 10",
      segmentIndex: 11,
      areaM2: 7,
      panelsFit: 2,
      ne: [33.2501521, -111.5884016],
      sw: [33.2501204, -111.5884201],
    },
  ] as const;
  const solarPanels = segmentSpecs.flatMap((segment) =>
    Array.from({ length: segment.panelsFit }, (_, index) => ({
      azimuthDeg: 180,
      center: {
        lat: segment.sw[0] + index * 0.0000001,
        lng: segment.sw[1],
      },
      columnIndex: index,
      orientation: "PORTRAIT" as const,
      pitchDeg: 18,
      rowIndex: 0,
      segmentIndex: segment.segmentIndex,
      yearlyEnergyDcKwh: 800,
    }))
  );
  const analysis = buildMetricFixture({
    acceptedPanelCount: 116,
    grossRoofAreaM2: 349.3,
    originalPanelCandidateCount: 116,
    panelCount: 18,
    panelHeightMeters: 1.88,
    panelWidthMeters: 1.05,
    roofSegments: segmentSpecs.map((segment) => ({
      areaM2: segment.areaM2,
      azimuthDeg: 180,
      bounds: {
        northeast: { lat: segment.ne[0], lng: segment.ne[1] },
        southwest: { lat: segment.sw[0], lng: segment.sw[1] },
      },
      label: segment.label,
      outline: [],
      panelsFit: segment.panelsFit,
      pitchDeg: 18,
      segmentIndex: segment.segmentIndex,
      usable: true,
    })),
    solarPanels,
    usableRoofAreaM2: 227.8,
  });

  assert.equal(getProviderPanelCandidateCount(analysis), 116);
  assert.equal(getMaxPanelCount(analysis), 70);

  const metrics = buildSolarMetrics(analysis, { monthlyBill: 200 });
  assert.equal(metrics.maxPanelCount, 70);
  assert.equal(metrics.originalCandidateCount, 116);
  assert.equal(metrics.rejectedCandidateCount, 46);
});

test("energy offset handles zero, negative, and capped high-production cases", () => {
  assert.equal(calculateEnergyOffsetPct(8000, 0), 0);
  assert.equal(calculateEnergyOffsetPct(8000, -50), 0);
  assert.equal(calculateEnergyOffsetPct(-1, 100), 0);
  assert.equal(calculateEnergyOffsetPct(8000, 50), 100);
});

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

test("panel fit uses the shared preliminary ceiling when placements exist", () => {
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

  // Packing is already included in the shared ceiling, so it is not applied twice.
  assert.equal(fit.maxPanelsFit, 10);
});

test("solar metrics and panel fit do not round fractional panel requests upward", () => {
  const analysis = buildMetricFixture();
  const metrics = buildSolarMetrics(analysis, {
    monthlyBill: 250,
    selectedPanelCount: 6.9,
  });
  const panel = SOLAR_PANELS[0];
  const fit = getPanelFit(panel, {
    maxSunshineHoursPerYear: 1800,
    monthlyBill: 250,
    selectedPanelCount: 6.9,
    usableAreaM2: getPanelAreaM2(panel) * 10,
  });

  assert.equal(metrics.panelCount, 6);
  assert.equal(fit.maxPanelsFit, 6);
});

function buildMetricFixture(overrides: Record<string, unknown> = {}) {
  const analysis = buildFallbackRoofAnalysis({
    address: "6420 E Nance St, Mesa, AZ 85215",
    lat: 33.415,
    lng: -111.831,
  });

  return {
    ...analysis,
    acceptedPanelCount: 10,
    annualKwh: 8000,
    panelCount: 10,
    solarPanelConfigs: [{ panelsCount: 10, yearlyEnergyDcKwh: 8000 }],
    solarPanels: Array.from({ length: 10 }, (_, index) => ({
      azimuthDeg: 180,
      center: { lat: 33.415 + index * 0.000001, lng: -111.831 },
      columnIndex: index,
      orientation: "PORTRAIT" as const,
      pitchDeg: 18,
      rowIndex: 0,
      segmentIndex: 0,
      yearlyEnergyDcKwh: 800,
    })),
    ...overrides,
  };
}
