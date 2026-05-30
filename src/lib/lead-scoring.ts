export type LeadScoreTier = "hot" | "warm" | "cold";

export type LeadScoreLabel = "Hot Lead" | "Warm Lead" | "Cold Lead";

export type LeadScoreInput = {
  annualSavings?: number | null;
  email?: string | null;
  energyOffsetPct?: number | null;
  monthlyBill?: number | null;
  name?: string | null;
  panelCount?: number | null;
  pdfDownloaded?: boolean | null;
  pdfGenerated?: boolean | null;
  quoteRequested?: boolean | null;
  phone?: string | null;
  roofAreaM2?: number | null;
  selectedPanelBrand?: string | null;
  selectedPanelModel?: string | null;
  selectedPanelWatts?: number | null;
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
  "Lead score is based on solar potential, savings estimate, roof fit, homeowner engagement, and bill verification.";

export function calculateLeadScore(input: LeadScoreInput): LeadScoreResult {
  const annualSavings = finite(input.annualSavings);
  const panelCount = finite(input.panelCount);
  const roofAreaM2 = finite(input.roofAreaM2);
  const monthlyBill = finite(input.monthlyBill);

  let score = 0;

  if (hasText(input.name)) score += 20;
  if (isValidEmail(input.email)) score += 20;
  if (hasValidPhone(input.phone)) score += 15;
  if (annualSavings !== null && annualSavings > 1_000) score += 15;
  if (annualSavings !== null && annualSavings > 2_000) score += 10;
  if (roofAreaM2 !== null && roofAreaM2 > 50) score += 10;
  if (panelCount !== null && panelCount >= 10) score += 10;
  if (monthlyBill !== null && monthlyBill >= 150) score += 5;
  if (hasNonDefaultPanelSelection(input)) score += 5;
  if (input.utilityBillUploaded) score += 10;

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
  if (score >= 70) {
    return "hot";
  }

  if (score >= 45) {
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

function finite(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function hasText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidEmail(value: unknown) {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function hasValidPhone(value: unknown) {
  return typeof value === "string" && value.replace(/\D/g, "").length >= 10;
}

function hasNonDefaultPanelSelection(input: LeadScoreInput) {
  const brand = input.selectedPanelBrand?.trim().toLowerCase() ?? "";
  const model = input.selectedPanelModel?.trim().toLowerCase() ?? "";
  const watts = Number(input.selectedPanelWatts);
  const hasSelection = Boolean(brand || model || (Number.isFinite(watts) && watts > 0));

  if (!hasSelection) {
    return false;
  }

  const selectedText = `${brand} ${model}`;
  const isDefaultQcells =
    selectedText.includes("qcells") ||
    selectedText.includes("q.peak") ||
    selectedText.includes("q peak");

  return !isDefaultQcells;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
