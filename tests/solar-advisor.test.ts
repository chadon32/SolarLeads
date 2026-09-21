import assert from "node:assert/strict";
import test from "node:test";
import { generateSuitabilityExplanation } from "../src/lib/solar-advisor";

test("solar advisor distinguishes raw candidates from the preliminary ceiling", () => {
  const result = generateSuitabilityExplanation({
    annualSavings: 2_400,
    annualSunlightHours: 2_050,
    coveragePct: 80,
    monthlyBill: 200,
    panelCount: 20,
    rejectedCandidateCount: 47,
    systemKw: 8,
    usablePctRoof: 62,
    usableRoofAreaM2: 70,
  });

  assert.ok(
    result.limitingFactors.includes(
      "47 raw Solar API positions were excluded before the preliminary layout ceiling because of spacing, setbacks, or overlap prevention."
    )
  );
  assert.equal(
    result.limitingFactors.some((factor) => factor.includes("47 panel candidates were not used")),
    false
  );
});
