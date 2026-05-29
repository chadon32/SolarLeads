import type { RoofAnalysis, RoofSegment } from "@/lib/roof-analysis";
import type { SharedSolarMetrics } from "@/lib/solar-metrics";

export type RoofQualityTone = "strong" | "moderate" | "limited";

export type SunlightQualitySegment = {
  label: string;
  score: number;
  quality: RoofQualityTone;
  source: "Solar API" | "Estimated";
};

export type SuitabilityExplanation = {
  score: number;
  headline: string;
  positiveFactors: string[];
  limitingFactors: string[];
};

export type SolarAdvisorQuestion = {
  question: string;
  answer: string;
};

export type SolarAdvisorProfile = {
  candidateLabel: "strong" | "moderate" | "weak";
  summary: string;
  suitability: SuitabilityExplanation;
  sunlightQuality: {
    label: string;
    score: number;
    source: "Solar API" | "Estimated";
    summary: string;
    segments: SunlightQualitySegment[];
  };
  questions: SolarAdvisorQuestion[];
  disclaimer: string;
};

export type SolarAdvisorInput = {
  annualSavings: number;
  annualSunlightHours: number;
  coveragePct: number;
  grossRoofAreaM2?: number;
  monthlyBill?: number | null;
  orientationLabel?: string;
  panelCount: number;
  paybackYears?: number;
  rejectedCandidateCount?: number;
  roofSegments?: Array<
    Pick<RoofSegment, "areaM2" | "azimuthDeg" | "label" | "panelsFit" | "usable">
  >;
  shadingRisk?: RoofAnalysis["shadingRisk"];
  suitabilityScore?: number;
  systemKw: number;
  usablePctRoof: number;
  usableRoofAreaM2: number;
};

const DISCLAIMER =
  "This is a preliminary estimate. Final design, pricing, incentives, and savings require installer confirmation.";

export function buildSolarAdvisorProfile(input: SolarAdvisorInput): SolarAdvisorProfile {
  const suitability = generateSuitabilityExplanation(input);
  const sunlightQuality = calculateSunlightQuality(input);
  const candidateLabel = getCandidateLabel(suitability.score);
  const summary = generateSolarAdvisorSummary(input, suitability.score, candidateLabel);

  return {
    candidateLabel,
    disclaimer: DISCLAIMER,
    questions: buildAdvisorQuestions(input, suitability, sunlightQuality),
    suitability,
    sunlightQuality,
    summary,
  };
}

export function buildSolarAdvisorInputFromAnalysis(
  analysis: RoofAnalysis,
  metrics: SharedSolarMetrics,
  monthlyBill?: number | null
): SolarAdvisorInput {
  return {
    annualSavings: metrics.annualSavings,
    annualSunlightHours: metrics.annualSunlightHours,
    coveragePct: metrics.coveragePct,
    grossRoofAreaM2: metrics.grossRoofAreaM2,
    monthlyBill,
    orientationLabel: metrics.primaryOrientationLabel,
    panelCount: metrics.panelCount,
    paybackYears: metrics.paybackYears,
    rejectedCandidateCount: metrics.rejectedCandidateCount,
    roofSegments: analysis.roofSegments,
    shadingRisk: analysis.shadingRisk,
    suitabilityScore: analysis.rooftopConfidenceScore,
    systemKw: metrics.systemKw,
    usablePctRoof: metrics.usablePctRoof,
    usableRoofAreaM2: metrics.usableRoofAreaM2,
  };
}

