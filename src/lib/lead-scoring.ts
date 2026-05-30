export type LeadScoreTier = "hot" | "warm" | "cold";

export type LeadScoreLabel = "Hot Lead" | "Warm Lead" | "Cold Lead";

export type LeadScoreInput = {
  annualSavings?: number | null;
  email?: string | null;
  energyOffsetPct?: number | null;
  panelCount?: number | null;
  pdfDownloaded?: boolean | null;
  pdfGenerated?: boolean | null;
  quoteRequested?: boolean | null;
  phone?: string | null;
  solarSuitabilityScore?: number | null;
  systemSizeKw?: number | null;
  twentyYearSavings?: number | null;
  utilityBillUploaded?: boolean | null;
};

export type LeadScoreResult = {
  explanation: string;
  label: LeadScoreLabel;
  score: number;
  tier: LeadScoreTier;
};

export const LEAD_SCORE_EXPLANATION =
  "Lead score is based on solar potential, savings estimate, roof fit, and homeowner engagement.";

export function calculateLeadScore(input: LeadScoreInput): LeadScoreResult {
  const solarSuitabilityScore = finite(input.solarSuitabilityScore);
  const annualSavings = finite(input.annualSavings);
  const twentyYearSavings = finite(input.twentyYearSavings);
  const panelCount = finite(input.panelCount);
  const systemSizeKw = finite(input.systemSizeKw);
  const energyOffsetPct = finite(input.energyOffsetPct);

  const score =
    scoreFromScale(solarSuitabilityScore, 100, 22) +
    scoreFromScale(annualSavings, 4_000, 20) +
    scoreFromScale(twentyYearSavings, 80_000, 10) +
    scoreFromScale(panelCount, 30, 12) +
    scoreFromScale(systemSizeKw, 12, 10) +
    scoreFromScale(energyOffsetPct, 100, 10) +
    (hasText(input.email) ? 5 : 0) +
    (hasText(input.phone) ? 6 : 0) +
    (input.pdfGenerated ? 2 : 0) +
    (input.pdfDownloaded ? 2 : 0) +
    (input.quoteRequested ? 8 : 0) +
    (input.utilityBillUploaded ? 1 : 0);

  const roundedScore = clamp(Math.round(score), 0, 100);
  const tier = getLeadScoreTier(roundedScore);

  return {
    explanation: LEAD_SCORE_EXPLANATION,
    label: getLeadScoreLabel(roundedScore),
    score: roundedScore,
    tier,
  };
}

export function getLeadScoreTier(score: number): LeadScoreTier {
  if (score >= 80) {
    return "hot";
  }

  if (score >= 55) {
    return "warm";
  }

  return "cold";
}

export function getLeadScoreLabel(score: number): LeadScoreLabel {
  const tier = getLeadScoreTier(score);

  if (tier === "hot") {
    return "Hot Lead";
  }

  if (tier === "warm") {
    return "Warm Lead";
  }

  return "Cold Lead";
}

export function normalizeLeadScoreLabel(
  label: string | null | undefined,
  score: number
): LeadScoreLabel {
  const normalized = label?.trim().toLowerCase();

  if (normalized === "hot lead" || normalized === "hot") {
    return "Hot Lead";
  }

  if (normalized === "warm lead" || normalized === "warm") {
    return "Warm Lead";
  }

  if (normalized === "cold lead" || normalized === "cold") {
    return "Cold Lead";
  }

  return getLeadScoreLabel(score);
}

function scoreFromScale(
  value: number | null,
  topValue: number,
  maxPoints: number
) {
  if (value === null || topValue <= 0) {
    return 0;
  }

  return clamp(value / topValue, 0, 1) * maxPoints;
}

function finite(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function hasText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
