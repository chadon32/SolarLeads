export type LeadScoreTier = "premium" | "hot" | "qualified" | "warm" | "cold";

export type LeadScoreLabel =
  | "Premium Lead"
  | "Hot Lead"
  | "Qualified Lead"
  | "Warm Lead"
  | "Cold Lead";

export type LeadScoreInput = {
  annualSavings?: number | null;
  completedReportRequest?: boolean | null;
  email?: string | null;
  energyOffsetPct?: number | null;
  electricBillRange?: string | null;
  ownsHome?: boolean | string | null;
  monthlyBill?: number | null;
  name?: string | null;
  panelCount?: number | null;
  pdfDownloaded?: boolean | null;
  pdfGenerated?: boolean | null;
  preferredContactMethod?: string | null;
  quoteRequested?: boolean | null;
  phone?: string | null;
  roofAreaM2?: number | null;
  selectedPanelBrand?: string | null;
  selectedPanelModel?: string | null;
  selectedPanelWatts?: number | null;
  solarSuitabilityScore?: number | null;
  solarTimeline?: string | null;
  systemSizeKw?: number | null;
  twentyYearSavings?: number | null;
  utilityBillUploaded?: boolean | null;
  usableRoofAreaM2?: number | null;
  validResidentialAddress?: boolean | null;
};

export type LeadScoreResult = {
  explanation: string;
  label: LeadScoreLabel;
  lead_score_internal: number;
  lead_temperature_internal: LeadScoreLabel;
  score: number;
  tier: LeadScoreTier;
};

export const LEAD_SCORE_EXPLANATION =
  "Internal lead score is based on address validity, roof fit, solar readiness, system size, electric bill range, ownership, timeline urgency, contact preference, and completed report engagement.";

export function calculateLeadScore(input: LeadScoreInput): LeadScoreResult {
  const panelCount = finite(input.panelCount);
  const roofSuitability = clamp(finite(input.solarSuitabilityScore) ?? 0, 0, 100);
  const systemSizeKw = finite(input.systemSizeKw);
  const usableRoofAreaM2 = finite(input.usableRoofAreaM2);
  const monthlyBill = finite(input.monthlyBill);

  let score = 0;

  if (isValidResidentialAddress(input)) score += 10;
  if (hasUsableRoof(input)) score += 10;
  score += Math.round((roofSuitability / 100) * 20);
  score += scorePanelCount(panelCount);
  score += scoreSystemSize(systemSizeKw);
  score += scoreElectricBill(input.electricBillRange, monthlyBill);
  score += scoreHomeownerStatus(input.ownsHome);
  score += scoreTimeline(input.solarTimeline);
  score += scorePreferredContact(input.preferredContactMethod);
  if (input.completedReportRequest || input.quoteRequested || input.pdfGenerated) score += 7;

  if (isValidEmail(input.email)) score += 3;
  if (hasValidPhone(input.phone)) score += 3;
  if (hasText(input.name)) score += 2;
  if (input.utilityBillUploaded) score += 5;
  if (input.pdfDownloaded) score += 3;
  if (hasPanelSelection(input)) score += 2;

  const roundedScore = clamp(Math.round(score), 0, 100);
  const tier = getLeadScoreTier(roundedScore);
  const label = getLeadScoreLabel(roundedScore);

  return {
    explanation: LEAD_SCORE_EXPLANATION,
    label,
    lead_score_internal: roundedScore,
    lead_temperature_internal: label,
    score: roundedScore,
    tier,
  };
}

export function getLeadScoreTier(score: number): LeadScoreTier {
  if (score >= 85) {
    return "premium";
  }

  if (score >= 70) {
    return "hot";
  }

  if (score >= 55) {
    return "qualified";
  }

  if (score >= 35) {
    return "warm";
  }

  return "cold";
}