export function generateSolarAdvisorSummary(
  input: SolarAdvisorInput,
  score = getSuitabilityScore(input),
  candidateLabel = getCandidateLabel(score)
) {
  const systemSize =
    input.systemKw > 0 ? `${input.systemKw.toFixed(1)} kW` : "the recommended system";
  const panelCopy =
    input.panelCount > 0 ? `${input.panelCount} accepted panel locations` : "the available roof model";
  const savingsCopy =
    input.annualSavings > 0
      ? `$${Math.round(input.annualSavings).toLocaleString()} per year`
      : "the homeowner's bill and utility assumptions";

  return `Your home appears to be a ${candidateLabel} solar candidate. The current roof model supports ${panelCopy}, a modeled ${systemSize} system, and estimated annual savings of ${savingsCopy}. Panels are prioritized on usable roof planes with stronger sunlight, cleaner geometry, and fewer placement conflicts. Savings are modeled using the monthly bill input and Arizona assumptions. ${DISCLAIMER}`;
}

export function generateSuitabilityExplanation(
  input: SolarAdvisorInput
): SuitabilityExplanation {
  const score = getSuitabilityScore(input);
  const positiveFactors: string[] = [];
  const limitingFactors: string[] = [];

  if (input.annualSunlightHours >= 1900) {
    positiveFactors.push("Strong annual sunlight for Arizona solar production.");
  } else if (input.annualSunlightHours >= 1700) {
    positiveFactors.push("Moderate annual sunlight with usable roof exposure.");
  } else {
    limitingFactors.push("Lower usable sunlight may reduce production.");
  }

  if (input.usableRoofAreaM2 >= 45 || input.usablePctRoof >= 55) {
    positiveFactors.push("Enough usable roof area for a clean panel layout.");
  } else if (input.usableRoofAreaM2 > 0) {
    limitingFactors.push("Smaller usable roof area limits total panel capacity.");
  }

  if (input.panelCount >= 18) {
    positiveFactors.push("Accepted panel count supports a practical residential system size.");
  } else if (input.panelCount >= 10) {
    positiveFactors.push("Panel count is workable, though not a maximum-capacity layout.");
  } else {
    limitingFactors.push("Lower accepted panel count may limit bill offset.");
  }

  if (input.coveragePct >= 70) {
    positiveFactors.push("High estimated energy offset based on the current system size.");
  } else if (input.coveragePct >= 45) {
    positiveFactors.push("Moderate estimated energy offset from the current layout.");
  } else {
    limitingFactors.push("Lower estimated energy offset may leave more utility usage after solar.");
  }

  if (input.rejectedCandidateCount && input.rejectedCandidateCount > 0) {
    limitingFactors.push(
      `${input.rejectedCandidateCount} panel candidates were not used because of spacing, setbacks, or overlap prevention.`
    );
  }

  if (input.shadingRisk === "high") {
    limitingFactors.push("Possible shade or obstructions require installer review.");
  } else if (input.shadingRisk === "medium") {
    limitingFactors.push("Some shade risk may need confirmation during final design.");
  }

  if (!input.monthlyBill || input.monthlyBill <= 0) {
    limitingFactors.push("Missing utility bill data can make savings less specific.");
  }

  return {
    headline: `Why ${score}/100?`,
    limitingFactors: limitingFactors.length
      ? limitingFactors
      : ["Final shading, roof condition, and utility assumptions still require installer confirmation."],
    positiveFactors: positiveFactors.length
      ? positiveFactors
      : ["The Solar API returned enough roof data to create a preliminary model."],
    score,
  };
}

export function calculateSunlightQuality(input: SolarAdvisorInput) {
  const baseScore = getSuitabilityScore(input);
  const source: "Solar API" | "Estimated" = input.roofSegments?.length
    ? "Solar API"
    : "Estimated";
  const segments =
    input.roofSegments?.slice(0, 4).map((segment): SunlightQualitySegment => {
      const orientationScore = getOrientationScore(segment.azimuthDeg);
      const capacityScore = segment.usable
        ? Math.min(100, 45 + segment.panelsFit * 5)
        : 20;
      const score = clamp(
        Math.round(baseScore * 0.38 + orientationScore * 0.37 + capacityScore * 0.25),
        0,
        100
      );

      return {
        label: `${capitalize(segment.label)} plane`,
        quality: getRoofQualityLabel(score),
        score,
        source,
      };
    }) ?? [];
  const score = segments.length
    ? Math.round(
        segments.reduce((sum, segment) => sum + segment.score, 0) / segments.length
      )
    : baseScore;
  const label = getRoofQualityLabel(score);

  return {
    label,
    score,
    segments,
    source,
    summary:
      source === "Solar API"
        ? `Sunlight quality is estimated from Solar API roof planes, orientation, usable area, and accepted panel candidates. Overall quality is ${label}.`
        : `Sunlight quality is estimated from modeled roof suitability because detailed segment data is unavailable. Overall quality is ${label}.`,
  };
}

