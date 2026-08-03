import assert from "node:assert/strict";
import test from "node:test";
import { deriveLeadSubmissionNumbers } from "../src/lib/lead-submission";
import type { SolarReportSnapshot } from "../src/lib/report-snapshot";

test("lead submission numbers prefer canonical report snapshot metrics over browser-submitted metrics", () => {
  const numbers = deriveLeadSubmissionNumbers(
    {
      annualEnergyKwh: 50_000,
      annualSavings: 99_999,
      batteryAdded: true,
      batteryCost: 10_000,
      federalTaxCredit: 1,
      monthlyBill: 250,
      monthlySavings: 999,
      netSystemCost: 1,
      panelCount: 99,
      selectedPanelWatts: 400,
      systemCostBeforeIncentives: 999_999,
      systemSizeKw: 99,
      twentyYearSavings: 999_999,
    },
    {
      metrics: {
        annualKwh: 9600,
        annualSavings: 1248,
        avgPitchDeg: 22,
        coveragePct: 42,
        grossRoofAreaM2: 120,
        monthlySavings: 104,
        panelCount: 8,
        paybackYears: 9,
        systemKw: 3.2,
        usablePctRoof: 70,
        usableRoofAreaM2: 84,
      },
      monthlyBill: 200,
      panelCount: 8,
    } as SolarReportSnapshot
  );

  assert.equal(numbers.monthlyBill, 250);
  assert.equal(numbers.panelCount, 8);
  assert.equal(numbers.systemSizeKw, 3.2);
  assert.equal(numbers.annualEnergyKwh, 9600);
  assert.equal(numbers.annualSavings, 1248);
  assert.equal(numbers.monthlySavings, 104);
  assert.equal(numbers.energyOffsetPct, 42);
  assert.equal(numbers.systemCostBeforeIncentives, 17_360);
  assert.equal(numbers.federalTaxCredit, 0);
  assert.equal(numbers.netSystemCost, 17_360);
  // Net 20-year savings includes utility escalation and subtracts the modeled
  // net solar-system cost rather than presenting avoided utility spend as profit.
  assert.equal(numbers.twentyYearSavings, 7600);
  assert.equal(numbers.roiYears, 13.9);
});

test("lead submission numbers ignore battery cost unless battery was selected", () => {
  const numbers = deriveLeadSubmissionNumbers(
    {
      annualSavings: 1200,
      batteryAdded: false,
      batteryCost: 20_000,
      monthlyBill: 200,
      panelCount: 10,
      selectedPanelWatts: 400,
    },
    null
  );

  assert.equal(numbers.systemCostBeforeIncentives, 9200);
  assert.equal(numbers.federalTaxCredit, 0);
  assert.equal(numbers.netSystemCost, 9200);
});

test("lead submission numbers floor fractional panel counts instead of rounding up", () => {
  const numbers = deriveLeadSubmissionNumbers(
    {
      annualSavings: 1000,
      monthlyBill: 200,
      panelCount: 3.9,
      selectedPanelWatts: 400,
    },
    null
  );

  assert.equal(numbers.panelCount, 3);
  assert.equal(numbers.systemSizeKw, 1.2);
});

test("lead submission numbers clamp energy offset percentages to 100", () => {
  const numbers = deriveLeadSubmissionNumbers(
    {
      annualEnergyKwh: 9000,
      annualSavings: 1000,
      energyOffsetPct: 999,
      monthlyBill: 200,
      panelCount: 8,
    },
    null
  );

  assert.equal(numbers.energyOffsetPct, 100);
});

test("lead submission numbers reject invalid or negative browser values", () => {
  const numbers = deriveLeadSubmissionNumbers(
    {
      annualSavings: -100,
      monthlyBill: -1,
      panelCount: 0,
      systemSizeKw: Number.NaN,
    },
    null
  );

  assert.equal(Number.isNaN(numbers.monthlyBill), true);
  assert.equal(numbers.panelCount, null);
  assert.equal(numbers.annualSavings, null);
  assert.equal(numbers.systemSizeKw, null);
  assert.equal(numbers.roiYears, null);
});
