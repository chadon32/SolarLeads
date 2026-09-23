import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSolarAdvisorInputFromAnalysis,
  buildSolarAdvisorProfile,
  calculateSolarReadinessScore,
  generateSuitabilityExplanation,
} from "../src/lib/solar-advisor";
import { buildSolarMetrics } from "../src/lib/solar-metrics";
import type { RoofAnalysis } from "../src/lib/roof-analysis";
import { TEST_ROOF_ANALYSIS } from "./fixtures/test-data";

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

test("solar readiness reflects the selected system instead of roof-model confidence", () => {
  const analysis = {
    ...structuredClone(TEST_ROOF_ANALYSIS),
    rooftopConfidenceScore: 100,
  } as RoofAnalysis;
  const baseMetrics = buildSolarMetrics(analysis, {
    monthlyBill: 250,
    selectedPanelCount: 2,
  });
  const metrics = { ...baseMetrics, coveragePct: 11, panelCount: 2 };
  const advisorInput = buildSolarAdvisorInputFromAnalysis(
    analysis,
    metrics,
    250
  );
  const advisor = buildSolarAdvisorProfile(advisorInput);

  assert.equal(advisorInput.suitabilityScore, undefined);
  assert.equal(
    advisor.suitability.score,
    calculateSolarReadinessScore({
      annualSunlightHours: metrics.annualSunlightHours,
      coveragePct: metrics.coveragePct,
      panelCount: metrics.panelCount,
      usablePctRoof: metrics.usablePctRoof,
    })
  );
  assert.ok(advisor.suitability.score < 100);
});
