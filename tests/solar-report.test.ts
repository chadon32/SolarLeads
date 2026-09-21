import assert from "node:assert/strict";
import test from "node:test";
import { buildSolarReportFromSolarValues } from "../src/lib/solar-report";

test("solar report environmental impact uses the supplied roof-analysis factor", () => {
  const report = buildSolarReportFromSolarValues({
    annualKwh: 10_000,
    annualSavings: 1_300,
    carbonOffsetFactorKgPerMwh: 500,
    monthlyBill: 200,
    panelCount: 20,
    systemKw: 8,
  });

  assert.equal(report.annualImpactLbs, 11_025);
});

test("solar report environmental impact retains the documented default factor", () => {
  const report = buildSolarReportFromSolarValues({
    annualKwh: 10_000,
    annualSavings: 1_300,
    monthlyBill: 200,
    panelCount: 20,
    systemKw: 8,
  });

  assert.equal(report.annualImpactLbs, 8600);
});
