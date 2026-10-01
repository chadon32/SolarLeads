import assert from "node:assert/strict";
import test from "node:test";
import { buildActiveSolarEstimate, getActiveEstimateMetrics } from "../src/lib/active-solar-estimate";
import { calculateFederalResidentialSolarCredit } from "../src/lib/financial-model";
import { buildFallbackRoofAnalysis } from "../src/lib/roof-analysis";
import { calculateEnergyOffsetPct } from "../src/lib/solar-metrics";
import { getPanelById } from "../src/lib/solarPanels";
import { buildSolarReportSnapshot } from "../src/lib/report-snapshot";
import {
  buildSolarAdvisorInputFromAnalysis,
  buildSolarAdvisorProfile,
  calculateSolarReadinessScore,
} from "../src/lib/solar-advisor";

function buildEstimateFixture() {
  const analysis = buildFallbackRoofAnalysis({
    address: "6420 E Nance St, Mesa, AZ 85215",
    lat: 33.415,
    lng: -111.831,
  });

  return {
    ...analysis,
    acceptedPanelCount: 10,
    annualKwh: 8_000,
    panelCount: 10,
    solarPanelConfigs: [{ panelsCount: 10, yearlyEnergyDcKwh: 8_000 }],
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
  };
}

test("active estimate keeps the selected panel count and all money values aligned", () => {
  const estimate = buildActiveSolarEstimate({
    analysis: buildEstimateFixture(),
    inverterCostAdderPerWatt: 0.25,
    monthlyBill: 250,
    selectedPanel: getPanelById("qcells-q-peak-duo"),
    selectedPanelCount: 8,
  });

  assert.equal(estimate.panelCount, 8);
  assert.equal(estimate.systemKw, 3.2);
  assert.equal(estimate.monthlySavings, Math.round(estimate.annualSavings / 12));
  assert.equal(estimate.netCostAfterCredit, estimate.installedCost - estimate.taxCredit);
  assert.equal(
    estimate.paybackYears,
    Number((estimate.netCostAfterCredit / estimate.annualSavings).toFixed(1))
  );
  assert.equal(
    estimate.energyOffsetPct,
    calculateEnergyOffsetPct(estimate.annualKwh, 250)
  );
});

test("active estimate applies equipment cost once and clamps impossible panel counts", () => {
  const withoutBattery = buildActiveSolarEstimate({
    analysis: buildEstimateFixture(),
    monthlyBill: 250,
    selectedPanel: getPanelById(),
    selectedPanelCount: 999,
  });
  const withBattery = buildActiveSolarEstimate({
    analysis: buildEstimateFixture(),
    batteryCost: 11_500,
    monthlyBill: 250,
    selectedPanel: getPanelById(),
    selectedPanelCount: 999,
  });

  assert.equal(withoutBattery.panelCount, withoutBattery.maxPanelCount);
  assert.equal(withBattery.panelCount, withBattery.maxPanelCount);
  assert.equal(withBattery.installedCost - withoutBattery.installedCost, 11_500);
  assert.equal(
    withBattery.taxCredit,
    calculateFederalResidentialSolarCredit(withBattery.installedCost)
  );
  assert.equal(
    withoutBattery.taxCredit,
    calculateFederalResidentialSolarCredit(withoutBattery.installedCost)
  );
  assert.ok(withBattery.paybackYears > withoutBattery.paybackYears);
});

test("the header, dashboard and saved report read one readiness score for a layout", () => {
  const analysis = { ...buildEstimateFixture(), rooftopConfidenceScore: 100 };
  for (const [selectedPanelCount, monthlyBill] of [[4, 250], [10, 120], [7, 400]]) {
    const estimate = buildActiveSolarEstimate({
      analysis,
      monthlyBill,
      selectedPanel: getPanelById("rec-alpha-pure-rx"),
      selectedPanelCount,
    });
    const metrics = getActiveEstimateMetrics(estimate);
    assert.equal(metrics.panelCount, estimate.panelCount);
    assert.equal(metrics.coveragePct, estimate.energyOffsetPct);
    assert.equal(metrics.systemKw, estimate.systemKw);
    assert.equal(metrics.annualSavings, estimate.annualSavings);

    const header = calculateSolarReadinessScore(metrics);
    const dashboard = buildSolarAdvisorProfile(
      buildSolarAdvisorInputFromAnalysis(analysis, metrics, monthlyBill)
    ).suitability.score;
    const saved = buildSolarReportSnapshot({
      activePanelCount: selectedPanelCount,
      address: "6420 E Nance St, Mesa, AZ 85215",
      analysis,
      metrics,
      monthlyBill,
    }).solarReadinessScore;

    assert.equal(dashboard, header);
    assert.equal(saved, header);
    assert.notEqual(header, analysis.rooftopConfidenceScore, "readiness is not roof-model confidence");
  }
});
