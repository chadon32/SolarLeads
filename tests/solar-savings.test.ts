import assert from "node:assert/strict";
import test from "node:test";
import {
  ARIZONA_AVG_RATE_PER_KWH,
  ARIZONA_EXPORT_CREDIT_PER_KWH,
  ARIZONA_FIXED_MONTHLY_CHARGE,
  SOLAR_SELF_CONSUMPTION_SHARE,
} from "../src/lib/solar-assumptions";
import { estimateAnnualSolarSavings } from "../src/lib/solar-savings";

test("solar never removes the utility's fixed monthly charge", () => {
  // A system far larger than the home's use: savings stop at the energy part of the bill.
  const savings = estimateAnnualSolarSavings({ annualKwh: 60_000, monthlyBill: 200 });
  assert.equal(savings, Math.round((200 - ARIZONA_FIXED_MONTHLY_CHARGE) * 12));
  assert.ok(savings < 200 * 12, "the bill never drops to $0");
});

test("power used at home is worth the retail rate; exported power earns the export credit", () => {
  const annualKwh = 10_000;
  const used = annualKwh * SOLAR_SELF_CONSUMPTION_SHARE;
  const exported = annualKwh - used;
  const expected = Math.round(used * ARIZONA_AVG_RATE_PER_KWH + exported * ARIZONA_EXPORT_CREDIT_PER_KWH);
  // A large bill, so nothing is capped.
  assert.equal(estimateAnnualSolarSavings({ annualKwh, monthlyBill: 900 }), expected);
  // Without a bill the same split applies.
  assert.equal(estimateAnnualSolarSavings({ annualKwh }), expected);
  assert.ok(expected < annualKwh * ARIZONA_AVG_RATE_PER_KWH, "exports are worth less than retail");
});

test("savings grow with production but never pass the offsettable part of the bill", () => {
  let previous = 0;
  for (const annualKwh of [0, 2_000, 6_000, 10_000, 14_000, 20_000, 40_000]) {
    const savings = estimateAnnualSolarSavings({ annualKwh, monthlyBill: 250 });
    assert.ok(savings >= previous, `${annualKwh} kWh`);
    assert.ok(savings <= (250 - ARIZONA_FIXED_MONTHLY_CHARGE) * 12);
    previous = savings;
  }
});

test("bad inputs give zero instead of NaN", () => {
  assert.equal(estimateAnnualSolarSavings({ annualKwh: Number.NaN, monthlyBill: 200 }), 0);
  assert.equal(estimateAnnualSolarSavings({ annualKwh: -50, monthlyBill: 200 }), 0);
  // A bill at or below the fixed charge has nothing for solar to offset.
  assert.equal(estimateAnnualSolarSavings({ annualKwh: 8_000, monthlyBill: ARIZONA_FIXED_MONTHLY_CHARGE }), 0);
});
