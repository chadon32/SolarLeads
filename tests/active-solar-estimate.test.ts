import assert from "node:assert/strict";
import test from "node:test";
import { buildActiveSolarEstimate } from "../src/lib/active-solar-estimate";
import { calculateFederalResidentialSolarCredit } from "../src/lib/financial-model";
import { buildFallbackRoofAnalysis } from "../src/lib/roof-analysis";
import { calculateEnergyOffsetPct } from "../src/lib/solar-metrics";
import { getPanelById } from "../src/lib/solarPanels";

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
