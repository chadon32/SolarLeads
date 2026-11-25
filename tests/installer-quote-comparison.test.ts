import assert from "node:assert/strict";
import test from "node:test";
import { buildInstallerMeetingBrief, compareCashOffers, compareInstallerQuote } from "../src/lib/installer-quote-comparison";

test("two cash offers distinguish a larger total price from a lower unit price", () => {
  const a = { price: "$24,000", size: "8" }, b = { price: "26000", size: "10" };
  const pair = compareCashOffers(a, b)!;
  assert.match(pair.summary, /costs \$2,000(?:\.00)? more in total\. Quote B is \$0\.40\/W lower/);
  assert.deepEqual(pair.rows[2], ["Price per watt", "$3.00/W", "$2.60/W"]);
  assert.match(pair.text, /System size: Quote A 8 kW DC \| Quote B 10 kW DC/);
  assert.match(compareCashOffers(b, a)!.summary, /less in total\. Quote B is \$0\.40\/W higher/);
});

test("ties use displayed precision and total differences keep cents", () => {
  const a = { price: "24000.01", size: "8" };
  assert.match(compareCashOffers(a, a)!.summary, /cash prices are the same.*match to the nearest cent/);
  assert.match(compareCashOffers(a, { ...a, price: "24000.02" })!.summary, /\$0\.01 more.*match to the nearest cent/);
});

test("an incomplete or malformed offer on either side suppresses the result", () => {
  const valid = { price: "21599", size: "7.25" };
  for (const bad of [{ price: "", size: "7" }, { price: "$1,00", size: "7" }, { price: "10", size: "0" }]) {
    assert.equal(compareCashOffers(valid, bad), null);
    assert.equal(compareCashOffers(bad, valid), null);
  }
});

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