export function getLeadScoreLabel(score: number): LeadScoreLabel {
  const tier = getLeadScoreTier(score);

  if (tier === "premium") {
    return "Premium Lead";
  }

  if (tier === "hot") {
    return "Hot Lead";
  }

  if (tier === "qualified") {
    return "Qualified Lead";
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

  if (normalized === "premium lead" || normalized === "premium") {
    return "Premium Lead";
  }

  if (normalized === "hot lead" || normalized === "hot") {
    return "Hot Lead";
  }

  if (normalized === "qualified lead" || normalized === "qualified") {
    return "Qualified Lead";
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
  return typeof value === "string" && value.trim().length > 1;
}

function isValidEmail(value: unknown) {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function hasValidPhone(value: unknown) {
  return typeof value === "string" && value.replace(/\D/g, "").length >= 10;
}

function isValidResidentialAddress(input: LeadScoreInput) {
  if (input.validResidentialAddress !== null && input.validResidentialAddress !== undefined) {
    return Boolean(input.validResidentialAddress);
  }

  return hasText(input.name) && (hasText(input.email) || hasValidPhone(input.phone));
}

function hasUsableRoof(input: LeadScoreInput) {
  const usableArea = finite(input.usableRoofAreaM2);
  const panelCount = finite(input.panelCount);
  const systemSizeKw = finite(input.systemSizeKw);

  return Boolean(
    (usableArea !== null && usableArea > 12) ||
      (panelCount !== null && panelCount >= 6) ||
      (systemSizeKw !== null && systemSizeKw >= 2)
  );
}

function scorePanelCount(panelCount: number | null) {
  if (panelCount === null) return 0;
  if (panelCount >= 24) return 12;
  if (panelCount >= 16) return 10;
  if (panelCount >= 10) return 8;
  if (panelCount >= 6) return 5;
  return 2;
}

function scoreSystemSize(systemSizeKw: number | null) {
  if (systemSizeKw === null) return 0;
  if (systemSizeKw >= 9) return 10;
  if (systemSizeKw >= 6) return 8;
  if (systemSizeKw >= 4) return 6;
  if (systemSizeKw >= 2) return 3;
  return 1;
}

function scoreElectricBill(range: string | null | undefined, monthlyBill: number | null) {
  const normalized = range?.trim().toLowerCase() ?? "";

  if (normalized.includes("400") || normalized.includes("over_600") || normalized.includes("400+")) return 10;
  if (normalized.includes("300") || normalized.includes("250_400")) return 8;
  if (normalized.includes("200") || normalized.includes("150_250")) return 6;
  if (normalized.includes("100") || normalized.includes("under")) return 3;

  if (monthlyBill === null) return 0;
  if (monthlyBill >= 400) return 10;
  if (monthlyBill >= 300) return 8;
  if (monthlyBill >= 200) return 6;
  if (monthlyBill >= 100) return 3;
  return 1;
}

function scoreHomeownerStatus(value: boolean | string | null | undefined) {
  if (typeof value === "boolean") return value ? 8 : 1;

  const normalized = value?.trim().toLowerCase() ?? "";
  if (["own", "owns", "owner", "homeowner", "yes", "true"].includes(normalized)) return 8;
  if (["rent", "rents", "renter", "no", "false"].includes(normalized)) return 1;
  return 3;
}

function scoreTimeline(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (normalized.includes("asap") || normalized.includes("immediately")) return 8;
  if (normalized.includes("1") && normalized.includes("3")) return 6;
  if (normalized.includes("3") && normalized.includes("6")) return 4;
  if (normalized.includes("research")) return 1;
  return 2;
}

function scorePreferredContact(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (normalized === "phone" || normalized === "text") return 5;
  if (normalized === "email") return 3;
  return 1;
}

function hasPanelSelection(input: LeadScoreInput) {
  const brand = input.selectedPanelBrand?.trim().toLowerCase() ?? "";
  const model = input.selectedPanelModel?.trim().toLowerCase() ?? "";
  const watts = Number(input.selectedPanelWatts);

  return Boolean(brand || model || (Number.isFinite(watts) && watts > 0));
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
