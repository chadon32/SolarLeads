import assert from "node:assert/strict";
import test from "node:test";
import { calculateBillAverage } from "../src/lib/bill-average";

test("a full-year total uses 12 months and rounds once, accepting common statement formatting", () => {
  assert.deepEqual(calculateBillAverage({ annualTotal: "  $2,465.99 " }), {
    count: 12, invalid: [], problem: null, monthlyBill: 205,
  });
  assert.equal(calculateBillAverage({ annualTotal: "2466" }).monthlyBill, 206);
});

test("a blank month is omitted but a zero-charge month counts", () => {
  assert.deepEqual(calculateBillAverage({ months: ["200", "  ", "0", "100.50"] }), {
    count: 3, invalid: [], problem: null, monthlyBill: 100,
  });
  assert.equal(calculateBillAverage({ months: [".50", "100.50"] }).monthlyBill, 51);
  assert.equal(calculateBillAverage({ months: ["125.49"] }).problem, "incomplete");
  assert.equal(calculateBillAverage({ months: Array(12).fill("125.50") }).monthlyBill, 126);
});

test("one invalid bill blocks the average, even when other months are valid", () => {
  for (const input of ["12,34", "-5", "1e3", "Infinity", "1.999", "abc", "9".repeat(20)]) {
    const result = calculateBillAverage({ months: ["230", input, "100"] });
    assert.deepEqual(result.invalid, [1]);
    assert.equal(result.monthlyBill, null);
  }
});

test("unusable averages are explained rather than silently clamped", () => {
  assert.equal(calculateBillAverage({ annualTotal: "" }).problem, "incomplete");
  assert.equal(calculateBillAverage({ annualTotal: "0" }).problem, "range");
  assert.equal(calculateBillAverage({ annualTotal: "60,000" }).monthlyBill, 5000);
  assert.equal(calculateBillAverage({ annualTotal: "60,012" }).problem, "range");
  assert.equal(calculateBillAverage({ months: ["6000", "1000"] }).monthlyBill, 3500);
});
