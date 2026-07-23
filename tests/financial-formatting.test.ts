import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateArizonaStateSolarCredit,
  calculateFederalResidentialSolarCredit,
  calculateTwentyYearSolarCosts,
  calculateTwentyYearUtilityCost,
  getFederalResidentialSolarCreditRate,
} from "../src/lib/financial-model";
import { formatCurrency, formatPercent } from "../src/lib/number-format";

test("Arizona state credit is 25% of system cost capped at $1,000", () => {
  assert.equal(calculateArizonaStateSolarCredit(0), 0);
  assert.equal(calculateArizonaStateSolarCredit(-100), 0);
  assert.equal(calculateArizonaStateSolarCredit(2000), 500);
  assert.equal(calculateArizonaStateSolarCredit(10_000), 1000);
});

test("federal residential solar credit ends for new expenditures after 2025", () => {
  assert.equal(getFederalResidentialSolarCreditRate(2025), 0.3);
  assert.equal(calculateFederalResidentialSolarCredit(20_000, 2025), 6000);
  assert.equal(getFederalResidentialSolarCreditRate(2026), 0);
  assert.equal(calculateFederalResidentialSolarCredit(20_000, 2026), 0);
});

test("20-year solar cost totals combine remaining utility cost and solar payments", () => {
  const totalCostWithoutSolar = calculateTwentyYearUtilityCost(200, 0.03);
  const costs = calculateTwentyYearSolarCosts({
    annualSavings: 1800,
    monthlyBill: 200,
    totalSolarPayments: 18_000,
    utilityEscalationRate: 0.03,
  });

  assert.equal(costs.totalCostWithoutSolar, totalCostWithoutSolar);
  assert.equal(costs.remainingUtilityCost, Math.max(totalCostWithoutSolar - 36_000, 0));
  assert.equal(costs.totalCostWithSolar, costs.remainingUtilityCost + 18_000);
  assert.equal(costs.totalSavings, totalCostWithoutSolar - costs.totalCostWithSolar);
});

test("shared number formatters avoid NaN output for invalid values", () => {
  assert.equal(formatCurrency(1400), "$1,400");
  assert.equal(formatCurrency(Number.NaN), "$0");
  assert.equal(formatPercent(84.4), "84%");
  assert.equal(formatPercent(Number.POSITIVE_INFINITY), "0%");
});
