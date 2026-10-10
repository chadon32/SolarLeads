import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSolarAdvisorInputFromAnalysis,
  buildSolarAdvisorProfile,
  calculateSolarReadinessScore,
  generateSuitabilityExplanation,
  getSolarReadinessLabel,
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

test("one readiness scale names every score the same way", () => {
  assert.equal(getSolarReadinessLabel(100), "Strong Candidate");
  assert.equal(getSolarReadinessLabel(85), "Strong Candidate");
  assert.equal(getSolarReadinessLabel(84), "Good Candidate");
  assert.equal(getSolarReadinessLabel(65), "Good Candidate");
  assert.equal(getSolarReadinessLabel(64), "Preliminary Estimate");
  assert.equal(getSolarReadinessLabel(45), "Preliminary Estimate");
  assert.equal(getSolarReadinessLabel(44), "Installer Verification Required");
  assert.equal(getSolarReadinessLabel(Number.NaN), "Installer Verification Required");
});

test("the estimate page labels and summarises on the saved report's scale", () => {
  const input = {
    annualSavings: 2_400,
    annualSunlightHours: 2_050,
    coveragePct: 80,
    panelCount: 24,
    systemKw: 9.6,
    usablePctRoof: 70,
    usableRoofAreaM2: 90,
  };
  // 82 used to read "strong candidate" on screen but "Good Candidate" in the emailed PDF.
  const good = buildSolarAdvisorProfile({ ...input, suitabilityScore: 82 });
  assert.equal(good.candidateLabel, "Good Candidate");
  assert.match(good.summary, /a good preliminary solar candidate/);
  assert.doesNotMatch(good.summary, /current roof model supports/);

  const strong = buildSolarAdvisorProfile({ ...input, suitabilityScore: 90 });
  assert.equal(strong.candidateLabel, "Strong Candidate");
  assert.match(strong.summary, /a strong preliminary solar candidate/);
  assert.match(strong.summary, /current roof model supports 24 accepted panel locations/);

  const preliminary = buildSolarAdvisorProfile({ ...input, suitabilityScore: 50 });
  assert.equal(preliminary.candidateLabel, "Preliminary Estimate");
  assert.match(preliminary.summary, /a moderate preliminary solar candidate/);

  const low = buildSolarAdvisorProfile({ ...input, suitabilityScore: 30 });
  assert.equal(low.candidateLabel, "Installer Verification Required");
  assert.match(low.summary, /a limited preliminary solar candidate/);

  for (const coveragePct of [0, 35, 70, 100]) {
    const profile = buildSolarAdvisorProfile({ ...input, coveragePct });
    assert.equal(profile.candidateLabel, getSolarReadinessLabel(profile.suitability.score));
  }
});
