import assert from "node:assert/strict";
import test from "node:test";
import { TEST_ADDRESS, TEST_ROOF_ANALYSIS } from "./fixtures/test-data";
import type { RoofAnalysis } from "../src/lib/roof-analysis";
import { buildActiveSolarEstimate } from "../src/lib/active-solar-estimate";
import { buildSolarReportSnapshot, normalizeSolarReportSnapshot, rebuildTrustedSolarReportSnapshot } from "../src/lib/report-snapshot";
import { SOLAR_PANELS, getPanelById, getPanelDimensionsMeters, getPanelFit } from "../src/lib/solarPanels";
import { selectCohesiveSolarPanels } from "../src/lib/panel-layout";
import { getSelectedPanelEnergy } from "../src/lib/selected-panel-energy";
import { deriveLeadSubmissionNumbers } from "../src/lib/lead-submission";
import { calculateTwentyYearSolarCosts } from "../src/lib/financial-model";
import { initialReportDeliveryStatus } from "../src/lib/follow-up-state";
import { isEstimateDocument, sanitizeEstimateShareUrl } from "../mobile/src/estimate-navigation";

const roof = TEST_ROOF_ANALYSIS as RoofAnalysis;

test("live, trusted, serialized and persisted numbers agree for every catalog module", () => {
  for (const selectedPanel of SOLAR_PANELS) {
    for (const count of [1, 10, 15, 19, 999]) {
      const active = buildActiveSolarEstimate({ analysis: roof, selectedPanel, selectedPanelCount: count, monthlyBill: 200 });
      const snapshot = buildSolarReportSnapshot({ address: TEST_ADDRESS, analysis: roof, activePanelCount: count, monthlyBill: 200 });
      // The public route treats all client counts and metrics as untrusted.
      const trusted = rebuildTrustedSolarReportSnapshot({ ...snapshot, panelCount: count }, {
        selectedPanel, panelWatts: selectedPanel.watts, installedCostPerWatt: selectedPanel.installedCostPerWatt, monthlyBill: 200,
      });
      const saved = normalizeSolarReportSnapshot(JSON.parse(JSON.stringify(trusted)))!;
      const persisted = deriveLeadSubmissionNumbers({ monthlyBill: 200, selectedPanelWatts: selectedPanel.watts, installedCostPerWatt: selectedPanel.installedCostPerWatt }, saved);
      assert.equal(saved.metrics.panelCount, active.panelCount, selectedPanel.id);
      assert.equal(saved.metrics.annualKwh, active.annualKwh, selectedPanel.id);
      assert.equal(saved.metrics.annualSavings, active.annualSavings, selectedPanel.id);
      assert.equal(saved.metrics.paybackYears, active.paybackYears, selectedPanel.id);
      assert.equal(persisted.annualEnergyKwh, active.annualKwh, selectedPanel.id);
      assert.equal(persisted.systemCostBeforeIncentives, active.installedCost, selectedPanel.id);
    }
  }
});

test("a ten-panel report does not borrow the twenty-panel configuration energy", () => {
  const snapshot = rebuildTrustedSolarReportSnapshot(buildSolarReportSnapshot({
    address: TEST_ADDRESS, analysis: roof, activePanelCount: 10, monthlyBill: 200,
  }), { monthlyBill: 200, panelWatts: 400 });
  assert.equal(snapshot.metrics.annualKwh, 6800);
  assert.equal(snapshot.metrics.annualSavings, 1054);
});

test("intermediate panel counts grow production instead of plateauing at sparse configs", () => {
  const sparse = { ...roof, solarPanelConfigs: [{ panelsCount: 10, yearlyEnergyDcKwh: 6800 }, { panelsCount: 20, yearlyEnergyDcKwh: 13600 }] };
  for (const count of [10, 11, 15, 19]) {
    assert.equal(getPanelFit(getPanelById(), { roofData: sparse, selectedPanelCount: count }).annualKwh, count * 680);
    assert.equal(getSelectedPanelEnergy({ ...sparse, solarPanels: [] }, count), count * 680);
  }
  for (const count of [0, 5, 20, 25]) {
    assert.equal(getSelectedPanelEnergy({ ...sparse, solarPanels: [] }, count), count * 680);
  }
});

test("3D cohort and selected module production agree on a mixed-plane roof", () => {
  const mixed = { ...roof, solarPanels: roof.solarPanels.map((panel, index) => ({
    ...panel, segmentIndex: index < 2 ? index + 1 : 0, yearlyEnergyDcKwh: index < 2 ? 1000 : 900,
  })) };
  const panel = getPanelById();
  const dimensions = getPanelDimensionsMeters(panel);
  const displayed = selectCohesiveSolarPanels({ panels: mixed.solarPanels, targetCount: 10, panelWidthMeters: dimensions.widthMeters, panelHeightMeters: dimensions.heightMeters });
  assert.equal(getPanelFit(panel, { roofData: mixed, selectedPanelCount: 10 }).annualKwh,
    Math.round(displayed.reduce((sum, item) => sum + item.yearlyEnergyDcKwh, 0) * panel.watts / roof.panelCapacityWatts));
});

test("zero-output panels do not silently turn into positive fallback production", () => {
  const dark = { ...roof, solarPanels: roof.solarPanels.map((panel) => ({ ...panel, yearlyEnergyDcKwh: 0 })) };
  assert.equal(getPanelFit(getPanelById(), { roofData: dark, selectedPanelCount: 10 }).annualKwh, 0);
});

test("a losing system retains its negative net benefit", () => {
  const costs = calculateTwentyYearSolarCosts({ annualSavings: 1000, monthlyBill: 100, totalSolarPayments: 30000 });
  assert.equal(costs.totalSavings, -10000);
  const lead = deriveLeadSubmissionNumbers({ monthlyBill: 100, twentyYearSavings: -10000 }, null);
  assert.equal(lead.twentyYearSavings, -10000);
});

test("initial follow-up requires affirmative email acceptance evidence", () => {
  assert.equal(initialReportDeliveryStatus(null), "needs_review");
  assert.equal(initialReportDeliveryStatus("not a date"), "needs_review");
  assert.equal(initialReportDeliveryStatus("2026-09-04T12:00:00Z"), "sent");
});

test("native sharing preserves public settings but strips credentials and app-only flags", () => {
  const base = "https://solartelligence.com";
  const result = sanitizeEstimateShareUrl("/estimate?address=Test&bill=325&panel=qcells&panels=12&inverter=string&addBattery=1&battery=powerwall&app=ios&token=secret&email=private", base)!;
  const url = new URL(result);
  assert.equal(url.searchParams.get("bill"), "325");
  assert.equal(url.searchParams.get("panels"), "12");
  assert.equal(url.searchParams.get("battery"), "powerwall");
  for (const key of ["app", "token", "email"]) assert.equal(url.searchParams.has(key), false);
  for (const unsafe of ["https://evil.example/estimate?address=x", "/report/private?token=secret", "/estimate"]) {
    assert.equal(sanitizeEstimateShareUrl(unsafe, base), null);
  }
});

test("ordinary native documents do not wait for an analysis completion message", () => {
  assert.equal(isEstimateDocument("https://solartelligence.com/estimate?address=x"), true);
  assert.equal(isEstimateDocument("https://solartelligence.com/thank-you"), false);
  assert.equal(isEstimateDocument("https://solartelligence.com/report/test"), false);
});
