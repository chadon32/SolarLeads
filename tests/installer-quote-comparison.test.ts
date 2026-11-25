import assert from "node:assert/strict";
import test from "node:test";
import { buildInstallerMeetingBrief, compareInstallerQuote } from "../src/lib/installer-quote-comparison";

test("cash quotes compare DC watts, not whole-system prices or battery budgets", () => {
  const model = 2.55;
  for (const [price, size, expectedPrice] of [["$24,000", "8", 24000], ["30,000.00", "10.000", 30000]] as const) {
    assert.deepEqual(compareInstallerQuote({ price, size }, model).comparison, {
      price: expectedPrice, size: Number(size), quotePerWatt: 3, deltaPerWatt: 0.45,
    });
  }
  assert.equal(compareInstallerQuote({ price: "15,000", size: "7.5" }, model).comparison?.deltaPerWatt, -0.55);
});

test("differences below display precision are reported as equal", () => {
  assert.deepEqual(compareInstallerQuote({ price: "2550.41", size: "1" }, 2.55).comparison, {
    price: 2550.41, size: 1, quotePerWatt: 2.55, deltaPerWatt: 0,
  });
});

test("installer brief uses the quoted capacity for cost and asks about actual size and price differences", () => {
  const quote = compareInstallerQuote({ price: "24000", size: "8" }, 2.55).comparison;
  assert.ok(quote);
  const different = buildInstallerMeetingBrief(quote, 2.55, 7560);
  assert.match(different, /modeled solar-only cost is \$20,400/);
  assert.match(different, /8 kW DC; the roof estimate is 7\.56 kW DC/);
  assert.match(different, /higher price per watt/);
  const matching = compareInstallerQuote({ price: "20400", size: "8" }, 2.55).comparison;
  assert.ok(matching);
  const same = buildInstallerMeetingBrief(matching, 2.55, 8000);
  assert.match(same, /first-year production/);
  assert.doesNotMatch(same, /higher price|explain the difference/);
});

test("missing input is not an error or a zero-dollar quote", () => {
  assert.deepEqual(compareInstallerQuote({ price: " ", size: "" }, 2.55), {
    invalidPrice: false, invalidSize: false, comparison: null,
  });
  assert.equal(compareInstallerQuote({ price: "24000", size: "" }, 2.55).comparison, null);
});

test("invalid inputs never produce a misleading price or division by zero", () => {
  for (const price of ["0", "-1", "1,2", "1e9", "1.235", "Infinity"]) {
    const result = compareInstallerQuote({ price, size: "8" }, 2.55);
    assert.equal(result.invalidPrice, true);
    assert.equal(result.comparison, null);
  }
  for (const size of ["0", "-8", "8kW", "$8", "8,4", "0.0001"]) {
    const result = compareInstallerQuote({ price: "24000", size }, 2.55);
    assert.equal(result.invalidSize, true);
    assert.equal(result.comparison, null);
  }
  for (const rate of [0, -1, NaN, Infinity]) {
    assert.equal(compareInstallerQuote({ price: "24000", size: "8" }, rate).comparison, null);
  }
});
