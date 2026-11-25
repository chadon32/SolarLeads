import assert from "node:assert/strict";
import test from "node:test";
import { annualEnergyMatch, annualMatchLabel, readAnnualUsage } from "../src/lib/annual-usage-match";

test("annual utility use accepts whole kWh with optional grouping, not bills or invalid values", () => {
  assert.deepEqual(readAnnualUsage("  "), { kind: "empty" });
  for (const [raw, kwh] of [["1", 1], [" 12,345 ", 12345], ["12000", 12000], ["1,000,000", 1000000]] as const) {
    assert.deepEqual(readAnnualUsage(raw), { kind: "valid", kwh });
  }
  for (const raw of ["0", "1,000,001", "$12,000", "12,00", "1e4", "12.5", "-1", "10000 kWh", "9".repeat(200)]) {
    assert.deepEqual(readAnnualUsage(raw), { kind: "invalid" });
  }
});

test("first-year supply applies the US AC output factor once and retains surplus above 100 percent", () => {
  assert.deepEqual(annualEnergyMatch(12000, 12000), { acKwh: 10200, gapKwh: -1800, percent: 85 });
  assert.deepEqual(annualEnergyMatch(20000, 17000), { acKwh: 17000, gapKwh: 0, percent: 100 });
  assert.deepEqual(annualEnergyMatch(20000, 10000), { acKwh: 17000, gapKwh: 7000, percent: 170 });
  assert.equal(annualEnergyMatch(13600, 12000)?.acKwh, 11560);
});

test("no result for missing production or unusable usage; rounding cannot falsely imply an annual match", () => {
  for (const value of [NaN, -1, Infinity, 0, Number.MAX_VALUE]) assert.equal(annualEnergyMatch(value, 12000), null);
  for (const value of [NaN, -1, Infinity, 0, 0.5, 1000001]) assert.equal(annualEnergyMatch(12000, value), null);
  assert.equal(annualMatchLabel(0.02), "Under 1%");
  assert.equal(annualMatchLabel(99.99), "Just under 100%");
  assert.equal(annualMatchLabel(100.01), "Just over 100%");
  assert.equal(annualMatchLabel(100), "100%");
  assert.equal(annualMatchLabel(129.9), "130%");
});