export function getRoofQualityLabel(score: number): RoofQualityTone {
  if (score >= 78) return "strong";
  if (score >= 58) return "moderate";
  return "limited";
}

function getSuitabilityScore(input: SolarAdvisorInput) {
  if (Number.isFinite(input.suitabilityScore) && input.suitabilityScore !== undefined) {
    return clamp(Math.round(input.suitabilityScore), 0, 100);
  }

  const sunlightScore = clamp((input.annualSunlightHours / 2100) * 100, 0, 100);
  const areaScore = clamp(input.usablePctRoof, 0, 100);
  const panelScore = clamp((input.panelCount / 24) * 100, 0, 100);
  const offsetScore = clamp(input.coveragePct, 0, 100);

  return clamp(
    Math.round(sunlightScore * 0.28 + areaScore * 0.22 + panelScore * 0.26 + offsetScore * 0.24),
    0,
    100
  );
}

function getCandidateLabel(score: number): SolarAdvisorProfile["candidateLabel"] {
  if (score >= 80) return "strong";
  if (score >= 60) return "moderate";
  return "weak";
}

function buildAdvisorQuestions(
  input: SolarAdvisorInput,
  suitability: SuitabilityExplanation,
  sunlightQuality: ReturnType<typeof calculateSunlightQuality>
): SolarAdvisorQuestion[] {
  const savings = input.annualSavings > 0
    ? `$${Math.round(input.annualSavings).toLocaleString()} per year`
    : "the current modeled savings";

  return [
    {
      question: "Why were panels placed there?",
      answer:
        "Panels are prioritized on usable roof planes with stronger sunlight, compatible orientation, cleaner geometry, and fewer spacing or setback conflicts. The layout also avoids candidates that would overlap or look unrealistic.",
    },
    {
      question: "How accurate is this estimate?",
      answer:
        "The roof geometry and panel candidates come from available Solar API data when present. Savings, payback, and financing are modeled estimates and should be confirmed by a licensed installer before making a purchase decision.",
    },
    {
      question: "What affects my savings?",
      answer: `Savings are affected by your monthly bill, utility rates, solar production, panel count, system size, incentives, and financing terms. This model currently estimates ${savings} using Arizona assumptions.`,
    },
    {
      question: "Should I consider a battery?",
      answer:
        input.coveragePct >= 70
          ? "A battery may be worth discussing if you want backup power or better control over evening usage, but it usually changes payback. Ask an installer to compare solar-only versus solar-plus-storage."
          : "Start by confirming the solar layout and bill offset first. A battery can still help with backup power, but the main priority is validating the roof design and production estimate.",
    },
    {
      question: "What happens next?",
      answer: `Review the ${suitability.score}/100 suitability score, sunlight quality (${sunlightQuality.label}), and savings assumptions. Then request a finalized design so an installer can verify roof condition, setbacks, equipment, incentives, and pricing.`,
    },
  ];
}

function getOrientationScore(azimuthDeg: number) {
  const normalized = ((azimuthDeg % 360) + 360) % 360;
  const southDelta = Math.min(
    Math.abs(normalized - 180),
    360 - Math.abs(normalized - 180)
  );

  if (southDelta <= 35) return 96;
  if (southDelta <= 70) return 82;
  if (southDelta <= 115) return 64;
  return 46;
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
